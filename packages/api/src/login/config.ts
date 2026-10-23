/**
 * Human login configuration (wish: omni-labs-distribution).
 *
 * Read from the environment and nowhere else. Login is off unless
 * OMNI_LOGIN_ENABLED=true and the public URL and secret it needs are set; with
 * multitenancy on it is off too (devices get legacy keys, which a tenant
 * deployment must not mint).
 */

import { createHmac } from 'node:crypto';
import { z } from 'zod';
import { isMultitenancyEnabled } from '../tenancy/feature-flag';

/** Scopes a device key may never carry: everything, and the ability to mint or edit keys. */
const FORBIDDEN_SCOPE = /^(\*|keys:.*|platform:.*)$/;
const DEFAULT_SCOPES = ['instances:read', 'chats:read', 'messages:read', 'events:read'];

/** The device-flow clients this Omni knows (Better Auth `client_id`). */
export const DEVICE_CLIENTS = {
  'omni-desktop': 'the Omni desktop app',
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

export const LoginConfigSchema = z.object({
  enabled: z.boolean(),
  /** Where people reach this Omni (https://omni.example.com). Better Auth's base URL and the passkey origin. */
  publicUrl: z.string().url(),
  /** Better Auth's secret: signs sessions and derives the claim token. */
  secret: z.string().min(32, 'OMNI_AUTH_SECRET must be at least 32 characters'),
  deviceKeyScopes: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*:(\*|[a-z][a-z0-9-]*)$/, 'scopes look like resource:action'))
    .min(1)
    .refine((scopes) => !scopes.some((scope) => FORBIDDEN_SCOPE.test(scope)), {
      message: 'device keys may not carry *, keys:* or platform:* scopes',
    }),
  /** Null: device keys never expire (they are revoked instead). */
  deviceKeyTtlDays: z.number().int().min(1).max(3650).nullable(),
});
export type LoginConfig = z.infer<typeof LoginConfigSchema>;

/** The login configuration, or null when login is off on this deployment. Throws when it is on but misconfigured. */
export function readLoginConfig(env: NodeJS.ProcessEnv = process.env): LoginConfig | null {
  if (env.OMNI_LOGIN_ENABLED !== 'true' || isMultitenancyEnabled(env)) return null;
  const scopes = csv(env.OMNI_DEVICE_KEY_SCOPES);
  return LoginConfigSchema.parse({
    enabled: true,
    publicUrl: env.OMNI_PUBLIC_URL?.trim().replace(/\/+$/, ''),
    secret: env.OMNI_AUTH_SECRET ?? '',
    deviceKeyScopes: scopes.length ? scopes : DEFAULT_SCOPES,
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
