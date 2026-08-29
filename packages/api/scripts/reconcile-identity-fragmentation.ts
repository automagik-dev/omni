#!/usr/bin/env bun
/**
 * Reconcile Identity Fragmentation — one-time DATA reconciliation (no DDL).
 *
 * P0 canonicalization (see `packages/api/src/utils/canonical-handle.ts`) stops
 * NEW duplicates. This script repairs the EXISTING fragmentation it leaves
 * behind, in two idempotent passes:
 *
 *   1. DEDUPE fragmented identities — for each (channel, instance, canonical
 *      number) where the same WhatsApp number exists under more than one handle
 *      spelling (bare `5511…`, `5511…@s.whatsapp.net`, device-suffixed
 *      `5511…:3@s.whatsapp.net`), merge to the ONE canonical identity, re-point
 *      its messages/participants/events, and merge the duplicate persons
 *      (fields coalesced, the OLDEST person survives).
 *
 *   2. BACKFILL phone-less persons — for a `@lid` identity whose phone is already
 *      known via `chat_id_mappings` (lid_id → phone_id), set the person's
 *      `primary_phone`; if a person with that phone already exists, merge into it
 *      instead (again coalescing, oldest survives).
 *
 * SAFETY — DRY RUN BY DEFAULT. With no flag this prints a report (counts +
 * samples) and MUTATES NOTHING. Only `--apply` performs writes, and only against
 * whatever `DATABASE_URL` points at. Never run `--apply` against a shared or
 * production database without an explicit, human-approved plan and a backup.
 *
 * Usage:
 *   cd packages/api && bun run scripts/reconcile-identity-fragmentation.ts            # DRY RUN
 *   cd packages/api && DATABASE_URL=… bun run scripts/reconcile-identity-fragmentation.ts --apply
 *
 * @see omni identity rework, P0
 */

import { closeDb, createDb, getDefaultDatabaseUrl } from '@omni/db';
import {
  type Database,
  chatIdMappings,
  chatParticipants,
  messages,
  omniEvents,
  persons,
  platformIdentities,
} from '@omni/db';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { canonicalizeHandle, isWhatsAppFamily } from '../src/utils/canonical-handle';

// ── Config ──────────────────────────────────────────────────────────────────
//
// NOTE: the database URL is resolved lazily inside `main()`, never at module
// load — `getDefaultDatabaseUrl()` throws when DATABASE_URL is unset, and the
// dry-run test imports `reconcile()` (which takes an explicit handle) without a
// DATABASE_URL in the environment.

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dryRun = !apply;
const sampleLimit = 10;

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * A pool handle OR an open transaction. Drizzle's `db.transaction(fn)` hands the
 * callback a distinct tx handle whose type differs from the pool's, yet both
 * expose the same query-builder surface these helpers use. Typing the mutation
 * helpers against this union lets the per-group work run atomically inside a
 * transaction without duplicating them.
 */
type TxHandle = Parameters<Parameters<Database['transaction']>[0]>[0];
type DbHandle = Database | TxHandle;

interface IdentityRow {
  id: string;
  channel: string;
  instanceId: string | null;
  platformUserId: string;
  personId: string | null;
  createdAt: Date;
}

interface Stats {
  fragmentGroups: number;
  identitiesMerged: number;
  personsMerged: number;
  phonesBackfilled: number;
  phonelessMergedIntoPhonePerson: number;
}

const stats: Stats = {
  fragmentGroups: 0,
  identitiesMerged: 0,
  personsMerged: 0,
  phonesBackfilled: 0,
  phonelessMergedIntoPhonePerson: 0,
};

const samples: string[] = [];
function sample(line: string): void {
  if (samples.length < sampleLimit) samples.push(line);
}

// ── Person merge (coalesce fields, oldest survives) ─────────────────────────

/**
 * Merge `sourceId` into `targetId`: move every FK reference off the source,
 * delete it, then coalesce its fields onto the target (never dropping a
 * phone/name/email/avatar the source had and the target lacked). No-op when
 * equal.
 *
 * ORDER MATTERS. The coalesce write must land AFTER the source row is gone:
 * `persons.primary_phone` carries a unique index, so setting the target's phone
 * to the source's value while the source still holds it would trip a transient
 * unique violation. The whole merge runs in one transaction — a savepoint when
 * the caller already gave us a transaction handle — so it is atomic whether
 * invoked standalone (Step 2) or inside a group's transaction (Step 1).
 */
