/**
 * Human login for Omni, on Better Auth (wish: omni-labs-distribution).
 *
 * One library for every way in, so Omni keeps no authentication code of its own:
 *
 *   * phone-number — the human ID. Codes go to the self chat of one of this
 *     Omni's connected WhatsApp accounts (login/whatsapp.ts), never elsewhere.
 *   * passkey      — Face ID, Touch ID, a fingerprint, a security key.
 *   * device-authorization (RFC 8628) — the desktop app, the DSH plugin and the
 *     CLI show a QR; the owner approves on the approval page or by sending the
 *     code to their own WhatsApp (plugins/device-login.ts).
 *   * bearer       — a device presents its one-time device token to exchange it
 *     for an Omni API key (routes/v2/login.ts).
 *
 * One human owns an Omni: whoever claims it first, with the claim token from the boot
 * log, an admin key (login/operator.ts) or a verified WhatsApp number, becomes its only
 * user, and sign-up closes.
 *
 * Without a fixed public URL (login/config.ts) Better Auth takes its base URL from each
 * request, a browser may post from either scheme on the address it came in on, and
 * passkeys are off: WebAuthn binds a passkey to one fixed host.
 */

// First, before the passkey plugin: @simplewebauthn/server reaches tsyringe (through
// @peculiar/x509), which throws at load time unless the Reflect metadata polyfill is in.
import 'reflect-metadata';
import { passkey } from '@better-auth/passkey';
import type { Database } from '@omni/db';
import {
  loginAccounts,
  loginDeviceCodes,
  loginPasskeys,
  loginSessions,
  loginUsers,
  loginVerifications,
} from '@omni/db';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { bearer, deviceAuthorization, phoneNumber } from 'better-auth/plugins';
import { count } from 'drizzle-orm';
import { phoneDigits } from '../lib/phone';
import { type LoginConfig, isDeviceClient } from './config';
import { loginCodeMessage } from './messages';
import { sameHostOrigins } from './origin';
import { type WhatsAppAccess, accountByPhone } from './whatsapp';

/** Better Auth endpoints the outside world may call. Everything else under /api/auth answers 404. */
export const PUBLIC_AUTH_PATHS = new Set([
  '/device/code',
  '/device/token',
  '/device',
  '/device/approve',
  '/device/deny',
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/generate-authenticate-options',
  '/passkey/verify-authentication',
  '/passkey/list-user-passkeys',
  '/passkey/delete-passkey',
  '/get-session',
  '/sign-out',
]);

/** The user codes the device flow issues: Better Auth's own alphabet, 8 characters. */
const USER_CODE_LENGTH = 8;
/** How long a WhatsApp login code works. */
const OTP_TTL_S = 300;

export interface LoginAuthDeps {
  db: Database;
  whatsapp: WhatsAppAccess;
  config: LoginConfig;
}

async function ownerClaimed(db: Database): Promise<boolean> {
  const [row] = await db.select({ value: count() }).from(loginUsers);
  return (row?.value ?? 0) > 0;
}

type Where = { field: string; value: unknown }[];

/**
 * What Omni uses of the Better Auth instance. Better Auth's own inferred type names
 * modules the API's declaration build cannot reach, so the instance is typed by this
 * facade; every member is Better Auth's own, with the plugins configured below.
 */
export interface LoginAuth {
  handler: (request: Request) => Promise<Response>;
  $context: Promise<{
    internalAdapter: {
      createSession(userId: string): Promise<{ id: string; token: string } | null>;
      deleteSession(token: string): Promise<void>;
    };
    adapter: {
      findOne<T>(query: { model: string; where: Where }): Promise<T | null>;
      update<T>(query: { model: string; where: Where; update: Record<string, unknown> }): Promise<T | null>;
      /** Delete and return exactly one matching row; under a race exactly one caller gets it. */
      consumeOne<T>(query: { model: string; where: Where }): Promise<T | null>;
      deleteMany(query: { model: string; where: (Where[number] & { operator?: 'lt' })[] }): Promise<number>;
    };
  }>;
  api: {
    sendPhoneNumberOTP(input: { body: { phoneNumber: string } }): Promise<unknown>;
    verifyPhoneNumber(input: {
      body: { phoneNumber: string; code: string; updatePhoneNumber?: boolean; disableSession?: boolean };
      headers?: Headers;
      returnHeaders: true;
    }): Promise<{ headers: Headers; response: unknown }>;
    getSession(input: {
      headers: Headers;
    }): Promise<{
      user: { id: string };
      session: { id: string; token: string; deviceClientId?: string | null };
    } | null>;
  };
}

