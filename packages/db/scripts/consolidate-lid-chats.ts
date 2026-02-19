#!/usr/bin/env bun
/**
 * Phase 4 data migration: Consolidate LID/phone JID duplicate chats
 *
 * Before Phase 3 added the unique constraint on (instance_id, canonical_id),
 * WhatsApp could create two separate chats for the same contact:
 *   - Phone chat: external_id = "553496835777@s.whatsapp.net"
 *   - LID chat:   external_id = "63750317031625@lid", canonical_id = "553496835777@s.whatsapp.net"
 *
 * This script detects these pairs and merges the LID chat into the phone chat:
 *   1. Moves all messages from LID chat → phone chat (deduplicates by external_id)
 *   2. Moves all participants from LID chat → phone chat (deduplicates by platform_user_id)
 *   3. Moves agent routes from LID chat → phone chat (if no conflict)
 *   4. Sums message_count and unread_count, keeps most recent lastMessageAt/Preview
 *   5. Deletes the LID chat
 *
 * Usage:
 *   cd packages/db && bun run scripts/consolidate-lid-chats.ts [--dry-run]
 *
 * Or from root:
 *   bun run packages/db/scripts/consolidate-lid-chats.ts --dry-run
 */

import { and, eq, sql } from 'drizzle-orm';
import { agentRoutes, chatParticipants, chats, createDb } from '../src';

const db = createDb();
const isDryRun = process.argv.includes('--dry-run');

interface DuplicatePair {
  lidId: string;
  lidExternal: string;
  lidCanonical: string;
  lidMsgCount: number;
  lidUnread: number;
  lidLastAt: Date | null;
  lidPreview: string | null;
  phoneId: string;
  phoneExternal: string;
  phoneMsgCount: number;
  phoneUnread: number;
  phoneLastAt: Date | null;
  phonePreview: string | null;
  instanceId: string;
}

interface MergeStats {
  messagesMoved: number;
  messagesDeduped: number;
  participantsMoved: number;
  participantsDeduped: number;
  routesMoved: number;
}

/** Find all LID/phone chat duplicate pairs across all instances */
async function findDuplicates(): Promise<DuplicatePair[]> {
  const rows = await db.execute(sql`
    SELECT
      lid.id                   AS "lidId",
      lid.external_id          AS "lidExternal",
      lid.canonical_id         AS "lidCanonical",
      lid.message_count        AS "lidMsgCount",
      lid.unread_count         AS "lidUnread",
      lid.last_message_at      AS "lidLastAt",
      lid.last_message_preview AS "lidPreview",
      phone.id                 AS "phoneId",
      phone.external_id        AS "phoneExternal",
      phone.message_count      AS "phoneMsgCount",
      phone.unread_count       AS "phoneUnread",
      phone.last_message_at    AS "phoneLastAt",
      phone.last_message_preview AS "phonePreview",
      lid.instance_id          AS "instanceId"
    FROM chats lid
    JOIN chats phone
      ON lid.instance_id = phone.instance_id
     AND lid.canonical_id = phone.external_id
     AND lid.id != phone.id
    WHERE lid.canonical_id IS NOT NULL
    ORDER BY lid.instance_id, lid.external_id
  `);

  return rows as unknown as DuplicatePair[];
}

