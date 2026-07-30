/**
 * Pure-logic unit tests for the G6 mapping/redaction/checksum foundation
 * (wish: omni-full-multitenancy, Group G6). No server needed — these prove the
 * decision functions before the engine that drives them touches a cluster.
 */

import { describe, expect, test } from 'bun:test';
import { ABSENT_IMAGE, absentChecksum, canonicalize, checksum } from './checksum';
import {
  type InstanceTenantMap,
  type OperatorRowMap,
  deriveComposite,
  mapRootInstance,
  operatorTenantFor,
} from './mapping-engine';
import { DEFAULT_REDACTION_POLICY, assertNoSecrets, isSecretColumn, redactRow, scanForSecrets } from './redaction';
import {
  STOP_BLOCKED_TABLES,
  UNOWNED_TABLES_FROM_SPEC,
  UNOWNED_TABLE_RULES,
  classifyDeriveFromEvent,
  classifyOperatorOrStopBlock,
  getUnownedRule,
} from './unowned-rules';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const INSTANCE_A = '55555555-5555-4555-8555-555555555551';

describe('checksum canonicalization', () => {
  test('object key order does not change the digest', () => {
    expect(checksum({ a: 1, b: 2 })).toBe(checksum({ b: 2, a: 1 }));
  });

  test('types do not alias: "1" !== 1, {} !== []', () => {
    expect(checksum('1')).not.toBe(checksum(1));
    expect(checksum({})).not.toBe(checksum([]));
    expect(checksum(null)).not.toBe(checksum(undefined));
  });

  test('a changed value changes the digest', () => {
    expect(checksum({ tenant_id: null })).not.toBe(checksum({ tenant_id: TENANT_A }));
  });

  test('Date and Uint8Array have stable tagged encodings', () => {
    const d = new Date('2026-07-21T00:00:00.000Z');
    expect(canonicalize(d)).toBe('d:2026-07-21T00:00:00.000Z');
    expect(canonicalize(new Uint8Array([0xde, 0xad]))).toBe('x:dead');
  });

  test('checksum is 64-char lowercase hex (ledger regex)', () => {
    expect(checksum({ any: 'row' })).toMatch(/^[0-9a-f]{64}$/);
    expect(absentChecksum()).toBe(checksum(ABSENT_IMAGE));
  });
});

describe('redaction', () => {
  test('secret-named columns become markers; ids/tenant pass through', () => {
    const row = {
      id: INSTANCE_A,
      tenant_id: TENANT_A,
      api_key_hash: 'deadbeefsecrethashvalue',
      text_content: 'hello world message body',
      primary_phone: '+15551234567',
    };
    const redacted = redactRow(row);
    expect(redacted.id).toBe(INSTANCE_A);
    expect(redacted.tenant_id).toBe(TENANT_A);
    expect((redacted.api_key_hash as { redacted: boolean }).redacted).toBe(true);
    expect((redacted.text_content as { redacted: boolean }).redacted).toBe(true);
    // The redaction marker carries only an integrity digest, never the value.
    expect(JSON.stringify(redacted)).not.toContain('deadbeefsecrethashvalue');
    expect(JSON.stringify(redacted)).not.toContain('hello world message body');
  });

  test('null values stay null (an absent secret is not a leak)', () => {
    expect(redactRow({ token: null }).token).toBeNull();
  });

  test('isSecretColumn: structural id columns are always clear', () => {
    expect(isSecretColumn('tenant_id')).toBe(false);
    expect(isSecretColumn('event_id')).toBe(false);
    expect(isSecretColumn('api_key_hash')).toBe(true);
    expect(isSecretColumn('secret')).toBe(true);
    expect(DEFAULT_REDACTION_POLICY).toBe('g6-column-name-v1');
  });

  test('scanForSecrets flags raw secret shapes but allows integrity checksums', () => {
    expect(scanForSecrets({ ok: 'short' })).toHaveLength(0);
    expect(scanForSecrets({ digest: checksum({ a: 1 }) })).toHaveLength(0); // 64-hex allowed
    expect(scanForSecrets({ leaked: 'sk-abcdefghijklmnopqrstuvwxyz012345' }).length).toBeGreaterThan(0);
    expect(scanForSecrets({ blob: 'A'.repeat(48) }).length).toBeGreaterThan(0);
    // A redaction marker short-circuits (its sha256 is allowed).
    expect(scanForSecrets(redactRow({ token: 'A'.repeat(48) }))).toHaveLength(0);
  });

  test('assertNoSecrets throws with a path but never the value', () => {
    expect(() => assertNoSecrets({ leaked: 'Bearer abcdefghijklmnop0123456789' }, 'receipt')).toThrow(/receipt/);
  });
});