export function createLoginAuth({ db, whatsapp, config }: LoginAuthDeps): LoginAuth {
  const fixed = config.publicUrl ? new URL(config.publicUrl) : null;
  const trustedProxyHeader = process.env.TRUSTED_PROXY_HEADER?.trim().toLowerCase();
  const auth = betterAuth({
    appName: 'Omni',
    baseURL: config.publicUrl ?? undefined,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: fixed ? [fixed.origin] : (request?: Request) => (request ? sameHostOrigins(request) : []),
    telemetry: { enabled: false },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: loginUsers,
        session: loginSessions,
        account: loginAccounts,
        verification: loginVerifications,
        passkey: loginPasskeys,
        deviceCode: loginDeviceCodes,
      },
    }),
    emailAndPassword: { enabled: false },
    // Omni rate-limits /api/auth itself (routes/v2/login.ts), keyed on the client IP the way
    // the rest of the API is (TRUSTED_PROXY_HEADER, else the socket). Better Auth's own
    // limiter would key on whatever X-Forwarded-For a client sends.
    rateLimit: { enabled: false },
    advanced: {
      ipAddress: trustedProxyHeader ? { ipAddressHeaders: [trustedProxyHeader] } : { disableIpTracking: true },
    },
    session: {
      // Set only on the session the device flow hands a device (see the hook below):
      // the one kind of session /api/v2/login/device-key accepts.
      additionalFields: { deviceClientId: { type: 'string', required: false, input: false } },
    },
    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: OTP_TTL_S,
        allowedAttempts: 3,
        // Only the accounts connected to this Omni get codes, and only in their own self chat.
        phoneNumberValidator: async (phone) => (await accountByPhone(whatsapp, phone)) !== null,
        sendOTP: async ({ phoneNumber: phone, code }) => {
          const account = await accountByPhone(whatsapp, phone);
          if (!account) throw new Error('This number is not connected to this Omni');
          await whatsapp.sendToSelf(account, `login-${Date.now()}`, loginCodeMessage(code, OTP_TTL_S / 60));
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phoneDigits(phone) ?? 'owner'}@phone.omni.invalid`,
          getTempName: (phone) => `+${phoneDigits(phone) ?? phone}`,
        },
      }),
      ...(fixed ? [passkey({ rpID: fixed.hostname, rpName: 'Omni', origin: fixed.origin })] : []),
      deviceAuthorization({
        expiresIn: '10m',
        interval: '2s',
        userCodeLength: USER_CODE_LENGTH,
        // Relative without a fixed URL: Better Auth resolves it against the request's own address.
        verificationUri: `${config.publicUrl ?? ''}/api/login/device`,
        validateClient: (clientId) => isDeviceClient(clientId),
      }),
      bearer(),
    ],
    databaseHooks: {
      user: {
        create: {
          // One owner: the first verified human claims the Omni, and sign-up closes after.
          // (login_users also refuses a second row outright, against two claims at once.)
          before: async () => ((await ownerClaimed(db)) ? false : undefined),
        },
      },
      session: {
        create: {
          // Mark the session /device/token creates with the device client it was granted to.
          before: async (session, ctx) => {
            if (ctx?.path !== '/device/token') return undefined;
            const clientId = String((ctx.body as { client_id?: unknown } | undefined)?.client_id ?? '');
            return { data: { ...session, deviceClientId: isDeviceClient(clientId) ? clientId : 'unknown' } };
          },
        },
      },
    },
  });
  return auth as unknown as LoginAuth;
}
