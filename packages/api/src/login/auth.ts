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
 * One human owns an Omni: the first one to verify a phone number (the claim)
 * becomes its only user, and sign-up closes.
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
    adapter: {
      findOne<T>(query: { model: string; where: Where }): Promise<T | null>;
      update<T>(query: { model: string; where: Where; update: Record<string, unknown> }): Promise<T | null>;
    };
  }>;
  api: {
    sendPhoneNumberOTP(input: { body: { phoneNumber: string } }): Promise<unknown>;
    verifyPhoneNumber(input: {
      body: { phoneNumber: string; code: string };
      returnHeaders: true;
    }): Promise<{ headers: Headers; response: unknown }>;
    getSession(input: { headers: Headers }): Promise<{ user: { id: string }; session: { token: string } } | null>;
    revokeSession(input: { headers: Headers; body: { token: string } }): Promise<unknown>;
  };
}

export function createLoginAuth({ db, whatsapp, config }: LoginAuthDeps): LoginAuth {
  const origin = new URL(config.publicUrl).origin;
  const auth = betterAuth({
    appName: 'Omni',
    baseURL: config.publicUrl,
    basePath: '/api/auth',
    secret: config.secret,
    trustedOrigins: [origin],
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
    rateLimit: { enabled: true, window: 60, max: 30 },
    plugins: [
      phoneNumber({
        otpLength: 6,
        expiresIn: 300,
        allowedAttempts: 3,
        // Only the accounts connected to this Omni get codes, and only in their own self chat.
        phoneNumberValidator: async (phone) => (await accountByPhone(whatsapp, phone)) !== null,
        sendOTP: async ({ phoneNumber: phone, code }) => {
          const account = await accountByPhone(whatsapp, phone);
          if (!account) throw new Error('This number is not connected to this Omni');
          await whatsapp.sendToSelf(
            account,
            `login-${Date.now()}`,
            `Omni login code: ${code}\nIt works for 5 minutes. If you did not ask for it, ignore it.`,
          );
        },
        signUpOnVerification: {
          getTempEmail: (phone) => `${phoneDigits(phone) ?? 'owner'}@phone.omni.invalid`,
          getTempName: (phone) => `+${phoneDigits(phone) ?? phone}`,
        },
      }),
      passkey({ rpID: new URL(config.publicUrl).hostname, rpName: 'Omni', origin }),
      deviceAuthorization({
        expiresIn: '10m',
        interval: '2s',
        userCodeLength: USER_CODE_LENGTH,
        verificationUri: `${config.publicUrl}/api/login/device`,
        validateClient: (clientId) => isDeviceClient(clientId),
      }),
      bearer(),
    ],
    databaseHooks: {
      user: {
        create: {
          // One owner: the first verified human claims the Omni, and sign-up closes after.
          before: async () => ((await ownerClaimed(db)) ? false : undefined),
        },
      },
    },
  });
  return auth as unknown as LoginAuth;
}
