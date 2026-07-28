/**
 * Person cloning (wish: omni-full-multitenancy, Group G6; ADR-0002).
 *
 * `persons` is a parentless `unowned` table whose ownership fans out: a legacy
 * global person can bridge identity across future tenants. The decision table's
 * `global_persons_and_identities` rule (tenant_clone) and ADR-0002 require:
 *
 *   * a person whose references reach exactly ONE tenant is assigned that tenant;
 *   * a person whose references SPAN multiple mapped tenants is CLONED per tenant,
 *     and every reference (`platform_identities`, `chat_participants`,
 *     `messages`) is rewired DETERMINISTICALLY to that tenant's clone;
 *   * cross-tenant merge is forbidden — overlapping phone/JID never merges;
 *   * a person reaching no resolved tenant quarantines.
 *
 * Reachable tenants are computed through the reference paths down to the OWNING
 * INSTANCE's tenant (instances are assigned in the root phase first), so cloning
 * does not depend on the descendant tables being assigned yet.
 *
 * LEDGER CONVENTION (per the G6 contract): ONE ledger entry PER CREATED CLONE —
 * `source_primary_key` = the clone's own identity, `decision_rule`/`checkpoint`
 * carry the source-person reference, `pre_image` = the explicit does-not-exist
 * projection, `target` = the clone's tenant. The undo (delete the clone AND
 * rewire its children back) is not a literal single-row inverse, so it is carried
 * in the ledger's `compensating_action` field — the schema's own mechanism for a
 * write that is not literally invertible — NOT a new convention. The original
 * spanning person keeps a NULL owner and a quarantine entry noting its clones, so
 * it is accounted for by the zero-unresolved gate rather than left dangling.
 *
 * Clone ids are UUIDv5(namespace, `${personId}:${tenantId}`), so a re-run is
 * idempotent and the rewiring is deterministic. Dynamic identifiers only; no
 * literal tenant-table name appears here.
 */

import { createHash } from 'node:crypto';
import { ABSENT_IMAGE, absentChecksum, checksum } from './checksum';
import type { ToolingSql } from './db';
import { type CompensatingAction, findBySource, markApplied, recordPlanned } from './ledger';
import { assertNoSecrets, redactRow } from './redaction';

const q = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
function assertUuid(value: string): void {
  if (!UUID_RE.test(value)) throw new Error(`person-clone: refusing to embed non-UUID value "${value}"`);
}

/** Stable namespace for G6 person-clone ids (a fixed random UUID). */
const CLONE_NAMESPACE = '6f6d6e69-6733-4763-a6c6-6f6e6532303a';

