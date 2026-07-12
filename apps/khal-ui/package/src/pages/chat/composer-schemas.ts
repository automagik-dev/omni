/**
 * Attachment-menu schemas + send dispatch for the composer. Each entry is a Zod
 * schema (rendered by {@link SchemaForm}) plus a `send` that injects the
 * instance/recipient and calls the typed SDK. Keeping them as data lets the
 * composer render one modal path for every message type.
 *
 * The recipient (`to`) is the chat UUID — the backend resolves it to the chat's
 * platform JID (see `resolveRecipient`), so the UI never reconstructs JIDs.
 */
import { z } from 'zod';
import type { OmniAdminClient } from '../../api/client';

export interface SendOutcome {
  messageId: string;
  status: string;
}

export interface AttachmentKind {
  id: string;
  label: string;
  /** One-line description shown in the menu + modal. */
  hint: string;
  /** Channels this makes sense on; undefined = all. */
  channels?: string[];
  schema: z.ZodTypeAny;
  send: (
    client: OmniAdminClient,
    ctx: { instanceId: string; to: string },
    values: Record<string, unknown>,
  ) => Promise<SendOutcome>;
}

const asOutcome = (r: { messageId?: string; status?: string } | { messageId?: string }): SendOutcome => ({
  messageId: (r as { messageId?: string }).messageId ?? '',
  status: (r as { status?: string }).status ?? 'sent',
});

export const ATTACHMENT_KINDS: AttachmentKind[] = [
  {
    id: 'media',
    label: 'Media',
    hint: 'Image, audio, video, or document by URL or base64.',
    schema: z.object({
      type: z.enum(['image', 'audio', 'video', 'document']),
      url: z.string().url().optional(),
      base64: z.string().optional(),
      filename: z.string().optional(),
      caption: z.string().optional(),
      voiceNote: z.boolean().optional(),
    }),
    send: (client, ctx, v) =>
      client.messages
        .sendMedia({
          instanceId: ctx.instanceId,
          to: ctx.to,
          type: v.type as 'image' | 'audio' | 'video' | 'document',
          url: (v.url as string) || undefined,
          base64: (v.base64 as string) || undefined,
          filename: (v.filename as string) || undefined,
          caption: (v.caption as string) || undefined,
          voiceNote: v.voiceNote as boolean | undefined,
        })
        .then(asOutcome),
  },
  {
    id: 'sticker',
    label: 'Sticker',
    hint: 'Sticker image by URL or base64.',
    schema: z.object({ url: z.string().url().optional(), base64: z.string().optional() }),
    send: (client, ctx, v) =>
      client.messages
        .sendSticker({
          instanceId: ctx.instanceId,
          to: ctx.to,
          url: (v.url as string) || undefined,
          base64: (v.base64 as string) || undefined,
        })
        .then(asOutcome),
  },
  {
    id: 'reaction',
    label: 'Reaction',
    hint: 'React to a message by its id.',
    schema: z.object({ messageId: z.string().min(1), emoji: z.string().min(1) }),
    send: (client, ctx, v) =>
      client.messages
        .sendReaction({
          instanceId: ctx.instanceId,
          to: ctx.to,
          messageId: v.messageId as string,
          emoji: v.emoji as string,
        })
        .then((r) => ({ messageId: r.messageId ?? (v.messageId as string), status: r.success ? 'sent' : 'failed' })),
  },
  {
    id: 'contact',
    label: 'Contact card',
    hint: 'Share a contact card.',
    schema: z.object({
      name: z.string().min(1),
      phone: z.string().optional(),
      email: z.string().optional(),
      organization: z.string().optional(),
    }),
    send: (client, ctx, v) =>
      client.messages
        .sendContact({
          instanceId: ctx.instanceId,
          to: ctx.to,
          contact: {
            name: v.name as string,
            phone: (v.phone as string) || undefined,
            email: (v.email as string) || undefined,
            organization: (v.organization as string) || undefined,
          },
        })
        .then(asOutcome),
  },
  {
    id: 'location',
    label: 'Location',
    hint: 'Share a pin (latitude/longitude).',
    schema: z.object({
      latitude: z.number(),
      longitude: z.number(),
      name: z.string().optional(),
      address: z.string().optional(),
    }),
    send: (client, ctx, v) =>
      client.messages
        .sendLocation({
          instanceId: ctx.instanceId,
          to: ctx.to,
          latitude: Number(v.latitude),
          longitude: Number(v.longitude),
          name: (v.name as string) || undefined,
          address: (v.address as string) || undefined,
        })
        .then(asOutcome),
  },
  {
    id: 'tts',
    label: 'Voice note (TTS)',
    hint: 'Synthesize speech and send as a voice note.',
    schema: z.object({ text: z.string().min(1), voiceId: z.string().optional() }),
    send: (client, ctx, v) =>
      client.messages
        .sendTts({
          instanceId: ctx.instanceId,
          to: ctx.to,
          text: v.text as string,
          voiceId: (v.voiceId as string) || undefined,
        })
        .then(asOutcome),
  },
  {
    id: 'poll',
    label: 'Poll',
    hint: 'Poll with options (Discord).',
    channels: ['discord'],
    schema: z.object({
      question: z.string().min(1),
      answers: z.array(z.string().min(1)),
      durationHours: z.number().optional(),
      multiSelect: z.boolean().optional(),
    }),
    send: (client, ctx, v) =>
      client.messages
        .sendPoll({
          instanceId: ctx.instanceId,
          to: ctx.to,
          question: v.question as string,
          answers: (v.answers as string[]) ?? [],
          durationHours: v.durationHours as number | undefined,
          multiSelect: v.multiSelect as boolean | undefined,
        })
        .then(asOutcome),
  },
  {
    id: 'forward',
    label: 'Forward',
    hint: 'Forward a message from another chat.',
    schema: z.object({ messageId: z.string().min(1), fromChatId: z.string().min(1) }),
    send: (client, ctx, v) =>
      client.messages
        .sendForward({
          instanceId: ctx.instanceId,
          to: ctx.to,
          messageId: v.messageId as string,
          fromChatId: v.fromChatId as string,
        })
        .then(asOutcome),
  },
  {
    id: 'presence',
    label: 'Presence',
    hint: 'Send a typing / recording indicator.',
    schema: z.object({
      type: z.enum(['typing', 'recording', 'paused']),
      duration: z.number().optional(),
    }),
    send: (client, ctx, v) =>
      client.messages
        .sendPresence({
          instanceId: ctx.instanceId,
          to: ctx.to,
          type: v.type as 'typing' | 'recording' | 'paused',
          duration: v.duration as number | undefined,
        })
        .then((r) => ({ messageId: r.chatId ?? ctx.to, status: r.delivered === false ? 'not-delivered' : 'sent' })),
  },
];
