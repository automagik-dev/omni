import type { ContentType } from '@omni/core/types';
import { z } from 'zod';
import { canonicalJid } from './client';

type Content = { type: ContentType; text?: string; mediaUrl?: string; mimeType?: string; isVoiceNote?: boolean };
export type EvolutionEvent =
  | {
      type: 'connection';
      state: 'connected' | 'connecting' | 'disconnected';
      owner?: string;
      profileName?: string;
      profilePicUrl?: string;
    }
  | { type: 'qr'; code: string }
  | {
      type: 'message';
      id: string;
      chatId: string;
      from: string;
      fromMe: boolean;
      senderName?: string;
      timestamp: number;
      content: Content;
      replyTo?: string;
      raw: Record<string, unknown>;
    }
  | { type: 'receipt'; id: string; chatId: string; status: 'delivered' | 'read' | 'failed'; timestamp: number };
const envelope = z.object({
  event: z.string().min(1),
  instance: z.string().min(1),
  data: z.unknown(),
  date_time: z.string().datetime({ offset: true }).optional(),
});
const keySchema = z.object({
  id: z.string().min(1),
  remoteJid: z.string().min(1),
  fromMe: z.boolean(),
  participant: z.string().optional(),
});
const messageSchema = z.object({
  key: keySchema,
  message: z.record(z.unknown()),
  pushName: z.string().optional(),
  messageTimestamp: z.union([z.number().finite().nonnegative(), z.string().regex(/^\d+$/)]),
  mediaUrl: z.string().url().optional(),
});
const textSchema = z.object({
  text: z.string(),
  contextInfo: z.object({ stanzaId: z.string().optional() }).optional(),
});
const mediaSchema = z.object({
  caption: z.string().optional(),
  mimetype: z.string().optional(),
  ptt: z.boolean().optional(),
  contextInfo: z.object({ stanzaId: z.string().optional() }).optional(),
});
function contentOf(rawMessage: Record<string, unknown>, mediaUrl?: string): { content: Content; replyTo?: string } {
  let message = rawMessage;
  // Unwrap common Baileys containers while bounding depth.
  for (let depth = 0; depth < 5; depth++) {
    const wrapped =
      message.ephemeralMessage ??
      message.viewOnceMessage ??
      message.viewOnceMessageV2 ??
      message.documentWithCaptionMessage;
    if (wrapped === undefined) break;
    message = z.object({ message: z.record(z.unknown()) }).parse(wrapped).message;
  }
  if (message.conversation !== undefined)
    return { content: { type: 'text', text: z.string().parse(message.conversation) } };
  if (message.extendedTextMessage !== undefined) {
    const data = textSchema.parse(message.extendedTextMessage);
    return { content: { type: 'text', text: data.text }, replyTo: data.contextInfo?.stanzaId };
  }
  for (const type of ['image', 'audio', 'video', 'document', 'sticker'] as const) {
    if (message[`${type}Message`] === undefined) continue;
    const data = mediaSchema.parse(message[`${type}Message`]);
    // Baileys .url is encrypted transport data, never a usable public attachment.
    return {
      content: {
        type,
        text: data.caption,
        mediaUrl,
        mimeType: data.mimetype,
        isVoiceNote: type === 'audio' && data.ptt,
      },
      replyTo: data.contextInfo?.stanzaId,
    };
  }
  return { content: { type: 'unknown' } };
}
function normalizeConnection(payloadData: unknown, instanceName: string): EvolutionEvent[] {
  const data = z
    .object({
      instance: z.string().optional(),
      state: z.enum(['open', 'close', 'connecting', 'refused']),
      wuid: z.string().nullish(),
      profileName: z.string().nullish(),
      profilePictureUrl: z.string().url().nullish(),
    })
    .parse(payloadData);
  if (data.instance && data.instance !== instanceName) throw new Error('Evolution connection mismatch');
  return [
    {
      type: 'connection',
      state: data.state === 'open' ? 'connected' : data.state === 'connecting' ? 'connecting' : 'disconnected',
      owner: data.wuid ? canonicalJid(data.wuid) : undefined,
      profileName: data.profileName ?? undefined,
      profilePicUrl: data.profilePictureUrl ?? undefined,
    },
  ];
}
function normalizeQr(payloadData: unknown, instanceName: string): EvolutionEvent[] {
  const data = z
    .object({
      qrcode: z
        .object({
          instance: z.string().optional(),
          base64: z.string().min(1).optional(),
          code: z.string().min(1).optional(),
        })
        .optional(),
      statusCode: z.number().optional(),
    })
    .parse(payloadData);
  if (!data.qrcode) {
    if (data.statusCode) return [{ type: 'connection', state: 'disconnected' }];
    throw new Error('Missing QR');
  }
  if (data.qrcode.instance && data.qrcode.instance !== instanceName) throw new Error('Evolution QR mismatch');
  const code = data.qrcode.base64 ?? data.qrcode.code;
  if (!code) throw new Error('Missing QR');
  return [{ type: 'qr', code }];
}
function normalizeMessages(payloadData: unknown): EvolutionEvent[] {
  const batch = Array.isArray(payloadData) ? payloadData : [payloadData];
  return batch.flatMap((rawMessage): EvolutionEvent[] => {
    const data = messageSchema.parse(rawMessage);
    if (data.key.remoteJid === 'status@broadcast' || data.key.remoteJid.endsWith('@newsletter')) return [];
    const chatId = canonicalJid(data.key.remoteJid);
    const from = data.key.participant ? canonicalJid(data.key.participant) : chatId;
    const content = contentOf(data.message, data.mediaUrl);
    // Retain message data only; envelope carries apikey, destination and server_url.
    const safeRaw = {
      key: data.key,
      message: data.message,
      pushName: data.pushName,
      messageTimestamp: data.messageTimestamp,
      mediaUrl: data.mediaUrl,
    };
    return [
      {
        type: 'message',
        id: data.key.id,
        chatId,
        from,
        fromMe: data.key.fromMe,
        senderName: data.pushName,
        timestamp: Number(data.messageTimestamp) * 1000,
        ...content,
        raw: safeRaw,
      },
    ];
  });
}
function normalizeReceipts(payloadData: unknown, timestamp: number): EvolutionEvent[] {
  const batch = Array.isArray(payloadData) ? payloadData : [payloadData];
  return batch.flatMap((rawReceipt): EvolutionEvent[] => {
    const data = z
      .object({ keyId: z.string().min(1), remoteJid: z.string().min(1), fromMe: z.boolean(), status: z.string() })
      .parse(rawReceipt);
    if (!data.fromMe || data.remoteJid === 'status@broadcast') return [];
    const status =
      data.status === 'DELIVERY_ACK'
        ? 'delivered'
        : ['READ', 'PLAYED'].includes(data.status)
          ? 'read'
          : data.status === 'ERROR'
            ? 'failed'
            : undefined;
    return status ? [{ type: 'receipt', id: data.keyId, chatId: canonicalJid(data.remoteJid), status, timestamp }] : [];
  });
}
export function normalizeEvolution(raw: unknown, instanceName: string): EvolutionEvent[] {
  const payload = envelope.parse(raw);
  if (payload.instance !== instanceName) throw new Error('Evolution instance mismatch');
  const event = payload.event.replace(/[.-]/g, '_').toUpperCase();
  if (event === 'CONNECTION_UPDATE') return normalizeConnection(payload.data, instanceName);
  if (event === 'QRCODE_UPDATED') return normalizeQr(payload.data, instanceName);
  if (event === 'MESSAGES_UPSERT' || event === 'SEND_MESSAGE') return normalizeMessages(payload.data);
  if (event === 'MESSAGES_UPDATE')
    return normalizeReceipts(payload.data, payload.date_time ? Date.parse(payload.date_time) : Date.now());
  // History is deliberately not replayed as realtime ingress.
  return [];
}
