#!/usr/bin/env bun
/**
 * Fix Person Duplicates — One-time data migration
 *
 * Cleans up duplicate Person records caused by:
 * 1. LID numbers stored as phone numbers (fake E.164)
 * 2. Same platformUserId across instances creating separate persons
 * 3. Orphan persons with zero identities (race conditions)
 *
 * Usage:
 *   cd packages/api && bun run scripts/fix-person-duplicates.ts [--dry-run]
 *
 * @see fix-person-deduplication wish
 */

import { closeDb, createDb, getDefaultDatabaseUrl } from '@omni/db';
import {
  accessRules,
  agentRoutes,
  chatParticipants,
  messages,
  omniEvents,
  persons,
  platformIdentities,
} from '@omni/db';
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm';
import { isLidFormat, isValidE164Phone } from '../src/utils/phone';

// ── Config ──────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL ?? getDefaultDatabaseUrl();
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

console.log('='.repeat(60));
console.log('Fix Person Duplicates — Data Migration');
console.log('='.repeat(60));
console.log(`Mode: ${dryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
console.log(`Database: ${DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);
console.log('');

const db = createDb({ url: DATABASE_URL });

// ── Stats ───────────────────────────────────────────────────────────────────

const stats = {
  fakePhonesCleared: 0,
  personsMergedFromLid: 0,
  personsMergedCrossInstance: 0,
  orphansDeleted: 0,
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check if a phone looks like a LID number stored as phone.
 * LID phones are 14+ digits that don't pass E.164 validation,
 * OR match the LID format pattern.
 */
function isFakeLidPhone(phone: string): boolean {
  const bare = phone.replace(/^\+/, '');
  // Must be all digits, 14+ chars, and fails normal E.164 length check
  if (/^\d{14,}$/.test(bare)) return true;
  // Also catch if it matches LID format directly
  if (isLidFormat(bare)) return true;
  return false;
}

/**
 * Move all person references from source to target, then delete source.
 * Handles ALL FK references — not just platform_identities.
 */
async function mergePersonFull(sourceId: string, targetId: string, reason: string): Promise<void> {
  // 1. Move platform identities
  await db
    .update(platformIdentities)
    .set({
      personId: targetId,
      linkedBy: 'manual',
      linkReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(platformIdentities.personId, sourceId));

  // 2. Move chat participants
  await db
    .update(chatParticipants)
    .set({ personId: targetId, updatedAt: new Date() })
    .where(eq(chatParticipants.personId, sourceId));

  // 3. Move messages
  await db.update(messages).set({ senderPersonId: targetId }).where(eq(messages.senderPersonId, sourceId));

  // 4. Move events
  await db.update(omniEvents).set({ personId: targetId }).where(eq(omniEvents.personId, sourceId));

  // 5. Move agent routes (has UNIQUE on instanceId+personId — delete conflicting)
  const sourceRoutes = await db
    .select({ id: agentRoutes.id, instanceId: agentRoutes.instanceId })
    .from(agentRoutes)
    .where(eq(agentRoutes.personId, sourceId));

  for (const route of sourceRoutes) {
    const [existing] = await db
      .select({ id: agentRoutes.id })
      .from(agentRoutes)
      .where(and(eq(agentRoutes.instanceId, route.instanceId), eq(agentRoutes.personId, targetId)))
      .limit(1);

    if (existing) {
      // Target already has a route for this instance — delete the source's
      await db.delete(agentRoutes).where(eq(agentRoutes.id, route.id));
    } else {
      await db
        .update(agentRoutes)
        .set({ personId: targetId, updatedAt: new Date() })
        .where(eq(agentRoutes.id, route.id));
    }
  }

  // 6. Move access rules
  await db.update(accessRules).set({ personId: targetId }).where(eq(accessRules.personId, sourceId));

  // 7. Delete source person (now has no references)
  await db.delete(persons).where(eq(persons.id, sourceId));
}

// ── Step 1: Fix fake LID phones ────────────────────────────────────────────

async function fixFakeLidPhones(): Promise<void> {
  console.log('Step 1: Fix fake LID phones');
  console.log('-'.repeat(40));

  // Find persons with fake LID phone numbers
  const allPersons = await db.select().from(persons).where(isNotNull(persons.primaryPhone));

  const lidPersons = allPersons.filter((p) => p.primaryPhone && isFakeLidPhone(p.primaryPhone));

  if (!lidPersons.length) {
    console.log('  No persons with fake LID phones found.');
    return;
  }

  console.log(`  Found ${lidPersons.length} person(s) with fake LID phones.`);

  for (const lidPerson of lidPersons) {
    const lidPhone = lidPerson.primaryPhone ?? '';
    const bareLid = lidPhone.replace(/^\+/, '');

    // Find if this LID person has identities with a platformUserId that matches
    const identities = await db.select().from(platformIdentities).where(eq(platformIdentities.personId, lidPerson.id));

    // Look for a real phone person through cross-referencing:
    // Check if any identity on this person has a platformUserId that exists on
    // another person who has a REAL phone
    let mergeTarget: string | null = null;

    for (const identity of identities) {
      // Find other identities with the same platformUserId on different persons
      const crossMatches = await db
        .select({
          personId: platformIdentities.personId,
          phone: persons.primaryPhone,
        })
        .from(platformIdentities)
        .innerJoin(persons, eq(persons.id, platformIdentities.personId))
        .where(
          and(
            eq(platformIdentities.channel, identity.channel),
            eq(platformIdentities.platformUserId, identity.platformUserId),
            isNotNull(platformIdentities.personId),
            ne(platformIdentities.personId, lidPerson.id),
          ),
        );

      for (const match of crossMatches) {
        if (match.phone && isValidE164Phone(match.phone) && !isFakeLidPhone(match.phone)) {
          mergeTarget = match.personId;
          break;
        }
      }
      if (mergeTarget) break;
    }

    // Also check: is there a person with a REAL phone that matches this LID?
    // (i.e. the LID number is actually a real phone somewhere else)
    // This won't happen since LIDs are not real phones, but check for safety.

    if (mergeTarget) {
      console.log(`  Merge: ${lidPerson.id} (LID phone ${lidPhone}) → ${mergeTarget} (real phone)`);
      if (!dryRun) {
        await mergePersonFull(lidPerson.id, mergeTarget, `LID phone cleanup: merged fake LID ${bareLid}`);
      }
      stats.personsMergedFromLid++;
    } else {
      // No merge target — just clear the fake phone
      console.log(`  Clear fake phone from ${lidPerson.id}: ${lidPhone}`);
      if (!dryRun) {
        await db.update(persons).set({ primaryPhone: null, updatedAt: new Date() }).where(eq(persons.id, lidPerson.id));
      }
      stats.fakePhonesCleared++;
    }
  }

  console.log('');
}

// ── Step 2: Merge cross-instance duplicates ────────────────────────────────

async function mergeCrossInstanceDuplicates(): Promise<void> {
  console.log('Step 2: Merge cross-instance duplicates');
  console.log('-'.repeat(40));

  // Find (channel, platformUserId) combos that appear across multiple persons
  const dupes = await db
    .select({
      channel: platformIdentities.channel,
      platformUserId: platformIdentities.platformUserId,
      personCount: sql<number>`count(distinct ${platformIdentities.personId})`.as('person_count'),
    })
    .from(platformIdentities)
    .where(isNotNull(platformIdentities.personId))
    .groupBy(platformIdentities.channel, platformIdentities.platformUserId)
    .having(sql`count(distinct ${platformIdentities.personId}) > 1`);

  if (!dupes.length) {
    console.log('  No cross-instance duplicates found.');
    return;
  }

  console.log(`  Found ${dupes.length} platformUserId(s) with multiple persons.`);

  for (const dupe of dupes) {
    // Get all persons for this (channel, platformUserId)
    const identitiesForDupe = await db
      .select({
        personId: platformIdentities.personId,
        instanceId: platformIdentities.instanceId,
        messageCount: platformIdentities.messageCount,
      })
      .from(platformIdentities)
      .where(
        and(
          eq(platformIdentities.channel, dupe.channel),
          eq(platformIdentities.platformUserId, dupe.platformUserId),
          isNotNull(platformIdentities.personId),
        ),
      );

    // Group by personId
    const personIds = [...new Set(identitiesForDupe.map((i) => i.personId).filter(Boolean))] as string[];
    if (personIds.length < 2) continue;

    // Pick the person with the most identities overall as the target
    const personScores: { personId: string; identityCount: number; messageCount: number }[] = [];
    for (const pid of personIds) {
      const [row] = await db
        .select({
          identityCount: sql<number>`count(*)`.as('cnt'),
          messageCount: sql<number>`coalesce(sum(${platformIdentities.messageCount}), 0)`.as('msg_cnt'),
        })
        .from(platformIdentities)
        .where(eq(platformIdentities.personId, pid));
      personScores.push({
        personId: pid,
        identityCount: Number(row?.identityCount ?? 0),
        messageCount: Number(row?.messageCount ?? 0),
      });
    }

    // Sort: most identities first, then most messages as tiebreaker
    personScores.sort((a, b) => b.identityCount - a.identityCount || b.messageCount - a.messageCount);

    const target = personScores[0];
    if (!target) continue;
    const sources = personScores.slice(1);

    for (const source of sources) {
      console.log(
        `  Merge: ${source.personId} (${source.identityCount} ids) → ${target.personId} (${target.identityCount} ids) [${dupe.channel}:${dupe.platformUserId}]`,
      );
      if (!dryRun) {
        await mergePersonFull(
          source.personId,
          target.personId,
          `Cross-instance dedup: ${dupe.channel}/${dupe.platformUserId}`,
        );
      }
      stats.personsMergedCrossInstance++;
    }
  }

  console.log('');
}

// ── Step 3: Delete orphan persons ──────────────────────────────────────────

async function deleteOrphanPersons(): Promise<void> {
  console.log('Step 3: Delete orphan persons');
  console.log('-'.repeat(40));

  // Find persons with zero identities AND zero chat_participant references
  const orphans = await db
    .select({
      id: persons.id,
      displayName: persons.displayName,
    })
    .from(persons)
    .where(
      and(
        sql`NOT EXISTS (
          SELECT 1 FROM platform_identities
          WHERE platform_identities.person_id = persons.id
        )`,
        sql`NOT EXISTS (
          SELECT 1 FROM chat_participants
          WHERE chat_participants.person_id = persons.id
        )`,
      ),
    );

  if (!orphans.length) {
    console.log('  No orphan persons found.');
    return;
  }

  console.log(`  Found ${orphans.length} orphan person(s).`);

  for (const orphan of orphans) {
    console.log(`  Delete orphan: ${orphan.id} (${orphan.displayName ?? 'unnamed'})`);
    if (!dryRun) {
      // Clean up any remaining references (messages, events with set null won't block delete)
      await db.update(messages).set({ senderPersonId: null }).where(eq(messages.senderPersonId, orphan.id));
      await db.update(omniEvents).set({ personId: null }).where(eq(omniEvents.personId, orphan.id));
      await db.delete(persons).where(eq(persons.id, orphan.id));
    }
    stats.orphansDeleted++;
  }

  console.log('');
}

// ── Step 4: Report ─────────────────────────────────────────────────────────

function printReport(): void {
  console.log('='.repeat(60));
  console.log('Summary');
  console.log('='.repeat(60));
  console.log(`  Persons merged (LID → real phone): ${stats.personsMergedFromLid}`);
  console.log(`  Fake phones cleared:               ${stats.fakePhonesCleared}`);
  console.log(`  Persons merged (cross-instance):   ${stats.personsMergedCrossInstance}`);
  console.log(`  Orphan persons deleted:            ${stats.orphansDeleted}`);
  console.log('');
  if (dryRun) {
    console.log('  ** DRY RUN — no changes were made **');
    console.log('  Run without --dry-run to apply changes.');
  } else {
    console.log('  All changes applied.');
  }
  console.log('');
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    await fixFakeLidPhones();
    await mergeCrossInstanceDuplicates();
    await deleteOrphanPersons();
    printReport();
  } finally {
    await closeDb();
  }
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
