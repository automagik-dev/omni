#!/usr/bin/env bun
/**
 * Backfill Phone Cleanup
 *
 * Fixes person phone data:
 * 1. Nulls invalid phones (group IDs, LIDs, Meta IDs stored as phone)
 * 2. Backfills phones from WhatsApp platform_identities for phoneless persons
 * 3. Adds E.164 '+' prefix to bare-digit phones
 * 4. Merges duplicate persons with the same phone number
 *
 * Usage:
 *   bun scripts/backfill-phone-cleanup.ts --dry-run    # Preview changes
 *   bun scripts/backfill-phone-cleanup.ts              # Apply changes
 */

import { and, eq, isNull, sql } from '../packages/db/node_modules/drizzle-orm';
import { chatParticipants, closeDb, getDb, messages, persons, platformIdentities } from '../packages/db/src/index';

const DRY_RUN = process.argv.includes('--dry-run');
const db = getDb();

async function main() {
  console.log(`Phone Cleanup Backfill ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  console.log('='.repeat(60));

  // Step 1: Clean invalid phones → NULL
  await cleanInvalidPhones();

  // Step 2: Backfill phones from platform_identities
  await backfillPhonesFromIdentities();

  // Step 3: Add E.164 '+' prefix
  await addE164Prefix();

  // Step 4: Merge duplicate persons
  await mergeDuplicatePersons();

  // Summary
  await printSummary();

  console.log('\nDone!');
  closeDb();
}

/**
 * Step 1: Null out invalid phones (group IDs, LID refs, Meta IDs, etc.)
 * Valid phones: only digits (optionally with leading +), 7-15 digit length
 */
async function cleanInvalidPhones() {
  console.log('\n--- Step 1: Clean invalid phones → NULL ---');

  // Find persons with invalid phone numbers
  const invalidPhones = await db
    .select({ id: persons.id, phone: persons.primaryPhone })
    .from(persons)
    .where(
      and(
        sql`${persons.primaryPhone} IS NOT NULL`,
        sql`(
          ${persons.primaryPhone} ~ '[^0-9+]'
          OR length(replace(${persons.primaryPhone}, '+', '')) < 7
          OR length(replace(${persons.primaryPhone}, '+', '')) > 15
        )`,
      ),
    );

  console.log(`Found ${invalidPhones.length} persons with invalid phone numbers`);

  for (const p of invalidPhones) {
    console.log(`  ${p.id.slice(0, 8)}...: "${p.phone}" → NULL`);
  }

  if (!DRY_RUN && invalidPhones.length > 0) {
    const result = await db
      .update(persons)
      .set({ primaryPhone: null, updatedAt: new Date() })
      .where(
        and(
          sql`${persons.primaryPhone} IS NOT NULL`,
          sql`(
            ${persons.primaryPhone} ~ '[^0-9+]'
            OR length(replace(${persons.primaryPhone}, '+', '')) < 7
            OR length(replace(${persons.primaryPhone}, '+', '')) > 15
          )`,
        ),
      )
      .returning({ id: persons.id });
    console.log(`Cleaned ${result.length} invalid phone numbers`);
  }
}

/**
 * Step 2: Backfill phones from platform_identities for phoneless persons.
 * If a person has a WhatsApp identity with a valid phone-like platformUserId,
 * set it as their primaryPhone.
 */
async function backfillPhonesFromIdentities() {
  console.log('\n--- Step 2: Backfill phones from platform_identities ---');

  // Find persons without phone that have a WhatsApp identity with digit-only platformUserId
  const candidates = await db
    .select({
      personId: persons.id,
      platformUserId: platformIdentities.platformUserId,
    })
    .from(persons)
    .innerJoin(platformIdentities, eq(platformIdentities.personId, persons.id))
    .where(
      and(
        isNull(persons.primaryPhone),
        sql`${platformIdentities.channel} LIKE 'whatsapp%'`,
        sql`${platformIdentities.platformUserId} ~ '^[0-9]{7,15}$'`,
      ),
    );

  console.log(`Found ${candidates.length} persons to backfill phones for`);

  let updated = 0;
  for (const c of candidates) {
    const phone = `+${c.platformUserId}`;
    console.log(`  ${c.personId.slice(0, 8)}...: NULL → "${phone}"`);

    if (!DRY_RUN) {
      try {
        const [result] = await db
          .update(persons)
          .set({ primaryPhone: phone, updatedAt: new Date() })
          .where(and(eq(persons.id, c.personId), isNull(persons.primaryPhone)))
          .returning({ id: persons.id });
        if (result) updated++;
      } catch {
        // Skip conflicts (another person already has this phone)
        console.log(`    Skipped (conflict): phone ${phone} already assigned`);
      }
    } else {
      updated++;
    }
  }

  console.log(`Backfilled ${updated}/${candidates.length} phone numbers`);
}

/**
 * Step 3: Add E.164 '+' prefix to phones that are bare digits.
 */
async function addE164Prefix() {
  console.log('\n--- Step 3: Add E.164 "+" prefix ---');

  const bareDigitPhones = await db
    .select({ id: persons.id, phone: persons.primaryPhone })
    .from(persons)
    .where(
      and(
        sql`${persons.primaryPhone} IS NOT NULL`,
        sql`${persons.primaryPhone} NOT LIKE '+%'`,
        sql`${persons.primaryPhone} ~ '^[0-9]{7,15}$'`,
      ),
    );

  console.log(`Found ${bareDigitPhones.length} phones without '+' prefix`);

  for (const p of bareDigitPhones) {
    console.log(`  ${p.id.slice(0, 8)}...: "${p.phone}" → "+${p.phone}"`);
  }

  if (!DRY_RUN && bareDigitPhones.length > 0) {
    const result = await db
      .update(persons)
      .set({
        primaryPhone: sql`'+' || ${persons.primaryPhone}`,
        updatedAt: new Date(),
      })
      .where(
        and(
          sql`${persons.primaryPhone} IS NOT NULL`,
          sql`${persons.primaryPhone} NOT LIKE '+%'`,
          sql`${persons.primaryPhone} ~ '^[0-9]{7,15}$'`,
        ),
      )
      .returning({ id: persons.id });
    console.log(`Prefixed ${result.length} phone numbers`);
  }
}

/**
 * Step 4: Merge duplicate persons with the same primaryPhone.
 * Keep the oldest (first-created), move identities from newer ones.
 */
async function mergeDuplicatePersons() {
  console.log('\n--- Step 4: Merge duplicate persons ---');

  // Find phones with multiple persons
  const duplicates = await db
    .select({
      phone: persons.primaryPhone,
      count: sql<number>`count(*)::int`,
      ids: sql<string[]>`array_agg(${persons.id} ORDER BY ${persons.createdAt})`,
    })
    .from(persons)
    .where(sql`${persons.primaryPhone} IS NOT NULL`)
    .groupBy(persons.primaryPhone)
    .having(sql`count(*) > 1`);

  console.log(`Found ${duplicates.length} duplicate phone groups`);

  let totalMerged = 0;
  for (const dup of duplicates) {
    const [keepId, ...removeIds] = dup.ids;
    console.log(`  Phone ${dup.phone}: keep=${keepId?.slice(0, 8)}..., merge ${removeIds.length} duplicates`);

    if (!DRY_RUN && keepId) {
      for (const removeId of removeIds) {
        // Move platform_identities to keep person
        await db
          .update(platformIdentities)
          .set({ personId: keepId, linkedBy: 'phone_match', linkReason: 'Phone dedup merge', updatedAt: new Date() })
          .where(eq(platformIdentities.personId, removeId));

        // Move chat_participants to keep person
        await db
          .update(chatParticipants)
          .set({ personId: keepId, updatedAt: new Date() })
          .where(eq(chatParticipants.personId, removeId));

        // Update messages sender references
        await db.update(messages).set({ senderPersonId: keepId }).where(eq(messages.senderPersonId, removeId));

        // Delete the duplicate person
        await db.delete(persons).where(eq(persons.id, removeId));
        totalMerged++;
      }
    } else {
      totalMerged += removeIds.length;
    }
  }

  console.log(`Merged ${totalMerged} duplicate persons`);
}

/**
 * Print final summary statistics
 */
async function printSummary() {
  console.log('\n--- Summary ---');

  const [stats] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withPhone: sql<number>`count(${persons.primaryPhone})::int`,
      withE164: sql<number>`count(CASE WHEN ${persons.primaryPhone} LIKE '+%' THEN 1 END)::int`,
      withoutPhone: sql<number>`count(CASE WHEN ${persons.primaryPhone} IS NULL THEN 1 END)::int`,
    })
    .from(persons);

  if (stats) {
    console.log(`  Total persons: ${stats.total}`);
    console.log(`  With phone: ${stats.withPhone} (${stats.withE164} E.164)`);
    console.log(`  Without phone: ${stats.withoutPhone}`);
  }

  // Check for remaining duplicates
  const [dupCheck] = await db
    .select({
      dupCount: sql<number>`count(*)::int`,
    })
    .from(
      db
        .select({
          phone: persons.primaryPhone,
          cnt: sql<number>`count(*)::int`,
        })
        .from(persons)
        .where(sql`${persons.primaryPhone} IS NOT NULL`)
        .groupBy(persons.primaryPhone)
        .having(sql`count(*) > 1`)
        .as('dups'),
    );

  if (dupCheck) {
    console.log(`  Remaining duplicate phone groups: ${dupCheck.dupCount}`);
  }
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  closeDb();
  process.exit(1);
});
