import type { ContentType } from '@omni/core/types';
import { z } from 'zod';
import { canonicalChatId } from './client';

const identifier = z.string().min(1);
const contentSchema = z
  .object({
    message: z.string().optional(),
    caption: z.string().optional(),
    mimeType: z.string().optional(),
    imageUrl: z.string().optional(),
    audioUrl: z.string().optional(),
    videoUrl: z.string().optional(),
    documentUrl: z.string().optional(),
    stickerUrl: z.string().optional(),
  })
  .passthrough();
const webSchema = z
  .object({
    instanceId: identifier,
    type: identifier,
    messageId: identifier.optional(),
    phone: identifier.optional(),
    senderLid: identifier.optional(),
    participantPhone: identifier.nullish(),
    participantLid: identifier.nullish(),
    senderName: z.string().optional(),
    chatName: z.string().optional(),
    fromMe: z.boolean().optional(),
    isGroup: z.boolean().optional(),
    isEdit: z.boolean().optional(),
    momment: z.number().finite().nonnegative().optional(),
    status: z.string().optional(),
    ids: z.array(identifier).optional(),
    error: z.unknown().optional(),
    text: contentSchema.optional(),
    image: contentSchema.optional(),
    audio: contentSchema.optional(),
    video: contentSchema.optional(),
    document: contentSchema.optional(),
    sticker: contentSchema.optional(),
    reaction: z
      .object({
        value: z.string(),
        reactionBy: identifier,
        referencedMessage: z.object({ messageId: identifier }).passthrough(),
      })
      .passthrough()
      .optional(),
    location: z
      .object({ latitude: z.number(), longitude: z.number(), address: z.string().optional() })
      .passthrough()
      .optional(),
    contact: z
      .object({ displayName: z.string(), phones: z.array(z.string()).optional(), vCard: z.string().optional() })
      .passthrough()
      .optional(),
    buttonsResponseMessage: z.object({ buttonId: z.string(), message: z.string() }).passthrough().optional(),
    listResponseMessage: z
      .object({ selectedRowId: z.string().optional(), message: z.string().optional(), title: z.string().optional() })
      .passthrough()
      .optional(),
    referenceMessageId: z.string().optional(),
    connected: z.boolean().optional(),
  })
  .passthrough();
export type NormalizedContent = {
  type: ContentType;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
};
export type NormalizedEvent =
  | {
      type: 'reaction';
      id: string;
      targetId: string;
      chatId: string;
      from: string;
      emoji: string;
      raw: Record<string, unknown>;
    }
  | { type: 'connected' | 'disconnected'; owner?: string }
  | {
      type: 'received' | 'sent';
      id: string;
      chatId: string;
      from: string;
      senderName?: string;
      content: NormalizedContent;
      timestamp: number;
      raw: Record<string, unknown>;
      replyTo?: string;
    }
  | { type: 'delivered' | 'read' | 'failed'; id: string; chatId: string; timestamp: number };

function statusEvent(status: string, id: string, chatId: string, timestamp: number): NormalizedEvent | null {
  if (['RECEIVED', 'DELIVERED'].includes(status)) return { type: 'delivered', id, chatId, timestamp };
  if (['READ', 'READ_BY_ME'].includes(status)) return { type: 'read', id, chatId, timestamp };
  if (['FAILED', 'ERROR'].includes(status)) return { type: 'failed', id, chatId, timestamp };
  return null;
}
export function normalizeWeb(raw: unknown, expectedId: string): NormalizedEvent[] {
  const p = webSchema.parse(raw);
  if (p.instanceId !== expectedId) throw new Error('Instance mismatch');
  if (p.type === 'ConnectedCallback') return [{ type: 'connected', owner: p.phone }];
  if (p.type === 'DisconnectedCallback') return [{ type: 'disconnected' }];
  if (p.type === 'MessageStatusCallback') {
    const chatId = p.phone ? canonicalChatId(p.phone) : undefined;
    if (!chatId || !p.ids || !p.status) throw new Error('Incomplete status');
    return p.ids
      .map((id) => statusEvent(p.status ?? '', id, chatId, p.momment ?? Date.now()))
      .filter((e): e is NormalizedEvent => e !== null);
  }
  if (p.type === 'DeliveryCallback') {
    if (!p.messageId || !p.phone) throw new Error('Incomplete delivery');
    // Provider delivery callback means sent to WhatsApp, NOT delivered to recipient.
    if (p.error)
      return [
        { type: 'failed', id: p.messageId, chatId: canonicalChatId(p.phone), timestamp: p.momment ?? Date.now() },
      ];
    return [];
  }
  if (p.type !== 'ReceivedCallback') return [];
  return normalizeWebMessage(p);
}
function normalizeWebMessage(p: z.infer<typeof webSchema>): NormalizedEvent[] {
  const address = p.phone ?? p.senderLid;
  const chatId = address ? canonicalChatId(address) : undefined;
  if (!chatId || !p.messageId) throw new Error('Incomplete message');
  if (p.reaction)
    return [
      {
        type: 'reaction',
        id: p.messageId,
        targetId: p.reaction.referencedMessage.messageId,
        chatId,
        from: p.reaction.reactionBy,
        emoji: p.reaction.value,
        raw: p,
      },
    ];
  const content = webContent(p);
  return [
    {
      type: p.fromMe ? 'sent' : 'received',
      id: p.messageId,
      chatId,
      from: p.isGroup ? (p.participantPhone ?? p.participantLid ?? p.senderLid ?? chatId) : chatId,
      senderName: p.senderName,
      content,
      timestamp: p.momment ?? Date.now(),
      raw: p,
      replyTo: p.referenceMessageId,
    },
  ];
}
function webContent(p: z.infer<typeof webSchema>): NormalizedContent {
  let content: NormalizedContent = { type: 'unknown' };
  if (p.text) content = { type: p.isEdit ? 'edit' : 'text', text: p.text.message };
  for (const type of ['image', 'audio', 'video', 'document', 'sticker'] as const) {
    const media = p[type];
    if (media)
      content = {
        type,
        mediaUrl: media[`${type}Url`] as string | undefined,
        mimeType: media.mimeType,
        text: media.caption,
        caption: media.caption,
      };
  }
  if (p.location)
    content = { type: 'location', text: p.location.address ?? `${p.location.latitude},${p.location.longitude}` };
  if (p.contact) content = { type: 'contact', text: [p.contact.displayName, ...(p.contact.phones ?? [])].join('\n') };
  if (p.buttonsResponseMessage) content = { type: 'text', text: p.buttonsResponseMessage.message };
  if (p.listResponseMessage)
    content = {
      type: 'text',
      text: p.listResponseMessage.message ?? p.listResponseMessage.title ?? p.listResponseMessage.selectedRowId,
    };
  return content;
}
const stateItemSchema = z
  .object({ moment: z.number().optional(), state: z.object({ name: z.string() }).passthrough() })
  .passthrough();
