/**
 * Trust routes — per-host fingerprint registration.
 *
 * Wish: omni-host-fingerprint-trust (D5 follow-up to canonical-genie-omni-wiring).
 * Group 1.1 of that wish.
 *
 * `POST /trust/handshake` is idempotent on `pubkey`. Re-registering the
 * same key returns the existing host record unchanged. Hostname and
 * capabilities are NOT mutated by handshake replays — operator-driven
 * changes go through `omni trust update`/`revoke` commands (Group 1.2).
 *
 * Auth: this endpoint inherits the API's existing bearer-token auth
 * middleware. A valid `omni_sk_…` is required to register a host. Once
 * the verification middleware lands (Group 4), signed requests from
 * already-registered hosts can ALSO authenticate, but the FIRST
 * handshake always requires bearer auth — there's no other way to
 * bootstrap trust for a brand-new host.
 *
 * Validation: pubkey must look like a base64url-encoded 32-byte ed25519
 * key (44 chars, alphabet `[A-Za-z0-9_-]`, optional `=` padding). The
 * actual cryptographic validation (is this a valid curve point?) lives
 * in Group 4's verification middleware where it matters per-request;
 * the format gate here just keeps obvious garbage out of the table.
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const trustRoutes = new Hono<{ Variables: AppVariables }>();

// ed25519 base64url(32 bytes) is 43 chars unpadded, 44 chars padded.
// Allow either form; reject anything else as a fast-fail.
const PUBKEY_PATTERN = /^[A-Za-z0-9_-]{43}=?$/;

const handshakeSchema = z.object({
  pubkey: z.string().regex(PUBKEY_PATTERN, 'pubkey must be base64url-encoded 32 bytes (ed25519 public key)'),
  hostname: z.string().min(1).max(255),
  capabilities: z.record(z.unknown()).optional(),
});

/**
 * POST /trust/handshake — Register or look up a genie host by pubkey.
 *
 * Idempotent on pubkey. Returns 201 + the host record on first
 * registration, 200 + the existing host record on replay.
 */
trustRoutes.post('/handshake', zValidator('json', handshakeSchema), async (c) => {
  const input = c.req.valid('json');
  const services = c.get('services');

  const existing = await services.genieHosts.findByPubkey(input.pubkey);
  if (existing) {
    return c.json({ data: existing }, 200);
  }

  const host = await services.genieHosts.register(input);
  return c.json({ data: host }, 201);
});

/**
 * GET /trust/hosts — List active (non-revoked) genie hosts.
 *
 * Used by `omni trust list` (Group 1.2) and audit/admin UIs.
 */
trustRoutes.get('/hosts', async (c) => {
  const services = c.get('services');
  const items = await services.genieHosts.listActive();
  return c.json({ items });
});

export { trustRoutes };
