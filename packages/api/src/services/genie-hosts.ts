/**
 * Genie Hosts Service — per-host fingerprint trust foundation.
 *
 * Reads/writes the `genie_hosts` table (see migration 0032). Drives the
 * idempotent handshake (`POST /api/v2/trust/handshake`) and is consumed by
 * the verification middleware (Group 4 of the wish) on every signed request.
 *
 * This service intentionally does NOT do crypto — it only stores the
 * already-validated public key. Signature verification lives in Group 4's
 * middleware. Keeping the service free of crypto means the data path can
 * be reviewed independently of the verification path.
 *
 * Tracked under the `omni-host-fingerprint-trust` wish, Group 1.1.
 */

import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { type GenieHost, genieHosts } from '@omni/db';
import { and, eq, isNull } from 'drizzle-orm';

const log = createLogger('genie-hosts');

export interface RegisterHostInput {
  /** ed25519 public key in base64url. Must be 44 chars (non-padded base64url of 32 bytes). */
  pubkey: string;
  /** Operator-meaningful display name. */
  hostname: string;
  /** Free-form metadata: { genieVersion, os, ... }. */
  capabilities?: Record<string, unknown>;
}

export class GenieHostsService {
  constructor(private db: Database) {}

  /**
   * Idempotent handshake. Re-registering the same `pubkey` returns the
   * existing host record unchanged — DOES NOT overwrite hostname or
   * capabilities (operator-driven changes go through `update`/`revoke`,
   * not handshake replays).
   *
   * If the host was previously revoked, handshaking again does NOT
   * un-revoke it — that's deliberate. Operators rotate via "revoke +
   * register-with-new-key", which keeps the audit story clean.
   */
  async register(input: RegisterHostInput): Promise<GenieHost> {
    const existing = await this.findByPubkey(input.pubkey);
    if (existing) {
      log.info('genie host handshake — idempotent reuse', { hostId: existing.id, hostname: existing.hostname });
      return existing;
    }

    const [created] = await this.db
      .insert(genieHosts)
      .values({
        pubkey: input.pubkey,
        hostname: input.hostname,
        capabilities: input.capabilities ?? {},
      })
      .returning();

    if (!created) {
      throw new Error('failed to insert genie host');
    }

    log.info('genie host registered', { hostId: created.id, hostname: created.hostname });
    return created;
  }

  /** Lookup by public key — used by the handshake idempotency check + Group 4 verifier. */
  async findByPubkey(pubkey: string): Promise<GenieHost | null> {
    const [row] = await this.db.select().from(genieHosts).where(eq(genieHosts.pubkey, pubkey)).limit(1);
    return row ?? null;
  }

  /** Lookup by host id — used by the verifier when the request carries `X-Genie-Host-Id`. */
  async findById(id: string): Promise<GenieHost | null> {
    const [row] = await this.db.select().from(genieHosts).where(eq(genieHosts.id, id)).limit(1);
    return row ?? null;
  }

  /**
   * List active hosts (revoked_at IS NULL) for `omni trust list` and audit
   * UIs. Limit-bounded to keep payloads sane; operators with hundreds of
   * hosts can paginate via name filters in a future iteration.
   */
  async listActive(limit = 100): Promise<GenieHost[]> {
    return this.db
      .select()
      .from(genieHosts)
      .where(isNull(genieHosts.revokedAt))
      .orderBy(genieHosts.createdAt)
      .limit(limit);
  }

  /**
   * Update `last_seen_at`. Called by the Group 4 verification middleware
   * on every successful signed request. No-op if the host is revoked
   * (defense in depth — middleware should have rejected first).
   */
  async touchLastSeen(id: string): Promise<void> {
    await this.db
      .update(genieHosts)
      .set({ lastSeenAt: new Date(), updatedAt: new Date() })
      .where(and(eq(genieHosts.id, id), isNull(genieHosts.revokedAt)));
  }

  /**
   * Replace a host's scopes wholesale (operator-driven). Returns the
   * updated host or null if the host doesn't exist / is revoked.
   *
   * Wholesale replace (not merge) is intentional: scopes are the
   * authoritative permission grant for a host; operators specify the
   * full new set explicitly. To narrow a host's permissions, pass
   * fewer scopes; to widen, pass more. Empty array = nothing allowed.
   */
  async updateScopes(id: string, scopes: string[]): Promise<GenieHost | null> {
    const [updated] = await this.db
      .update(genieHosts)
      .set({ scopes, updatedAt: new Date() })
      .where(and(eq(genieHosts.id, id), isNull(genieHosts.revokedAt)))
      .returning();
    if (updated) {
      log.info('genie host scopes updated', { hostId: updated.id, scopes });
    }
    return updated ?? null;
  }

  /**
   * Soft-delete: stamp `revoked_at`. Irreversible by design — to
   * "un-revoke" a host, register a fresh keypair (the previous record
   * stays around for the audit trail).
   *
   * Returns the revoked host or null if it didn't exist / was already
   * revoked. Idempotent on already-revoked records.
   */
  async revoke(id: string): Promise<GenieHost | null> {
    const now = new Date();
    const [revoked] = await this.db
      .update(genieHosts)
      .set({ revokedAt: now, updatedAt: now })
      .where(and(eq(genieHosts.id, id), isNull(genieHosts.revokedAt)))
      .returning();
    if (revoked) {
      log.info('genie host revoked', { hostId: revoked.id, hostname: revoked.hostname });
    }
    return revoked ?? null;
  }
}