async function mergePersons(db: DbHandle, sourceId: string, targetId: string, reason: string): Promise<void> {
  if (sourceId === targetId) return;

  const [source] = await db.select().from(persons).where(eq(persons.id, sourceId)).limit(1);
  const [target] = await db.select().from(persons).where(eq(persons.id, targetId)).limit(1);
  if (!source || !target) return;

  await db.transaction(async (tx) => {
    // Move platform identities, participants, messages, events off the source.
    await tx
      .update(platformIdentities)
      .set({ personId: targetId, linkedBy: 'manual', linkReason: reason, updatedAt: new Date() })
      .where(eq(platformIdentities.personId, sourceId));
    await tx
      .update(chatParticipants)
      .set({ personId: targetId, updatedAt: new Date() })
      .where(eq(chatParticipants.personId, sourceId));
    await tx.update(messages).set({ senderPersonId: targetId }).where(eq(messages.senderPersonId, sourceId));
    await tx.update(omniEvents).set({ personId: targetId }).where(eq(omniEvents.personId, sourceId));

    // Delete the source BEFORE writing coalesced values onto the target, so the
    // unique columns (primary_phone) are never held by two rows at once.
    await tx.delete(persons).where(eq(persons.id, sourceId));

    // Coalesce: keep the target's value, fall back to the source's.
    await tx
      .update(persons)
      .set({
        displayName: target.displayName ?? source.displayName,
        primaryPhone: target.primaryPhone ?? source.primaryPhone,
        primaryEmail: target.primaryEmail ?? source.primaryEmail,
        avatarUrl: target.avatarUrl ?? source.avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(persons.id, targetId));
  });
}

/** Re-point an identity's messages/participants/events, then delete it. */
async function absorbIdentity(db: DbHandle, loserId: string, survivorId: string): Promise<void> {
  await db
    .update(messages)
    .set({ senderPlatformIdentityId: survivorId })
    .where(eq(messages.senderPlatformIdentityId, loserId));
  await db
    .update(chatParticipants)
    .set({ platformIdentityId: survivorId, updatedAt: new Date() })
    .where(eq(chatParticipants.platformIdentityId, loserId));
  await db.update(omniEvents).set({ platformIdentityId: survivorId }).where(eq(omniEvents.platformIdentityId, loserId));
  await db.delete(platformIdentities).where(eq(platformIdentities.id, loserId));
}

/** The oldest person id among a set, or undefined when none have persons. */
async function oldestPersonId(db: DbHandle, personIds: string[]): Promise<string | undefined> {
  const ids = [...new Set(personIds)];
  if (ids.length === 0) return undefined;
  const rows = await db
    .select({ id: persons.id })
    .from(persons)
    .where(inArray(persons.id, ids))
    .orderBy(asc(persons.createdAt))
    .limit(1);
  return rows[0]?.id;
}

// ── Step 1: dedupe fragmented identities ────────────────────────────────────

/** Group whatsapp-family identities by (channel, instance, canonical userId). */
function groupByCanonical(rows: IdentityRow[]): Map<string, IdentityRow[]> {
  const groups = new Map<string, IdentityRow[]>();
  for (const row of rows) {
    if (!isWhatsAppFamily(row.channel as Parameters<typeof canonicalizeHandle>[0])) continue;
    const canonicalId = canonicalizeHandle(
      row.channel as Parameters<typeof canonicalizeHandle>[0],
      row.platformUserId,
    ).platformUserId;
    const key = `${row.channel}|${row.instanceId ?? 'null'}|${canonicalId}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

async function reconcileGroup(db: Database, key: string, group: IdentityRow[], applyMode: boolean): Promise<void> {
  const [channel, , canonicalId] = key.split('|');
  // Survivor identity: the one already in canonical form, else the oldest.
  const sorted = [...group].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const survivor = sorted.find((r) => r.platformUserId === canonicalId) ?? sorted[0];
  if (!survivor) return;

  // Person survivor: the OLDEST person across the whole group.
  const personIds = group.map((r) => r.personId).filter((p): p is string => p !== null);
  const survivingPersonId = (await oldestPersonId(db, personIds)) ?? survivor.personId ?? undefined;

  stats.fragmentGroups++;
  sample(`group ${channel}/${canonicalId}: ${group.length} identities → 1 (persons: ${new Set(personIds).size})`);

  if (!applyMode) {
    stats.identitiesMerged += group.length - 1;
    if (new Set(personIds).size > 1) stats.personsMerged += new Set(personIds).size - 1;
    return;
  }

  // ATOMICITY: the whole per-group mutation — every person merge, every identity
  // absorb, and the survivor's canonicalization — runs in ONE transaction. A
  // mid-way failure must roll the entire group back: idempotency here depends on
  // the fragmentation signal (`length > 1 && spellings > 1`), so a partially
  // applied group (some losers already deleted) would no longer be detected on a
  // re-run, stranding the survivor half-merged / non-canonical forever.
  // Stats are tallied locally and committed only after the transaction succeeds,
  // so a rolled-back group leaves the counters untouched too.
  let personsMerged = 0;
  let identitiesMerged = 0;
  await db.transaction(async (tx) => {
    // Merge every other person into the surviving person first.
    if (survivingPersonId) {
      for (const pid of new Set(personIds)) {
        if (pid !== survivingPersonId) {
          await mergePersons(tx, pid, survivingPersonId, `identity fragmentation dedupe: ${channel}/${canonicalId}`);
          personsMerged++;
        }
      }
    }

    // Absorb every non-survivor identity into the survivor.
    for (const loser of group) {
      if (loser.id !== survivor.id) {
        await absorbIdentity(tx, loser.id, survivor.id);
        identitiesMerged++;
      }
    }

    // Canonicalize the survivor's handle + person link.
    await tx
      .update(platformIdentities)
      .set({ platformUserId: canonicalId, personId: survivingPersonId ?? survivor.personId, updatedAt: new Date() })
      .where(eq(platformIdentities.id, survivor.id));
  });
  stats.personsMerged += personsMerged;
  stats.identitiesMerged += identitiesMerged;
}

async function dedupeFragmentedIdentities(db: Database, applyMode: boolean): Promise<void> {
  process.stdout.write('Step 1: dedupe fragmented identities\n');
  process.stdout.write(`${'-'.repeat(40)}\n`);

  const rows: IdentityRow[] = await db
    .select({
      id: platformIdentities.id,
      channel: platformIdentities.channel,
      instanceId: platformIdentities.instanceId,
      platformUserId: platformIdentities.platformUserId,
      personId: platformIdentities.personId,
      createdAt: platformIdentities.createdAt,
    })
    .from(platformIdentities);

  const groups = groupByCanonical(rows);
  const fragmented = [...groups.entries()].filter(([, g]) => {
    const forms = new Set(g.map((r) => r.platformUserId));
    return g.length > 1 && forms.size > 1; // more than one row AND more than one spelling
  });

  if (fragmented.length === 0) {
    process.stdout.write('  No fragmented identity groups found.\n\n');
    return;
  }
  process.stdout.write(`  Found ${fragmented.length} fragmented group(s).\n`);
  for (const [key, group] of fragmented) await reconcileGroup(db, key, group, applyMode);
  process.stdout.write('\n');
}

// ── Step 2: backfill phone-less persons via chat_id_mappings ────────────────

/** Derive an E.164 phone from a phone JID (`5511…@s.whatsapp.net` → `+5511…`). */
function phoneFromJid(phoneJid: string): string | undefined {
  const digits = phoneJid.replace(/@s\.whatsapp\.net$/, '').replace(/^\+/, '');
  return /^\d{7,15}$/.test(digits) ? `+${digits}` : undefined;
}

async function backfillPhonelessPersons(db: Database, applyMode: boolean): Promise<void> {
  process.stdout.write('Step 2: backfill phone-less persons from chat_id_mappings\n');
  process.stdout.write(`${'-'.repeat(40)}\n`);

  // Candidate identities: @lid handles whose person has no phone yet.
  const candidates: IdentityRow[] = await db
    .select({
      id: platformIdentities.id,
      channel: platformIdentities.channel,
      instanceId: platformIdentities.instanceId,
      platformUserId: platformIdentities.platformUserId,
      personId: platformIdentities.personId,
      createdAt: platformIdentities.createdAt,
    })
    .from(platformIdentities);

  let handled = 0;
  for (const identity of candidates) {
    if (!identity.personId || !identity.instanceId) continue;
    if (!identity.platformUserId.endsWith('@lid')) continue;

    const [person] = await db.select().from(persons).where(eq(persons.id, identity.personId)).limit(1);
    if (!person || person.primaryPhone) continue;

    const [mapping] = await db
      .select({ phoneId: chatIdMappings.phoneId })
      .from(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, identity.instanceId), eq(chatIdMappings.lidId, identity.platformUserId)))
      .limit(1);
    if (!mapping) continue;

    const phone = phoneFromJid(mapping.phoneId);
    if (!phone) continue;

    handled++;
    // Does a person with this phone already exist? If so, merge into it.
    const [existingPhonePerson] = await db.select().from(persons).where(eq(persons.primaryPhone, phone)).limit(1);

    if (existingPhonePerson && existingPhonePerson.id !== person.id) {
      // Oldest survives — same rule as Step 1. Merge the YOUNGER of the two into
      // the OLDER, rather than always keeping the phone-person: keeping the
      // phone-person regardless of age would delete an older @lid person and
      // rewrite its createdAt/id, contradicting Step 1's oldest-survives choice.
      const survivorId = (await oldestPersonId(db, [person.id, existingPhonePerson.id])) ?? existingPhonePerson.id;
      const loserId = survivorId === person.id ? existingPhonePerson.id : person.id;
      sample(`backfill: person ${loserId} merges into older person ${survivorId} (${phone})`);
      stats.phonelessMergedIntoPhonePerson++;
      if (applyMode) await mergePersons(db, loserId, survivorId, `lid phone backfill merge ${phone}`);
    } else {
      sample(`backfill: set person ${person.id}.primary_phone = ${phone}`);
      stats.phonesBackfilled++;
      if (applyMode)
        await db.update(persons).set({ primaryPhone: phone, updatedAt: new Date() }).where(eq(persons.id, person.id));
    }
  }

  if (handled === 0) process.stdout.write('  No phone-less persons with a known mapping found.\n');
  process.stdout.write('\n');
}

// ── Report ──────────────────────────────────────────────────────────────────

function printReport(): void {
  process.stdout.write(`${'='.repeat(60)}\n`);
  process.stdout.write('Summary\n');
  process.stdout.write(`${'='.repeat(60)}\n`);
  process.stdout.write(`  Fragmented identity groups:        ${stats.fragmentGroups}\n`);
  process.stdout.write(`  Identities merged away:            ${stats.identitiesMerged}\n`);
  process.stdout.write(`  Persons merged:                    ${stats.personsMerged}\n`);
  process.stdout.write(`  Phones backfilled (set on person): ${stats.phonesBackfilled}\n`);
  process.stdout.write(`  Phone-less merged into phone-person: ${stats.phonelessMergedIntoPhonePerson}\n`);
  if (samples.length > 0) {
    process.stdout.write('\n  Sample actions:\n');
    for (const line of samples) process.stdout.write(`    - ${line}\n`);
  }
  process.stdout.write('\n');
  if (dryRun) {
    process.stdout.write('  ** DRY RUN — no changes were made. Re-run with --apply to mutate. **\n');
  } else {
    process.stdout.write('  All changes applied.\n');
  }
  process.stdout.write('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────

/** Options for {@link reconcile}. `apply` defaults to the process-level flag. */
export interface ReconcileOptions {
  /** When true, perform writes; when false (default outside `--apply`), dry-run. */
  apply?: boolean;
}

/**
 * Exported for tests; runs both passes against the given handle.
 *
 * `apply` defaults to the module-level flag derived from `--apply`, so `main()`
 * behaves exactly as before. Tests pass `{ apply: true }` explicitly to exercise
 * the write path against a disposable database.
 */
export async function reconcile(db: Database, opts: ReconcileOptions = {}): Promise<Stats> {
  const applyMode = opts.apply ?? apply;
  await dedupeFragmentedIdentities(db, applyMode);
  await backfillPhonelessPersons(db, applyMode);
  return stats;
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL ?? getDefaultDatabaseUrl();
  process.stdout.write(`${'='.repeat(60)}\n`);
  process.stdout.write('Reconcile Identity Fragmentation — Data Reconciliation\n');
  process.stdout.write(`${'='.repeat(60)}\n`);
  process.stdout.write(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'APPLY (LIVE)'}\n`);
  process.stdout.write(`Database: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}\n\n`);

  const db = createDb({ url: databaseUrl });
  try {
    await reconcile(db);
    printReport();
  } finally {
    await closeDb();
  }
}

// Only run when invoked directly (not when imported by the test).
if (import.meta.main) {
  main().catch((err) => {
    process.stderr.write(`Reconciliation failed: ${err}\n`);
    process.exit(1);
  });
}