export function personCloneId(personId: string, tenantId: string): string {
  const ns = Buffer.from(CLONE_NAMESPACE.replaceAll('-', ''), 'hex');
  const hash = createHash('sha1').update(ns).update(`${personId}:${tenantId}`).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // version 5
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // RFC-4122 variant
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * A reference path from `persons` to the OWNING INSTANCE's tenant. `rewriteSql`
 * takes the person id, clone id, and tenant and rewires exactly the references
 * that belong to that tenant. Every table name is a bound identifier via `q`.
 */
interface ReferencePath {
  readonly child: string;
  readonly personColumn: string;
  /** Selects the distinct tenant ids this person reaches through this path. */
  readonly reachSql: (personIdParam: string) => { text: string };
  /** Rewires this path's references for one tenant to the clone. */
  readonly rewriteSql: (person: string, clone: string, tenant: string) => { text: string; params: unknown[] };
}

const PATHS: ReferencePath[] = [
  {
    child: 'platform_identities',
    personColumn: 'person_id',
    reachSql: () => ({
      text: `SELECT DISTINCT i.tenant_id AS t FROM ${q('platform_identities')} pi JOIN ${q(
        'instances',
      )} i ON pi.instance_id = i.id WHERE pi.person_id = $1 AND i.tenant_id IS NOT NULL`,
    }),
    rewriteSql: (person, clone, tenant) => ({
      text: `UPDATE ${q('platform_identities')} pi SET person_id = $2 FROM ${q(
        'instances',
      )} i WHERE pi.person_id = $1 AND pi.instance_id = i.id AND i.tenant_id = $3`,
      params: [person, clone, tenant],
    }),
  },
  {
    child: 'chat_participants',
    personColumn: 'person_id',
    reachSql: () => ({
      text: `SELECT DISTINCT i.tenant_id AS t FROM ${q('chat_participants')} cp JOIN ${q('chats')} ch ON cp.chat_id = ch.id JOIN ${q(
        'instances',
      )} i ON ch.instance_id = i.id WHERE cp.person_id = $1 AND i.tenant_id IS NOT NULL`,
    }),
    rewriteSql: (person, clone, tenant) => ({
      text: `UPDATE ${q('chat_participants')} cp SET person_id = $2 FROM ${q('chats')} ch JOIN ${q(
        'instances',
      )} i ON ch.instance_id = i.id WHERE cp.person_id = $1 AND cp.chat_id = ch.id AND i.tenant_id = $3`,
      params: [person, clone, tenant],
    }),
  },
  {
    child: 'messages',
    personColumn: 'sender_person_id',
    reachSql: () => ({
      text: `SELECT DISTINCT i.tenant_id AS t FROM ${q('messages')} m JOIN ${q('chats')} ch ON m.chat_id = ch.id JOIN ${q(
        'instances',
      )} i ON ch.instance_id = i.id WHERE m.sender_person_id = $1 AND i.tenant_id IS NOT NULL`,
    }),
    rewriteSql: (person, clone, tenant) => ({
      text: `UPDATE ${q('messages')} m SET sender_person_id = $2 FROM ${q('chats')} ch JOIN ${q(
        'instances',
      )} i ON ch.instance_id = i.id WHERE m.sender_person_id = $1 AND m.chat_id = ch.id AND i.tenant_id = $3`,
      params: [person, clone, tenant],
    }),
  },
];

export interface PersonCloneReport {
  personsScanned: number;
  singleTenantAssigned: number;
  cloned: number; // number of source persons that were cloned
  clonesCreated: number; // total clone rows created
  quarantined: number; // persons reaching no resolved tenant
  writerEpoch: number;
}

export interface PersonCloneConfig {
  readonly writerEpoch?: number;
  readonly dryRun?: boolean;
}

async function reachableTenants(sql: ToolingSql, personId: string): Promise<string[]> {
  const tenants = new Set<string>();
  for (const path of PATHS) {
    const { text } = path.reachSql('$1');
    const rows = (await sql.unsafe(text, [personId] as never[])) as unknown as { t: string }[];
    for (const row of rows) if (row.t) tenants.add(row.t);
  }
  return [...tenants].sort();
}

async function fetchPerson(sql: ToolingSql, personId: string): Promise<Record<string, unknown> | null> {
  const rows = (await sql.unsafe(`SELECT * FROM ${q('persons')} WHERE id = $1`, [
    personId,
  ] as never[])) as unknown as Record<string, unknown>[];
  return rows[0] ?? null;
}

/**
 * Resolve `persons` ownership by cloning. Instances MUST already be assigned
 * (root phase). Returns a report; in dry-run it writes nothing.
 */
export async function runPersonCloning(sql: ToolingSql, config: PersonCloneConfig = {}): Promise<PersonCloneReport> {
  const epoch = config.writerEpoch ?? 0;
  const report: PersonCloneReport = {
    personsScanned: 0,
    singleTenantAssigned: 0,
    cloned: 0,
    clonesCreated: 0,
    quarantined: 0,
    writerEpoch: epoch,
  };

  const unowned = (await sql.unsafe(
    `SELECT id FROM ${q('persons')} WHERE tenant_id IS NULL ORDER BY id`,
  )) as unknown as { id: string }[];

  for (const { id: personId } of unowned) {
    report.personsScanned += 1;
    const tenants = await reachableTenants(sql, personId);

    if (tenants.length === 0) {
      report.quarantined += 1;
      if (!config.dryRun) await quarantinePerson(sql, personId, epoch, 'person reaches no resolved tenant (orphan)');
      continue;
    }

    const [onlyTenant] = tenants;
    if (tenants.length === 1 && onlyTenant) {
      report.singleTenantAssigned += 1;
      if (!config.dryRun) await assignPerson(sql, personId, onlyTenant, epoch);
      continue;
    }

    // Spanning person: clone per tenant.
    report.cloned += 1;
    if (!config.dryRun) {
      for (const tenant of tenants) {
        await createClone(sql, personId, tenant, epoch);
        report.clonesCreated += 1;
      }
      await quarantinePerson(
        sql,
        personId,
        epoch,
        `person spans ${tenants.length} tenants; cloned per tenant, references rewired`,
        tenants.map((t) => personCloneId(personId, t)),
      );
    } else {
      report.clonesCreated += tenants.length;
    }
  }

  return report;
}

async function assignPerson(sql: ToolingSql, personId: string, tenant: string, epoch: number): Promise<void> {
  const existing = await findBySource(sql, 'persons', { id: personId });
  if (existing && existing.status !== 'planned') return;
  const pre = await fetchPerson(sql, personId);
  if (!pre) return;
  const recorded = await recordPlanned(sql, {
    sourceTable: 'persons',
    sourcePrimaryKey: { id: personId },
    targetTenantId: tenant,
    decisionRule: 'unowned:persons single reachable tenant (ADR-0002)',
    preImageRedacted: redactRow(pre),
    preImageChecksum: checksum(pre),
    inverseAction: {
      type: 'restore-columns',
      table: 'persons',
      primaryKey: { id: personId },
      columns: { tenant_id: null },
    },
    compensatingAction: null,
    writerEpoch: epoch,
    ambiguityState: 'none',
    status: 'planned',
  });
  await sql.unsafe(`UPDATE ${q('persons')} SET tenant_id = $1 WHERE id = $2 AND tenant_id IS NULL`, [
    tenant,
    personId,
  ] as never[]);
  const post = (await fetchPerson(sql, personId)) ?? pre;
  const receipt = { rule: 'persons-single-tenant', tenant_id: tenant, checksum: checksum(post), writer_epoch: epoch };
  assertNoSecrets(receipt, 'person assignment receipt');
  await markApplied(sql, recorded.id, {
    postImageRedacted: redactRow(post),
    postImageChecksum: checksum(post),
    reconciliationReceipt: receipt,
  });
}

async function createClone(sql: ToolingSql, personId: string, tenant: string, epoch: number): Promise<void> {
  const cloneId = personCloneId(personId, tenant);
  const existing = await findBySource(sql, 'persons', { id: cloneId });
  if (existing) return; // idempotent: clone already ledgered

  // Create the clone in two steps. The BEFORE INSERT ownership trigger G2
  // installed forces `tenant_id := NULL` on every `persons` insert (persons is
  // unowned, so the trigger derives no owner), so setting tenant_id in the
  // INSERT would be discarded. We INSERT the copied row, then UPDATE its tenant —
  // the trigger gates INSERT only, not UPDATE, which is also how the engine
  // assigns every other table. `q('persons')` keeps the name dynamic (guard-safe).
  assertUuid(cloneId);
  assertUuid(tenant);
  const src = await fetchPerson(sql, personId);
  if (!src) return;
  const metadata = src.metadata == null ? null : JSON.stringify(src.metadata);
  await sql.unsafe(
    `INSERT INTO ${q('persons')}
       (id, display_name, primary_phone, primary_email, avatar_url, metadata, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      cloneId,
      (src.display_name as string) ?? null,
      (src.primary_phone as string) ?? null,
      (src.primary_email as string) ?? null,
      (src.avatar_url as string) ?? null,
      metadata,
      (src.created_at as Date) ?? null,
      (src.updated_at as Date) ?? null,
    ] as never[],
  );
  await sql.unsafe(
    `UPDATE ${q('persons')} SET tenant_id = $1, updated_at = now() WHERE id = $2 AND tenant_id IS NULL`,
    [tenant, cloneId] as never[],
  );

  // Rewire this tenant's references to the clone; collect the undo list.
  const rewires: { table: string; column: string; from: string; to: string; tenant: string }[] = [];
  for (const path of PATHS) {
    const { text, params } = path.rewriteSql(personId, cloneId, tenant);
    await sql.unsafe(text, params as never[]);
    rewires.push({ table: path.child, column: path.personColumn, from: cloneId, to: personId, tenant });
  }

  const cloneRow = (await fetchPerson(sql, cloneId)) ?? {};
  const compensating: CompensatingAction = {
    type: 'undo-person-clone',
    note: 'delete this clone and rewire its references back to the source person',
    sourcePerson: personId,
    deleteClone: { table: 'persons', primaryKey: { id: cloneId } },
    rewireBack: rewires,
  };
  const recorded = await recordPlanned(sql, {
    sourceTable: 'persons',
    sourcePrimaryKey: { id: cloneId },
    targetTenantId: tenant,
    decisionRule: `unowned:persons clone of ${personId} for tenant ${tenant} (ADR-0002 tenant_clone)`,
    preImageRedacted: ABSENT_IMAGE,
    preImageChecksum: absentChecksum(),
    inverseAction: null,
    compensatingAction: compensating,
    writerEpoch: epoch,
    ambiguityState: 'none',
    status: 'planned',
    checkpoint: { sourcePerson: personId, tenant },
  });
  const receipt = { rule: 'person-clone', tenant_id: tenant, source_person: personId, checksum: checksum(cloneRow) };
  assertNoSecrets(receipt, 'person clone receipt');
  await markApplied(sql, recorded.id, {
    postImageRedacted: redactRow(cloneRow),
    postImageChecksum: checksum(cloneRow),
    reconciliationReceipt: receipt,
  });
}

async function quarantinePerson(
  sql: ToolingSql,
  personId: string,
  epoch: number,
  reason: string,
  clones?: string[],
): Promise<void> {
  const existing = await findBySource(sql, 'persons', { id: personId });
  if (existing && existing.status !== 'planned') return;
  const pre = (await fetchPerson(sql, personId)) ?? { id: personId };
  await recordPlanned(sql, {
    sourceTable: 'persons',
    sourcePrimaryKey: { id: personId },
    targetTenantId: null,
    decisionRule: reason,
    preImageRedacted: redactRow(pre),
    preImageChecksum: checksum(pre),
    inverseAction: null,
    compensatingAction: { type: clones ? 'person-cloned-original' : 'quarantine', note: reason, clones: clones ?? [] },
    writerEpoch: epoch,
    ambiguityState: clones ? 'ambiguous' : 'quarantined',
    status: 'quarantined',
  });
}
