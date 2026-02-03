#!/usr/bin/env bun
/**
 * Backfill script: Link chat_participants to platform_identities
 *
 * This script finds chat_participants that are missing personId or platformIdentityId
 * and links them to existing platform_identities based on platformUserId.
 *
 * Usage:
 *   cd packages/db && bun run scripts/backfill-participant-identities.ts [--dry-run]
 *
 * Or from root:
 *   bun run packages/db/scripts/backfill-participant-identities.ts --dry-run
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import { chatParticipants, chats, createDb, platformIdentities } from '../src';

const db = createDb();
const isDryRun = process.argv.includes('--dry-run');

async function backfillParticipantIdentities() {
  console.log(`\n🔗 Backfill Participant Identities ${isDryRun ? '(DRY RUN)' : ''}\n`);

  // Find participants missing identity links
  const missingIdentities = await db
    .select({
      participantId: chatParticipants.id,
      chatId: chatParticipants.chatId,
      platformUserId: chatParticipants.platformUserId,
      displayName: chatParticipants.displayName,
      existingPersonId: chatParticipants.personId,
      existingIdentityId: chatParticipants.platformIdentityId,
    })
    .from(chatParticipants)
    .where(or(isNull(chatParticipants.personId), isNull(chatParticipants.platformIdentityId)));

  console.log(`Found ${missingIdentities.length} participants missing identity links\n`);

  if (missingIdentities.length === 0) {
    console.log('✅ All participants already have identity links');
    return;
  }

  // Get unique chat IDs
  const _chatIds = [...new Set(missingIdentities.map((p) => p.chatId))];

  // Get chat → instance mapping
  const chatInstances = await db
    .select({
      chatId: chats.id,
      instanceId: chats.instanceId,
      channel: chats.channel,
    })
    .from(chats);

  // Create lookup map
  const chatToInstance = new Map(
    chatInstances.map((c) => [c.chatId, { instanceId: c.instanceId, channel: c.channel }]),
  );

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const participant of missingIdentities) {
    const chatInfo = chatToInstance.get(participant.chatId);
    if (!chatInfo) {
      console.log(`  ⚠️  Chat not found for participant ${participant.participantId}`);
      skipped++;
      continue;
    }

    // Look up platform identity
    const [identity] = await db
      .select({
        id: platformIdentities.id,
        personId: platformIdentities.personId,
      })
      .from(platformIdentities)
      .where(
        and(
          eq(platformIdentities.channel, chatInfo.channel),
          eq(platformIdentities.instanceId, chatInfo.instanceId),
          eq(platformIdentities.platformUserId, participant.platformUserId),
        ),
      )
      .limit(1);

    if (!identity) {
      // No identity found - will be created on next message
      notFound++;
      continue;
    }

    const updates: { personId?: string; platformIdentityId?: string } = {};
    if (!participant.existingPersonId && identity.personId) {
      updates.personId = identity.personId;
    }
    if (!participant.existingIdentityId) {
      updates.platformIdentityId = identity.id;
    }

    if (Object.keys(updates).length === 0) {
      skipped++;
      continue;
    }

    if (isDryRun) {
      console.log(`  Would update participant ${participant.participantId}:`, updates);
    } else {
      await db
        .update(chatParticipants)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(chatParticipants.id, participant.participantId));
    }

    updated++;
  }

  console.log('\n📊 Results:');
  console.log(`   Updated:   ${updated}`);
  console.log(`   Skipped:   ${skipped}`);
  console.log(`   No match:  ${notFound} (will be linked on next message)`);

  if (isDryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Backfill complete');
  }
}

backfillParticipantIdentities()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  });
