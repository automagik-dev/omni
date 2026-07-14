/**
 * Console request authentication — the BFF's policy enforcement point.
 *
 * When enabled (the enforce flag is OFF by default), every `/omni/api/v2/*`
 * request is gated fail-closed, per CONTRACT §4.1/§4.4:
 *   1. Verify the KHAL identity token (HS256 JWT via `validateKhalSession`,
 *      accepted as `Authorization: Bearer <jwt>` OR the `khal-session` cookie).
 *      No/invalid/expired session ⇒ 401, no key minted.
 *   2. Pin the tenant: `session.orgId` MUST be in the env allowlist, else 401.
 *      The token carries no `iss`/`aud`/tenant binding (CONTRACT §4.1), so this
 *      allowlist is the ONLY tenant binding — it is NOT optional.
 *   3. Resolve `role` → console profile via EXACT membership (unknown slug ⇒
 *      401, no key minted — never the fail-open `member` default; §2.2/§4.4).
 *   4. Mint/reuse a per-user Omni key for that profile and return it to inject.
 *   Never trust `session.permissions[]` as an Omni scope source (§1.4).
 *
 * ── TRUST MODEL (CONTRACT §4.2 — read before flipping the flag ON) ───────────
 * Verification is HS256 (SYMMETRIC). The value in `KHAL_SESSION_SECRET` is KHAL
 * core's *signing* key, not a verify-only key: anyone who can read this pod's
 * env can FORGE a token for any userId/orgId/role — including `platform-owner` —
 * and that forgery is valid at every pack sharing the secret. That is a LARGER
 * blast radius than the Omni-scoped god-key this wish removes. Before enabling
 * enforcement in production, resolve one of (CONTRACT §4.2):
 *   (a) a pack-scoped secret, or an `aud` claim pinned here alongside orgId;
 *   (b) asymmetric/JWKS verify-only keys (an app-kit follow-up — no such path
 *       exists in `@khal-os/sdk` today); or
 *   (c) record it as an explicitly accepted residual risk with a NAMED HUMAN
 *       OWNER — it must not be inherited silently.
 * `KHAL_SESSION_SECRET` is host/operator-provisioned (the platform does NOT
 * auto-inject it — install.ts `PLATFORM_MANAGED_ENV_KEYS` omits it). Its absence
 * makes `validateKhalSession` return `null` for every request ⇒ fail-closed 401.
 */

import { validateKhalSession } from '@khal-os/sdk/server';
import type { KhalRequest, KhalSession } from '@khal-os/sdk/server';
import { ConsoleKeyMintError, type ConsoleKeyProvider } from './console-keys';
import { type ConsoleProfile, resolveConsoleProfile } from './roles';

/** Verifies an incoming request and returns the KHAL session, or `null` on any failure. */
export type SessionValidator = (req: Request) => Promise<KhalSession | null>;

export interface ConsoleAuthConfig {
  /** Allowlisted KHAL org IDs (the tenant binding). A session whose `orgId` is absent is rejected. */
  orgAllowlist: string[];
  /** Per-user key minter/cache. */
  keyProvider: ConsoleKeyProvider;
  /** HS256 secret. Defaults to `process.env.KHAL_SESSION_SECRET` inside the verifier when omitted. */
  sessionSecret?: string;
  /** Injectable session validator (tests). Defaults to the real `@khal-os/sdk/server` verifier. */
  validateSession?: SessionValidator;
  /** Injectable clock passed to the verifier (tests); seconds since epoch. */
  now?: () => number;
}

export type AuthResult =
  | { ok: true; apiKey: string; keyPrefix: string; session: KhalSession; profile: ConsoleProfile }
  | { ok: false; status: number; code: string; message: string; upstreamStatus?: number };

export interface ConsoleAuth {
  authenticate(req: Request): Promise<AuthResult>;
}

const unauthorized = (code: string, message: string): AuthResult => ({ ok: false, status: 401, code, message });

/**
 * Adapt a WHATWG `Request` to the SDK's `KhalRequest` shape (a plain header bag)
 * and verify it. Bearer takes precedence over the cookie (the SDK default).
 */
function defaultValidator(config: ConsoleAuthConfig): SessionValidator {
  return (req: Request) => {
    const khalReq: KhalRequest = {
      headers: {
        authorization: req.headers.get('authorization') ?? undefined,
        cookie: req.headers.get('cookie') ?? undefined,
      },
    };
    return validateKhalSession(khalReq, { secret: config.sessionSecret, now: config.now });
  };
}

export function createConsoleAuth(config: ConsoleAuthConfig): ConsoleAuth {
  const orgAllowlist = new Set(config.orgAllowlist);
  const validate = config.validateSession ?? defaultValidator(config);

  return {
    async authenticate(req: Request): Promise<AuthResult> {
      const session = await validate(req);
      if (!session) {
        return unauthorized('UNAUTHENTICATED', 'A valid KHAL session is required.');
      }
      if (!orgAllowlist.has(session.orgId)) {
        return unauthorized('ORG_NOT_ALLOWED', 'This KHAL org is not permitted to use the Omni console.');
      }
      const profile = resolveConsoleProfile(session.role);
      if (!profile) {
        return unauthorized('ROLE_NOT_RECOGNIZED', 'The KHAL role is not a recognized console role.');
      }

      try {
        const minted = await config.keyProvider.keyFor(session.userId, profile);
        return { ok: true, apiKey: minted.apiKey, keyPrefix: minted.keyPrefix, session, profile };
      } catch (err) {
        const upstreamStatus = err instanceof ConsoleKeyMintError ? err.upstreamStatus : undefined;
        return {
          ok: false,
          status: 502,
          code: 'KEY_MINT_FAILED',
          message: 'Could not provision a per-user Omni key for this session.',
          ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
        };
      }
    },
  };
}