/** Move messages from LID chat to phone chat, skipping external_id conflicts */
async function mergeMessages(
  lidId: string,
  phoneId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<{ moved: number; deduped: number }> {
  // Find message external_ids that already exist in the phone chat
  const conflictRows = await tx.execute(sql`
    SELECT m_lid.external_id
    FROM messages m_lid
    JOIN messages m_phone ON m_lid.external_id = m_phone.external_id
    WHERE m_lid.chat_id = ${lidId}
      AND m_phone.chat_id = ${phoneId}
  `);
  const conflictIds = new Set((conflictRows as unknown as { external_id: string }[]).map((r) => r.external_id));

  // Move non-conflicting messages
  const moveResult = await tx.execute(sql`
    UPDATE messages
    SET chat_id = ${phoneId}, updated_at = NOW()
    WHERE chat_id = ${lidId}
      AND external_id NOT IN (
        SELECT external_id FROM messages WHERE chat_id = ${phoneId}
      )
  `);

  const moved = (moveResult as unknown as { count: number }).count ?? (moveResult as unknown as unknown[]).length ?? 0;
  const deduped = conflictIds.size;

  // Delete remaining messages in LID chat (the duplicates)
  if (deduped > 0) {
    await tx.execute(sql`DELETE FROM messages WHERE chat_id = ${lidId}`);
  }

  return { moved, deduped };
}

/** Move participants from LID chat to phone chat, skipping platform_user_id conflicts */
async function mergeParticipants(
  lidId: string,
  phoneId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<{ moved: number; deduped: number }> {
  // Find platform_user_ids already in phone chat
  const existingRows = await tx
    .select({ platformUserId: chatParticipants.platformUserId })
    .from(chatParticipants)
    .where(eq(chatParticipants.chatId, phoneId));
  const existingUsers = new Set(existingRows.map((r) => r.platformUserId));

  // Get LID participants
  const lidParticipants = await tx
    .select({ id: chatParticipants.id, platformUserId: chatParticipants.platformUserId })
    .from(chatParticipants)
    .where(eq(chatParticipants.chatId, lidId));

  let moved = 0;
  let deduped = 0;

  for (const participant of lidParticipants) {
    if (existingUsers.has(participant.platformUserId)) {
      // Delete duplicate participant from LID chat
      await tx.delete(chatParticipants).where(eq(chatParticipants.id, participant.id));
      deduped++;
    } else {
      // Move to phone chat
      await tx
        .update(chatParticipants)
        .set({ chatId: phoneId, updatedAt: new Date() })
        .where(eq(chatParticipants.id, participant.id));
      existingUsers.add(participant.platformUserId);
      moved++;
    }
  }

  return { moved, deduped };
}

/** Move agent routes from LID chat to phone chat (if no route already exists for phone chat) */
async function mergeAgentRoutes(
  lidId: string,
  phoneId: string,
  instanceId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
): Promise<{ moved: number }> {
  // Check if phone chat already has a chat-scope route
  const [existing] = await tx
    .select({ id: agentRoutes.id })
    .from(agentRoutes)
    .where(and(eq(agentRoutes.chatId, phoneId), eq(agentRoutes.instanceId, instanceId)))
    .limit(1);

  if (existing) {
    // Phone chat already has a route — delete LID chat route (if any)
    await tx.delete(agentRoutes).where(and(eq(agentRoutes.chatId, lidId), eq(agentRoutes.instanceId, instanceId)));
    return { moved: 0 };
  }

  // Move route from LID chat to phone chat
  const result = await tx
    .update(agentRoutes)
    .set({ chatId: phoneId, updatedAt: new Date() })
    .where(and(eq(agentRoutes.chatId, lidId), eq(agentRoutes.instanceId, instanceId)))
    .returning({ id: agentRoutes.id });

  return { moved: result.length };
}

/** Update phone chat stats by merging in LID chat counts */
async function mergeStats(pair: DuplicatePair, tx: Parameters<Parameters<typeof db.transaction>[0]>[0]): Promise<void> {
  const keepLidPreview =
    pair.lidLastAt && pair.phoneLastAt ? pair.lidLastAt > pair.phoneLastAt : pair.lidLastAt != null;

  await tx
    .update(chats)
    .set({
      messageCount: pair.phoneMsgCount + pair.lidMsgCount,
      unreadCount: pair.phoneUnread + pair.lidUnread,
      lastMessageAt: keepLidPreview ? pair.lidLastAt : pair.phoneLastAt,
      lastMessagePreview: keepLidPreview ? pair.lidPreview : pair.phonePreview,
      updatedAt: new Date(),
    })
    .where(eq(chats.id, pair.phoneId));
}

/** Merge one duplicate pair inside a transaction */
async function mergePair(pair: DuplicatePair): Promise<MergeStats> {
  const stats: MergeStats = {
    messagesMoved: 0,
    messagesDeduped: 0,
    participantsMoved: 0,
    participantsDeduped: 0,
    routesMoved: 0,
  };

  if (isDryRun) {
    // In dry-run, just count without modifying
    const msgCount = await db.execute(sql`SELECT COUNT(*) AS cnt FROM messages WHERE chat_id = ${pair.lidId}`);
    const participantCount = await db.execute(
      sql`SELECT COUNT(*) AS cnt FROM chat_participants WHERE chat_id = ${pair.lidId}`,
    );
    const routeCount = await db.execute(sql`SELECT COUNT(*) AS cnt FROM agent_routes WHERE chat_id = ${pair.lidId}`);
    stats.messagesMoved = Number((msgCount as unknown as Array<{ cnt: string }>)[0]?.cnt ?? 0);
    stats.participantsMoved = Number((participantCount as unknown as Array<{ cnt: string }>)[0]?.cnt ?? 0);
    stats.routesMoved = Number((routeCount as unknown as Array<{ cnt: string }>)[0]?.cnt ?? 0);
    return stats;
  }

  await db.transaction(async (tx) => {
    // 1. Merge stats first (before counts change)
    await mergeStats(pair, tx);

    // 2. Move messages
    const msgResult = await mergeMessages(pair.lidId, pair.phoneId, tx);
    stats.messagesMoved = msgResult.moved;
    stats.messagesDeduped = msgResult.deduped;

    // 3. Move participants
    const partResult = await mergeParticipants(pair.lidId, pair.phoneId, tx);
    stats.participantsMoved = partResult.moved;
    stats.participantsDeduped = partResult.deduped;

    // 4. Move agent routes
    const routeResult = await mergeAgentRoutes(pair.lidId, pair.phoneId, pair.instanceId, tx);
    stats.routesMoved = routeResult.moved;

    // 5. Delete LID chat (cascade deletes any remaining messages/participants/routes)
    await tx.delete(chats).where(eq(chats.id, pair.lidId));
  });

  return stats;
}

async function consolidateLidChats() {
  console.log(`\n🔗 Consolidate LID/Phone Chat Duplicates ${isDryRun ? '(DRY RUN)' : ''}\n`);

  const pairs = await findDuplicates();

  if (pairs.length === 0) {
    console.log('✅ No duplicate LID/phone chat pairs found — nothing to do\n');
    return;
  }

  console.log(`Found ${pairs.length} duplicate pair(s):\n`);

  let totalMessagesMoved = 0;
  let totalMessagesDeduped = 0;
  let totalParticipantsMoved = 0;
  let totalParticipantsDeduped = 0;
  let totalRoutesMoved = 0;
  let errors = 0;

  for (const pair of pairs) {
    console.log(`  📱 LID:   ${pair.lidExternal} (${pair.lidMsgCount} msgs, ${pair.lidUnread} unread)`);
    console.log(`  📞 Phone: ${pair.phoneExternal} (${pair.phoneMsgCount} msgs, ${pair.phoneUnread} unread)`);
    console.log(`     Instance: ${pair.instanceId}`);

    try {
      const stats = await mergePair(pair);
      totalMessagesMoved += stats.messagesMoved;
      totalMessagesDeduped += stats.messagesDeduped;
      totalParticipantsMoved += stats.participantsMoved;
      totalParticipantsDeduped += stats.participantsDeduped;
      totalRoutesMoved += stats.routesMoved;

      console.log(
        `     ${isDryRun ? 'Would merge' : '✓ Merged'}: ${stats.messagesMoved} msgs, ${stats.participantsMoved} participants, ${stats.routesMoved} routes`,
      );
      if (stats.messagesDeduped > 0 || stats.participantsDeduped > 0) {
        console.log(
          `     Skipped (already in phone chat): ${stats.messagesDeduped} msgs, ${stats.participantsDeduped} participants`,
        );
      }
    } catch (err) {
      console.error(`     ❌ Error merging pair: ${String(err)}`);
      errors++;
    }

    console.log();
  }

  console.log('📊 Summary:');
  console.log(`   Pairs processed:      ${pairs.length - errors} / ${pairs.length}`);
  console.log(`   Messages moved:       ${totalMessagesMoved}`);
  console.log(`   Messages deduped:     ${totalMessagesDeduped}`);
  console.log(`   Participants moved:   ${totalParticipantsMoved}`);
  console.log(`   Participants deduped: ${totalParticipantsDeduped}`);
  console.log(`   Agent routes moved:   ${totalRoutesMoved}`);
  if (errors > 0) {
    console.log(`   Errors:               ${errors}`);
  }

  if (isDryRun) {
    console.log('\n💡 Run without --dry-run to apply changes');
  } else {
    console.log('\n✅ Consolidation complete');
  }
}

consolidateLidChats()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
