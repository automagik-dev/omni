import type { ChannelPlugin } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { chats, messages, omniEvents } from '@omni/db';
import { and, asc, desc, eq, gt, gte, isNotNull, isNull, lte, notInArray } from 'drizzle-orm';
import type { z } from 'zod';
import {
  type SelfHistorySchema,
  SelfIdentitySchema,
  type SelfMessagesSchema,
  type SelfReceiptSchema,
  type SendSelfSchema,
} from '../schemas/openapi/instances';

export type SelfIdentity = z.infer<typeof SelfIdentitySchema>;
export type SelfPlugin = ChannelPlugin & {
  getSelfIdentity(instanceId: string): SelfIdentity;
  sendSelf(
    instanceId: string,
    input: Omit<z.infer<typeof SendSelfSchema>, 'instanceId'>,
  ): Promise<{ externalId: string; ownerIdentifier: string; generation: string }>;
};
export function selfPlugin(plugin: ChannelPlugin | undefined): SelfPlugin {
  if (
    !plugin ||
    plugin.id !== 'whatsapp-baileys' ||
    !('getSelfIdentity' in plugin) ||
    typeof plugin.getSelfIdentity !== 'function' ||
    !('sendSelf' in plugin) ||
    typeof plugin.sendSelf !== 'function'
  )
    throw new Error('Self capability unavailable');
  return plugin as SelfPlugin;
}
export function verifySelf(
  plugin: SelfPlugin,
  instanceId: string,
  expected?: { expectedOwner: string; expectedGeneration: string },
): SelfIdentity {
  const value = SelfIdentitySchema.parse(plugin.getSelfIdentity(instanceId));
  if (
    value.selfJid !== value.ownerIdentifier ||
    (expected && (value.ownerIdentifier !== expected.expectedOwner || value.generation !== expected.expectedGeneration))
  )
    throw new Error('Self identity changed');
  return value;
}
function freshWindow(input: { after: string; before: string }) {
  if (Date.parse(input.after) < Date.now() - 7 * 86400000 || Date.parse(input.before) > Date.now() + 60000)
    throw new Error('Read window expired');
}
/** Decode only the numeric or serialized protobuf Long used by native Baileys. */
function platformTime(value: unknown): string | null {
  let seconds: number;
  if (typeof value === 'number') seconds = value;
  else {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const long = value as Record<string, unknown>;
    if (
      Object.keys(long).length !== 3 ||
      Object.keys(long).some((key) => !['low', 'high', 'unsigned'].includes(key)) ||
      typeof long.low !== 'number' ||
      !Number.isInteger(long.low) ||
      long.low < -2147483648 ||
      long.low > 2147483647 ||
      typeof long.high !== 'number' ||
      !Number.isInteger(long.high) ||
      long.high < -2147483648 ||
      long.high > 2147483647 ||
      typeof long.unsigned !== 'boolean'
    )
      return null;
    let integer = (BigInt(long.high >>> 0) << 32n) | BigInt(long.low >>> 0);
    if (!long.unsigned && long.high < 0) integer -= 1n << 64n;
    if (integer <= 0n || integer > 8640000000000n) return null;
    seconds = Number(integer);
  }
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > 8640000000000) return null;
  return new Date(seconds * 1000).toISOString();
}
/** A closed projection: quoted/forwarded/edited text cannot become command authority. */
export function projectSelfEvent(row: typeof omniEvents.$inferSelect, owner: string, source: string | null = null) {
  const raw = row.rawPayload ?? {};
  const key = raw.key as Record<string, unknown> | undefined;
  const message = raw.message as Record<string, unknown> | undefined;
  const extended = message?.extendedTextMessage as Record<string, unknown> | undefined;
  const context = extended?.contextInfo as Record<string, unknown> | undefined;
  const nativeText = message?.conversation ?? extended?.text;
  const at = platformTime(raw.messageTimestamp);
  const authority =
    source === 'realtime' &&
    row.eventType === 'message.received' &&
    row.contentType === 'text' &&
    key?.fromMe === true &&
    raw.isFromMe === true &&
    key.remoteJid === owner &&
    row.metadata?.from === owner.split('@')[0] &&
    typeof nativeText === 'string' &&
    nativeText === row.textContent &&
    at !== null &&
    !row.replyToExternalId &&
    !raw.quotedMessage &&
    !context?.quotedMessage &&
    !context?.isForwarded &&
    !context?.forwardingScore &&
    !message?.protocolMessage &&
    raw.isHistorySync !== true;
  return {
    id: row.id,
    externalId: row.externalId,
    chatId: row.chatId,
    from: owner,
    text: row.textContent ?? '',
    at,
    receivedAt: row.receivedAt.toISOString(),
    isFromMe: raw.isFromMe === true,
    authority,
  };
}
export async function readSelfMessages(
  db: Database,
  plugin: SelfPlugin,
  instanceId: string,
  input: z.infer<typeof SelfMessagesSchema>,
) {
  const identity = verifySelf(plugin, instanceId, input);
  freshWindow(input);
  // Always rescan the admitted window, excluding durable known IDs in SQL BEFORE LIMIT.
  // No timestamp cursor: equal-time messages and late commits remain eligible.
  const rows = await db
    .select({ event: omniEvents, source: messages.source })
    .from(omniEvents)
    .leftJoin(messages, eq(messages.originalEventId, omniEvents.id))
    .where(
      and(
        eq(omniEvents.instanceId, instanceId),
        eq(omniEvents.chatId, identity.selfJid),
        eq(omniEvents.eventType, 'message.received'),
        eq(omniEvents.contentType, 'text'),
        eq(messages.source, 'realtime'),
        eq(messages.isFromMe, true),
        isNotNull(omniEvents.externalId),
        gte(omniEvents.receivedAt, new Date(input.after)),
        lte(omniEvents.receivedAt, new Date(input.before)),
        input.excludeExternalIds.length ? notInArray(omniEvents.externalId, input.excludeExternalIds) : undefined,
      ),
    )
    .orderBy(asc(omniEvents.receivedAt), asc(omniEvents.id))
    .limit(51);
  verifySelf(plugin, instanceId, input);
  return {
    items: rows.slice(0, 50).map((row) => projectSelfEvent(row.event, identity.selfJid, row.source)),
    hasMore: rows.length > 50,
  };
}
export async function readOwnedChats(db: Database, plugin: SelfPlugin, instanceId: string, cursor?: string) {
  const identity = verifySelf(plugin, instanceId);
  const rows = await db
    .select({ id: chats.id, name: chats.name })
    .from(chats)
    .where(and(eq(chats.instanceId, instanceId), cursor ? gt(chats.id, cursor) : undefined))
    .orderBy(asc(chats.id))
    .limit(26);
  verifySelf(plugin, instanceId, { expectedOwner: identity.ownerIdentifier, expectedGeneration: identity.generation });
  const items = rows.slice(0, 25);
  return { items, meta: { hasMore: rows.length > 25, cursor: rows.length > 25 ? (items.at(-1)?.id ?? null) : null } };
}
export function boundHistory(rows: { externalId: string; text: string | null; at: Date; isFromMe: boolean }[]) {
  let characters = 0;
  let partial = rows.length > 50;
  const items = [];
  for (const row of rows.slice(0, 50)) {
    const text = row.text ?? '';
    if (characters + text.length > 8000) {
      partial = true;
      break;
    }
    characters += text.length;
    items.push({
      externalId: row.externalId,
      text,
      at: row.at.toISOString(),
      direction: row.isFromMe ? 'outbound' : 'inbound',
    });
  }
  return { items, partial, limits: { days: 7, messages: 50, characters: 8000 } };
}
export async function readOwnedHistory(
  db: Database,
  plugin: SelfPlugin,
  instanceId: string,
  input: z.infer<typeof SelfHistorySchema>,
) {
  verifySelf(plugin, instanceId, input);
  const rows = await db
    .select({
      externalId: messages.externalId,
      text: messages.textContent,
      at: messages.platformTimestamp,
      isFromMe: messages.isFromMe,
    })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(
      and(
        eq(chats.id, input.chatId),
        eq(chats.instanceId, instanceId),
        isNull(messages.deletedAt),
        gte(messages.platformTimestamp, new Date(input.after)),
        lte(messages.platformTimestamp, new Date(input.before)),
      ),
    )
    .orderBy(desc(messages.platformTimestamp), desc(messages.id))
    .limit(51);
  // Check existence/ownership even for an empty result; foreign/unknown chats refuse.
  const [chat] = await db
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.id, input.chatId), eq(chats.instanceId, instanceId)))
    .limit(1);
  if (!chat) throw new Error('Selected chat unavailable');
  verifySelf(plugin, instanceId, input);
  return boundHistory(rows);
}