const omniPartSchema = z
  .object({
    type: z.string(),
    message: z.string().optional(),
    caption: z.string().optional(),
    url: z.string().optional(),
    mime_type: z.string().optional(),
    mimeType: z.string().optional(),
    state_items: z.array(stateItemSchema).optional(),
  })
  .passthrough();
const omniSchema = z
  .object({
    messageEventType: z.string(),
    message: z
      .object({
        _id: identifier,
        channel_id: identifier,
        created: z.number().finite().nonnegative(),
        metadata: z.object({ from_me: z.boolean() }).passthrough(),
        sender: z.object({ identifier: identifier, name: z.string().optional() }).passthrough(),
        recipient: z.object({ identifier: identifier }).passthrough(),
        contents: z.array(omniPartSchema),
        attachments: z.array(omniPartSchema),
      })
      .passthrough(),
  })
  .passthrough();
function omniContent(first: z.infer<typeof omniPartSchema> | undefined): NormalizedContent {
  const supported = ['text', 'image', 'video', 'audio', 'document', 'sticker', 'contact', 'location', 'template'];
  const kind = first?.type.toLowerCase() ?? 'unknown';
  return {
    type: supported.includes(kind) ? (kind as ContentType) : 'unknown',
    text: first?.message ?? first?.caption,
    mediaUrl: first?.url,
    mimeType: first?.mime_type ?? first?.mimeType,
  };
}
function omniStatuses(m: z.infer<typeof omniSchema>['message'], chatId: string): NormalizedEvent[] {
  if (!m.metadata.from_me) return [];
  return [...m.contents, ...m.attachments].flatMap((part) =>
    (part.state_items ?? []).flatMap((state) => {
      const event = statusEvent(state.state.name, m._id, chatId, state.moment ?? m.created);
      return event ? [event] : [];
    }),
  );
}
function normalizeOmniMessage(input: unknown, expectedId: string): NormalizedEvent[] {
  const p = omniSchema.parse(input);
  const m = p.message;
  if (m.channel_id !== expectedId) throw new Error('Channel mismatch');
  const chatId = m.metadata.from_me ? m.recipient.identifier : m.sender.identifier;
  const events: NormalizedEvent[] = [];
  if (p.messageEventType === 'NEW_MESSAGE')
    events.push({
      type: m.metadata.from_me ? 'sent' : 'received',
      id: m._id,
      chatId,
      from: m.sender.identifier,
      senderName: m.sender.name,
      content: {
        ...omniContent(m.attachments[0] ?? m.contents[0]),
        text: m.contents[0]?.message ?? omniContent(m.attachments[0] ?? m.contents[0]).text,
      },
      timestamp: m.created,
      raw: m,
    });
  return [...events, ...omniStatuses(m, chatId)];
}
export function normalizeOmni(raw: unknown, expectedId: string): NormalizedEvent[] {
  const inputs = Array.isArray(raw) ? raw : [raw];
  return inputs.flatMap((input) => normalizeOmniMessage(input, expectedId));
}
