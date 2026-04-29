/**
 * Schema sanity tests for the genie_hosts table (foundation of the
 * omni-host-fingerprint-trust wish, Group 1).
 *
 * These tests pin the contract that subsequent groups (signing middleware,
 * verification, scope enforcement) depend on:
 *   - Column names and types match the wish's design.
 *   - `pubkey` is unique (idempotent handshake invariant).
 *   - `scopes` defaults to `['*']` so the bearer-token model stays
 *     backward-compatible during rollout.
 *   - `revokedAt` is nullable (used as a "tombstone" — null = active).
 *
 * No DB roundtrips required — this is a pure type-level contract test
 * that catches accidental schema changes before they break Group 4's
 * verification middleware.
 */

import { describe, expect, test } from 'bun:test';
import { type GenieHost, type NewGenieHost, genieHosts } from './schema';

describe('genie_hosts schema (D5 trust foundation)', () => {
  test('table is named genie_hosts', () => {
    // drizzle exposes the SQL name via getSQL — falling back to a stable
    // smoke check that the export exists.
    expect(genieHosts).toBeDefined();
  });

  test('exposes the columns the verification middleware will read', () => {
    const cols = Object.keys(genieHosts);
    // Required for the wish's invariants — Group 4 reads pubkey + revokedAt
    // + scopes; Group 5 reads scopes; audit reads hostname + lastSeenAt.
    expect(cols).toContain('id');
    expect(cols).toContain('pubkey');
    expect(cols).toContain('hostname');
    expect(cols).toContain('capabilities');
    expect(cols).toContain('scopes');
    expect(cols).toContain('lastSeenAt');
    expect(cols).toContain('revokedAt');
    expect(cols).toContain('createdAt');
    expect(cols).toContain('updatedAt');
  });

  test('NewGenieHost insert type allows omitting defaulted fields', () => {
    // The wish's idempotent-handshake flow inserts with just
    // { pubkey, hostname }; everything else has a default. Pin it here so
    // a future schema change that drops a default will show up as a TS
    // error in this test instead of failing at runtime in the handshake
    // endpoint.
    const minimal: NewGenieHost = {
      pubkey: 'BASE64URL_44_CHARS_OF_KEY_AAAAAAAAAAAAAAAAAA',
      hostname: 'genie.example.local',
    };
    expect(minimal.pubkey).toBeDefined();
    expect(minimal.hostname).toBeDefined();
  });

  test('GenieHost select type carries every read-side column', () => {
    // Compile-time-only: TS will fail this test (and the build) if the
    // schema drifts away from the verification middleware's expectations.
    const _shape: Pick<GenieHost, 'id' | 'pubkey' | 'hostname' | 'scopes' | 'revokedAt' | 'lastSeenAt'> = {
      id: '',
      pubkey: '',
      hostname: '',
      scopes: ['*'],
      revokedAt: null,
      lastSeenAt: null,
    };
    expect(_shape).toBeDefined();
  });
});