/** Exact observed outbound ID; null is unknown, never absence proof or retry permission. */
export async function readSelfReceipt(
  db: Database,
  plugin: SelfPlugin,
  instanceId: string,
  input: z.infer<typeof SelfReceiptSchema>,
) {
  const identity = verifySelf(plugin, instanceId, input);
  const [row] = await db
    .select({ externalId: messages.externalId, text: messages.textContent, at: messages.platformTimestamp })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .innerJoin(
      omniEvents,
      and(
        eq(omniEvents.externalId, messages.externalId),
        eq(omniEvents.instanceId, instanceId),
        eq(omniEvents.chatId, identity.selfJid),
      ),
    )
    .where(
      and(
        eq(chats.instanceId, instanceId),
        eq(chats.externalId, identity.selfJid),
        eq(messages.externalId, input.externalId),
        eq(messages.source, 'realtime'),
        eq(omniEvents.eventType, 'message.sent'),
        eq(omniEvents.direction, 'outbound'),
        eq(omniEvents.status, 'completed'),
        eq(omniEvents.contentType, 'text'),
        eq(messages.messageType, 'text'),
        eq(messages.textContent, omniEvents.textContent),
        eq(messages.isFromMe, true),
        isNull(messages.deletedAt),
      ),
    )
    .limit(1);
  verifySelf(plugin, instanceId, input);
  return row
    ? {
        externalId: row.externalId,
        text: row.text ?? '',
        at: row.at.toISOString(),
        ownerIdentifier: identity.ownerIdentifier,
        generation: identity.generation,
      }
    : null;
}
