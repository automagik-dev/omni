/**
 * Human login configuration (wish: omni-labs-distribution).
 *
 * On by default for a single-tenant Omni: nothing has to be set for a device to pair.
 * OMNI_LOGIN_ENABLED=false turns it off, and with multitenancy on it is always off
 * (devices get legacy keys, which a tenant deployment must not mint).
 *
 *   OMNI_AUTH_SECRET   signs sessions and derives the claim token. When unset, the API
 *                      generates one at first boot and keeps it in the database
 *                      (login/secret.ts), so restarts and replicas share it.
 *   OMNI_PUBLIC_URL    where people reach this Omni (or the `server.public_url` setting).
 *                      When neither is set, links are built from the
 *                      address each request came in on (login/origin.ts). Passkeys need it:
 *                      WebAuthn binds a passkey to one fixed host, so without it the
 *                      approval page offers the other ways in. HTTPS matters for passkeys only.
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { isMultitenancyEnabled } from '../tenancy/feature-flag';

/**
 * Scopes a device key may never carry, whatever OMNI_DEVICE_KEY_SCOPES says: everything,
 * and the namespaces that govern Omni itself (keys, settings, login, trust, the audit
 * trail, the platform).
 */
const FORBIDDEN_SCOPE = /^(\*|(keys|settings|auth|trust|audit|platform):.*)$/;
/**
 * What an owner-approved device key carries unless the operator says otherwise: running
 * the channels, chats and messages it shows, its events, and seeing this Omni's version
 * and asking the owner to update it.
 */
export const DEFAULT_DEVICE_KEY_SCOPES = [
  'instances:*',
  'chats:*',
  'messages:*',
  'events:*',
  'system:read',
  'system:update',
] as const;

/** The device-flow clients this Omni knows (Better Auth `client_id`). */
export const DEVICE_CLIENTS = {
  'omni-desktop': 'the Automagik app',
  'omni-dsh': 'the Omni plugin for DeepSeek Harness',
  'omni-cli': 'the omni command line',
} as const satisfies Record<string, string>;
export type DeviceClientId = keyof typeof DEVICE_CLIENTS;
export const isDeviceClient = (value: string): value is DeviceClientId => Object.hasOwn(DEVICE_CLIENTS, value);

const csv = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** An origin people reach this Omni on: http(s), a host, no path. */
export const PublicUrlSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/\/+$/, ''))
  .pipe(
    z
      .string()
      .url()
      .refine((value) => /^https?:\/\/[^/?#]+$/i.test(value), 'OMNI_PUBLIC_URL must be http(s)://host, with no path'),
  );

export const LoginConfigSchema = z.object({
  enabled: z.boolean(),
  /** Where people reach this Omni (https://omni.example.com), or null: links follow each request's address and passkeys are off. */
  publicUrl: PublicUrlSchema.nullable(),
  /** Better Auth's secret: signs sessions and derives the claim token. */
  secret: z.string().min(32, 'OMNI_AUTH_SECRET must be at least 32 characters'),
  deviceKeyScopes: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*:(\*|[a-z][a-z0-9-]*)$/, 'scopes look like resource:action'))
    .min(1)
    .refine((scopes) => !scopes.some((scope) => FORBIDDEN_SCOPE.test(scope)), {
      message: 'device keys may not carry *, keys, settings, auth, trust, audit or platform scopes',
    }),
  /** Null: device keys never expire (they are revoked instead). */
  deviceKeyTtlDays: z.number().int().min(1).max(3650).nullable(),
});
export type LoginConfig = z.infer<typeof LoginConfigSchema>;

/** Whether this deployment runs human login at all: on unless switched off, and never with multitenancy. */
export function loginWanted(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OMNI_LOGIN_ENABLED?.trim().toLowerCase() !== 'false' && !isMultitenancyEnabled(env);
}

/** What the API resolved for itself at boot when the environment left it unset (login/secret.ts). */
export interface LoginDefaults {
  secret?: string;
  /** The `server.public_url` setting, when OMNI_PUBLIC_URL is unset. */
  publicUrl?: string;
}

/**
 * The login configuration, or null when login is off on this deployment. Throws when it is
 * on but misconfigured (a bad public URL or scope list, or no secret at all).
 */
export function readLoginConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaults: LoginDefaults = {},
): LoginConfig | null {
  if (!loginWanted(env)) return null;
  const scopes = csv(env.OMNI_DEVICE_KEY_SCOPES);
  const publicUrl = env.OMNI_PUBLIC_URL?.trim() || defaults.publicUrl?.trim();
  return LoginConfigSchema.parse({
    enabled: true,
    publicUrl: publicUrl ? publicUrl : null,
    secret: env.OMNI_AUTH_SECRET?.trim() || defaults.secret || '',
    deviceKeyScopes: scopes.length ? scopes : [...DEFAULT_DEVICE_KEY_SCOPES],
    deviceKeyTtlDays: env.OMNI_DEVICE_KEY_TTL_DAYS ? Number(env.OMNI_DEVICE_KEY_TTL_DAYS) : null,
  });
}

/**
 * The token an unclaimed Omni asks for before anyone may claim it, so "the first one"
 * is whoever installed it (it is printed at boot), not whoever finds the URL first.
 * Derived from the secret: the same on every replica and across restarts, no storage.
 */
export function claimTokenOf(config: Pick<LoginConfig, 'secret'>): string {
  return createHmac('sha256', config.secret).update('omni-claim-v1').digest('base64url').slice(0, 24);
}
