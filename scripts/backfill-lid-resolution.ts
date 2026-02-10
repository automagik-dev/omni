#!/usr/bin/env bun
/**
 * Backfill LID Resolution
 *
 * Fixes existing chat data:
 * 1. Sets canonicalId = externalId for all @s.whatsapp.net chats
 * 2. Resolves @lid chats via chatIdMappings to find phone equivalents
 * 3. Merges duplicate chats (same conversation as @lid + @s.whatsapp.net)
 * 4. Backfills names from platformIdentities → persons for nameless DM chats
 *
 * Usage:
 *   bun scripts/backfill-lid-resolution.ts --dry-run    # Preview changes
 *   bun scripts/backfill-lid-resolution.ts              # Apply changes
 */

import { and, eq, isNull, like, sql } from '../packages/db/node_modules/drizzle-orm';
import {
  chatIdMappings,
  chatParticipants,
  chats,
  closeDb,
  getDb,
  platformIdentities,
  pluginStorage,
} from '../packages/db/src/index';

const DRY_RUN = process.argv.includes('--dry-run');
const db = getDb();

async function main() {
  console.log(`LID Resolution Backfill ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
  console.log('='.repeat(60));

  // Step 1: Set canonicalId for all @s.whatsapp.net chats
  await backfillCanonicalIds();

  // Step 1b: Extract LID mappings from Baileys auth state → chatIdMappings
  await extractBaileysLidMappings();

  // Step 2: Resolve @lid chats via chatIdMappings + platformIdentities
  await resolveLidChats();

  // Step 3: Merge duplicate chats
  await mergeDuplicates();

  // Step 4: Backfill names for nameless DM chats
  await backfillNames();

  console.log('\nDone!');
  closeDb();
}

async function backfillCanonicalIds() {
  console.log('\n--- Step 1: Set canonicalId for phone-based chats ---');

  const phoneChats = await db
    .select({ id: chats.id, externalId: chats.externalId })
    .from(chats)
    .where(and(like(chats.externalId, '%@s.whatsapp.net'), isNull(chats.canonicalId)));

  console.log(`Found ${phoneChats.length} phone-based chats without canonicalId`);

  if (!DRY_RUN && phoneChats.length > 0) {
    // Batch update
    for (const chat of phoneChats) {
      await db.update(chats).set({ canonicalId: chat.externalId }).where(eq(chats.id, chat.id));
    }
    console.log(`Updated ${phoneChats.length} chats`);
  }
}

/**
 * Extract LID→phone mappings from Baileys auth state (plugin_storage table).
 * Baileys stores these as key-value pairs:
 *   key: auth:{instanceId}:keys:lid-mapping:{phone} → value: {lidNumber}
 *   key: auth:{instanceId}:keys:lid-mapping:{lidNumber}_reverse → value: {phone}
 * We use the _reverse keys since they map LID→phone directly.
 */
async function extractBaileysLidMappings() {
  console.log('\n--- Step 1b: Extract LID mappings from Baileys auth state ---');

  const reverseKeys = await db
    .select({ key: pluginStorage.key, value: pluginStorage.value })
    .from(pluginStorage)
    .where(like(pluginStorage.key, '%:keys:lid-mapping:%_reverse'));

  console.log(`Found ${reverseKeys.length} reverse LID mapping keys in Baileys auth state`);

  let inserted = 0;
  for (const row of reverseKeys) {
    // Parse: plugin:whatsapp-baileys:auth:{instanceId}:keys:lid-mapping:{lidNumber}_reverse
    const parts = row.key.split(':');
    const instanceId = parts[3]; // UUID at index 3
    const lidNumber = parts[6]?.replace('_reverse', '');
    const phoneNumber = JSON.parse(row.value); // Stored as JSON string

    if (!instanceId || !lidNumber || !phoneNumber) continue;

    const lidJid = `${lidNumber}@lid`;
    const phoneJid = `${phoneNumber}@s.whatsapp.net`;

    if (!DRY_RUN) {
      try {
        await db
          .insert(chatIdMappings)
          .values({ instanceId, lidId: lidJid, phoneId: phoneJid, discoveredFrom: 'baileys_auth_state' })
          .onConflictDoUpdate({
            target: [chatIdMappings.instanceId, chatIdMappings.lidId],
            set: { phoneId: phoneJid, discoveredAt: new Date() },
          });
        inserted++;
      } catch {
        // Skip invalid instanceIds or other constraint errors
      }
    } else {
      console.log(`  ${lidJid} → ${phoneJid} (instance: ${instanceId.slice(0, 8)}...)`);
      inserted++;
    }
  }

  console.log(`Extracted ${inserted} LID→phone mappings from Baileys auth state`);
}

/**
 * Cross-reference: find a phone JID for an @lid chat via platformIdentities.
 * Path: @lid chat → chatParticipants (with personId) → platformIdentities (phone-based platformUserId)
 */
async function resolveViaIdentities(chatId: string, instanceId: string): Promise<string | null> {
  // Find participants of this chat that have a linked person
  const participants = await db
    .select({ personId: chatParticipants.personId })
    .from(chatParticipants)
    .where(and(eq(chatParticipants.chatId, chatId), sql`${chatParticipants.personId} IS NOT NULL`));

  for (const p of participants) {
    if (!p.personId) continue;

    // Look for a phone-based identity for this person on the same instance
    const [identity] = await db
      .select({ platformUserId: platformIdentities.platformUserId })
      .from(platformIdentities)
      .where(
        and(
          eq(platformIdentities.personId, p.personId),
          eq(platformIdentities.instanceId, instanceId),
          like(platformIdentities.platformUserId, '%@s.whatsapp.net'),
        ),
      )
      .limit(1);

    if (identity) return identity.platformUserId;
  }

  return null;
}

async function resolveLidChats() {
  console.log('\n--- Step 2: Resolve @lid chats via chatIdMappings + platformIdentities ---');

  // Find all @lid chats without canonicalId
  const lidChats = await db
    .select({
      id: chats.id,
      instanceId: chats.instanceId,
      externalId: chats.externalId,
      canonicalId: chats.canonicalId,
    })
    .from(chats)
    .where(and(like(chats.externalId, '%@lid'), isNull(chats.canonicalId)));

  console.log(`Found ${lidChats.length} @lid chats without canonicalId`);

  let resolvedFromMappings = 0;
  let resolvedFromIdentities = 0;
  for (const chat of lidChats) {
    if (!chat.instanceId) continue;

    // Strategy 1: Look up in chatIdMappings
    const [mapping] = await db
      .select()
      .from(chatIdMappings)
      .where(and(eq(chatIdMappings.instanceId, chat.instanceId), eq(chatIdMappings.lidId, chat.externalId)))
      .limit(1);

    if (mapping) {
      console.log(`  ${chat.externalId} → ${mapping.phoneId} (via chatIdMappings)`);
      if (!DRY_RUN) {
        await db.update(chats).set({ canonicalId: mapping.phoneId }).where(eq(chats.id, chat.id));
      }
      resolvedFromMappings++;
      continue;
    }

    // Strategy 2: Cross-reference via platformIdentities
    const phoneJid = await resolveViaIdentities(chat.id, chat.instanceId);
    if (phoneJid) {
      console.log(`  ${chat.externalId} → ${phoneJid} (via platformIdentities)`);
      if (!DRY_RUN) {
        await db.update(chats).set({ canonicalId: phoneJid }).where(eq(chats.id, chat.id));
        // Also populate chatIdMappings for future lookups
        await db
          .insert(chatIdMappings)
          .values({
            instanceId: chat.instanceId,
            lidId: chat.externalId,
            phoneId: phoneJid,
            discoveredFrom: 'backfill_identities',
          })
          .onConflictDoNothing();
      }
      resolvedFromIdentities++;
    }
  }

  const total = resolvedFromMappings + resolvedFromIdentities;
  console.log(`Resolved ${total}/${lidChats.length} @lid chats`);
  console.log(`  - From chatIdMappings: ${resolvedFromMappings}`);
  console.log(`  - From platformIdentities: ${resolvedFromIdentities}`);
}

async function mergeDuplicates() {
  console.log('\n--- Step 3: Merge duplicate chats ---');

  // Find @lid chats that have a canonicalId pointing to a phone JID
  // Check if a separate phone-based chat already exists for the same instance
  const lidChatsWithCanonical = await db
    .select({
      id: chats.id,
      instanceId: chats.instanceId,
      externalId: chats.externalId,
      canonicalId: chats.canonicalId,
      messageCount: chats.messageCount,
      createdAt: chats.createdAt,
    })
    .from(chats)
    .where(and(like(chats.externalId, '%@lid'), sql`${chats.canonicalId} IS NOT NULL`));

  let merged = 0;
  for (const lidChat of lidChatsWithCanonical) {
    if (!lidChat.instanceId || !lidChat.canonicalId) continue;

    // Check if a phone-based chat exists
    const [phoneChat] = await db
      .select()
      .from(chats)
      .where(and(eq(chats.instanceId, lidChat.instanceId), eq(chats.externalId, lidChat.canonicalId)))
      .limit(1);

    if (!phoneChat) continue;

    // Determine which to keep: prefer the older one (more history)
    const keepChat = phoneChat.createdAt <= lidChat.createdAt ? phoneChat : lidChat;
    const removeChat = keepChat.id === phoneChat.id ? lidChat : phoneChat;

    console.log(
      `  Merging: keep=${keepChat.externalId} (${keepChat.id}), remove=${removeChat.externalId} (${removeChat.id})`,
    );

    if (!DRY_RUN) {
      // Move messages from removeChat to keepChat
      await db.execute(
        sql`UPDATE messages SET chat_id = ${keepChat.id} WHERE chat_id = ${removeChat.id} AND external_id NOT IN (SELECT external_id FROM messages WHERE chat_id = ${keepChat.id})`,
      );

      // Move participants
      const removeParticipants = await db
        .select()
        .from(chatParticipants)
        .where(eq(chatParticipants.chatId, removeChat.id));

      for (const p of removeParticipants) {
        // Check if participant already exists in keepChat
        const [existing] = await db
          .select()
          .from(chatParticipants)
          .where(and(eq(chatParticipants.chatId, keepChat.id), eq(chatParticipants.platformUserId, p.platformUserId)))
          .limit(1);

        if (!existing) {
          await db.update(chatParticipants).set({ chatId: keepChat.id }).where(eq(chatParticipants.id, p.id));
        }
      }

      // Soft-delete the duplicate chat
      await db.update(chats).set({ deletedAt: new Date() }).where(eq(chats.id, removeChat.id));

      // Update message count on kept chat
      const [countResult] = await db.execute(
        sql`SELECT COUNT(*) as count FROM messages WHERE chat_id = ${keepChat.id}`,
      );
      const msgCount = (countResult as { count: number }).count;
      await db.update(chats).set({ messageCount: msgCount }).where(eq(chats.id, keepChat.id));
    }

    merged++;
  }

  console.log(`Merged ${merged} duplicate chats`);
}

async function backfillNames() {
  console.log('\n--- Step 4: Backfill names for nameless DM chats ---');

  // Find DM chats with no name or with raw JID as name
  const namelessChats = await db
    .select({ id: chats.id, externalId: chats.externalId, name: chats.name })
    .from(chats)
    .where(
      and(
        eq(chats.chatType, 'dm'),
        sql`(${chats.name} IS NULL OR ${chats.name} LIKE '%@s.whatsapp.net' OR ${chats.name} LIKE '%@lid')`,
      ),
    );

  console.log(`Found ${namelessChats.length} nameless DM chats`);

  let updated = 0;
  for (const chat of namelessChats) {
    // Look for participant with a display name
    const participants = await db
      .select({ displayName: chatParticipants.displayName })
      .from(chatParticipants)
      .where(and(eq(chatParticipants.chatId, chat.id), sql`${chatParticipants.displayName} IS NOT NULL`))
      .limit(1);

    const name = participants[0]?.displayName;
    if (name) {
      console.log(`  ${chat.externalId}: "${chat.name ?? '(null)'}" → "${name}"`);
      if (!DRY_RUN) {
        await db.update(chats).set({ name }).where(eq(chats.id, chat.id));
      }
      updated++;
    }
  }

  console.log(`Updated ${updated}/${namelessChats.length} chat names`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  closeDb();
  process.exit(1);
});