describe('composite derivation', () => {
  test('single agreeing resolved parent assigns', () => {
    const r = deriveComposite([TENANT_A], 1, 'derived:test');
    expect(r.disposition).toBe('assign');
    expect(r.tenantId).toBe(TENANT_A);
    expect(r.ambiguityState).toBe('none');
  });

  test('two agreeing parents assign', () => {
    expect(deriveComposite([TENANT_A, TENANT_A], 2, 'x').disposition).toBe('assign');
  });

  test('conflicting parents quarantine as ambiguous', () => {
    const r = deriveComposite([TENANT_A, TENANT_B], 2, 'x');
    expect(r.disposition).toBe('quarantine');
    expect(r.ambiguityState).toBe('ambiguous');
    expect(r.tenantId).toBeNull();
  });

  test('an unresolved reachable parent quarantines, never assigns on partial evidence', () => {
    const r = deriveComposite([TENANT_A, null], 2, 'x');
    expect(r.disposition).toBe('quarantine');
    expect(r.ambiguityState).toBe('quarantined');
  });

  test('no reachable parent is an orphan quarantine', () => {
    const r = deriveComposite([], 2, 'x');
    expect(r.disposition).toBe('quarantine');
    expect(r.reason).toContain('orphan');
  });
});

describe('root instance mapping', () => {
  const map: InstanceTenantMap = new Map([[INSTANCE_A, TENANT_A]]);
  test('mapped instance assigns', () => {
    expect(mapRootInstance(INSTANCE_A, map).tenantId).toBe(TENANT_A);
  });
  test('unmapped instance quarantines, never guesses', () => {
    const r = mapRootInstance('99999999-9999-4999-8999-999999999999', map);
    expect(r.disposition).toBe('quarantine');
    expect(r.tenantId).toBeNull();
  });
});

describe('unowned tables', () => {
  test('the rule set is EXACTLY the derivation:unowned tables from the frozen spec', () => {
    expect([...UNOWNED_TABLE_RULES].map((r) => r.table).sort()).toEqual([...UNOWNED_TABLES_FROM_SPEC].sort());
    expect(UNOWNED_TABLE_RULES).toHaveLength(7);
  });

  test('automations/conversations/webhook_sources are stop-blocked absent operator input', () => {
    expect([...STOP_BLOCKED_TABLES].sort()).toEqual(['automations', 'conversations', 'webhook_sources']);
    const empty: OperatorRowMap = new Map();
    for (const table of STOP_BLOCKED_TABLES) {
      const rule = getUnownedRule(table);
      expect(rule).toBeDefined();
      const r = classifyOperatorOrStopBlock(rule!, '{"id":"x"}', empty);
      expect(r.disposition).toBe('stop-blocked');
      expect(r.reason).toBeTruthy(); // the named open question
    }
  });

  test('an operator mapping resolves a stop-blocked table', () => {
    const rule = getUnownedRule('conversations')!;
    const opMap: OperatorRowMap = new Map([['conversations', new Map([['{"id":"c1"}', TENANT_B]])]]);
    const r = classifyOperatorOrStopBlock(rule, '{"id":"c1"}', opMap);
    expect(r.disposition).toBe('assign');
    expect(r.tenantId).toBe(TENANT_B);
  });

  test('derive-from-event: resolved event assigns, unresolved quarantines, no-match quarantines', () => {
    const rule = getUnownedRule('dead_letter_events')!;
    expect(classifyDeriveFromEvent(rule, TENANT_A).disposition).toBe('assign');
    expect(classifyDeriveFromEvent(rule, null).disposition).toBe('quarantine');
    const noMatch = classifyDeriveFromEvent(rule, undefined);
    expect(noMatch.disposition).toBe('quarantine');
    expect(noMatch.reason).toContain('no owning omni_events row');
  });

  test('processed_events carries a named PK-rewrite deferral', () => {
    expect(getUnownedRule('processed_events')!.deferral).toContain('PRIMARY KEY');
  });
});

test('operatorTenantFor returns null when unmapped', () => {
  expect(operatorTenantFor('automations', '{"id":"a"}', new Map())).toBeNull();
});
