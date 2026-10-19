/**
 * Managed nats-server arguments
 *
 * Single owner of how the CLI launches its managed nats-server (`omni start`,
 * `omni install` via PM2, and the `--systemd` unit): the JetStream/store-dir
 * flags and the bind address (`-a`).
 *
 * Without `-a`, nats-server listens on 0.0.0.0. A single-host Omni only needs
 * omni-api to reach NATS over loopback, so the default is 127.0.0.1. Operators
 * whose NATS must be reachable from other hosts opt in with
 * `omni config set server.natsHost <address>`.
 *
 * `NATS_URL` (where clients connect) is a separate concern and is not read
 * here. The repo's dev `ecosystem.config.cjs` cannot import TypeScript, so it
 * mirrors {@link DEFAULT_NATS_HOST} in its own `NATS_HOST` fallback.
 *
 * Leaf module on purpose: `config.ts` imports the default and the schema from
 * here, so this file only takes a type-only import back (no runtime cycle).
 */

import { z } from 'zod';
import type { ServerConfig } from './config.js';

/** Default bind address for the managed nats-server: loopback only. */
export const DEFAULT_NATS_HOST = '127.0.0.1';

/**
 * Characters a bind host may contain. Deliberately narrow: the value ends up
 * as a PM2 script argument and inside a systemd `ExecStart=` line, where
 * quotes, whitespace, `$` (env expansion), `%` (unit specifiers), `\`, `;`,
 * `&`, `|` and backticks would all change meaning. This also rules out IPv6
 * zone IDs (`fe80::1%eth0`).
 */
const NATS_HOST_CHARSET = /^[A-Za-z0-9.:-]+$/;

/** RFC 1123 hostname: dot-separated labels of 1–63 alnum/hyphen chars, no edge hyphens. */
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

const IpAddressSchema = z.string().ip();

/**
 * A DNS hostname whose last label is not all digits — so a malformed IPv4
 * such as `999.1.1.1` or `10.0.0` is rejected instead of being treated as a
 * hostname.
 */
function isDnsHostname(value: string): boolean {
  if (!HOSTNAME_PATTERN.test(value)) return false;
  const lastLabel = value.slice(value.lastIndexOf('.') + 1);
  return !/^\d+$/.test(lastLabel);
}

/** Bind address for the managed nats-server: an IPv4/IPv6 address or a DNS hostname. */
export const NatsHostSchema = z
  .string()
  .min(1, 'must not be empty')
  .max(253, 'must be at most 253 characters')
  .regex(NATS_HOST_CHARSET, 'may only contain letters, digits, ".", ":" and "-"')
  .refine((value) => IpAddressSchema.safeParse(value).success || isDnsHostname(value), {
    message: 'must be an IPv4 address, an IPv6 address, or a DNS hostname',
  });

/**
 * Bind address the managed nats-server should listen on: the stored
 * `server.natsHost` when set, otherwise {@link DEFAULT_NATS_HOST}.
 *
 * Throws when the stored value is invalid (only reachable by hand-editing
 * `config.json` — `omni config set` validates) rather than silently falling
 * back, so a deliberate setting is never quietly replaced.
 */
export function resolveNatsHost(serverConfig: Pick<ServerConfig, 'natsHost'>): string {
  const stored: unknown = serverConfig.natsHost;
  if (stored === undefined || stored === null) return DEFAULT_NATS_HOST;
  const parsed = NatsHostSchema.safeParse(stored);
  if (!parsed.success) {
    const problem = parsed.error.issues[0]?.message ?? 'is invalid';
    throw new Error(
      `Invalid server.natsHost ${JSON.stringify(stored)} in the Omni config: ${problem}. ` +
        `Fix it with: omni config set server.natsHost ${DEFAULT_NATS_HOST}`,
    );
  }
  return parsed.data;
}

/**
 * Arguments for the managed nats-server: JetStream enabled, store directory,
 * and the bind address. The port is nats-server's default (4222).
 *
 * The host is re-validated here so no launch path can hand nats-server (or a
 * systemd `ExecStart=` line) an unchecked value.
 */
export function buildNatsServerArgs(opts: { natsDataDir: string; host: string }): string[] {
  return ['-js', '-sd', opts.natsDataDir, '-a', NatsHostSchema.parse(opts.host)];
}
