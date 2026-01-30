/**
 * Media message senders (image, audio, video, document, sticker)
 */

import type { AnyMessageContent, WASocket } from '@whiskeysockets/baileys';

/**
 * Build image message content
 */
export function buildImageContent(
  mediaUrl: string,
  options?: {
    caption?: string;
    mimeType?: string;
  },
): AnyMessageContent {
  return {
    image: { url: mediaUrl },
    caption: options?.caption,
    mimetype: options?.mimeType,
  };
}

/**
 * Build audio message content
 *
 * @param ptt - If true, sends as voice note (push-to-talk)
 */
export function buildAudioContent(
  mediaUrl: string,
  options?: {
    mimeType?: string;
    ptt?: boolean;
  },
): AnyMessageContent {
  return {
    audio: { url: mediaUrl },
    mimetype: options?.mimeType || 'audio/ogg; codecs=opus',
    ptt: options?.ptt ?? false,
  };
}

/**
 * Build video message content
 */
export function buildVideoContent(
  mediaUrl: string,
  options?: {
    caption?: string;
    mimeType?: string;
  },
): AnyMessageContent {
  return {
    video: { url: mediaUrl },
    caption: options?.caption,
    mimetype: options?.mimeType,
  };
}

/**
 * Build document message content
 */
export function buildDocumentContent(
  mediaUrl: string,
  options?: {
    filename?: string;
    mimeType?: string;
    caption?: string;
  },
): AnyMessageContent {
  return {
    document: { url: mediaUrl },
    fileName: options?.filename || 'document',
    mimetype: options?.mimeType || 'application/octet-stream',
    caption: options?.caption,
  };
}

/**
 * Build sticker message content
 */
export function buildStickerContent(mediaUrl: string): AnyMessageContent {
  return {
    sticker: { url: mediaUrl },
  };
}

/**
 * Send an image message
 */
export async function sendImageMessage(
  sock: WASocket,
  jid: string,
  mediaUrl: string,
  options?: {
    caption?: string;
    mimeType?: string;
    replyToId?: string;
  },
): Promise<string | undefined> {
  const content = buildImageContent(mediaUrl, options);

  const result = await sock.sendMessage(
    jid,
    content,
    options?.replyToId ? { quoted: { key: { id: options.replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}

/**
 * Send an audio message
 */
export async function sendAudioMessage(
  sock: WASocket,
  jid: string,
  mediaUrl: string,
  options?: {
    mimeType?: string;
    ptt?: boolean;
    replyToId?: string;
  },
): Promise<string | undefined> {
  const content = buildAudioContent(mediaUrl, options);

  const result = await sock.sendMessage(
    jid,
    content,
    options?.replyToId ? { quoted: { key: { id: options.replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}

/**
 * Send a video message
 */
export async function sendVideoMessage(
  sock: WASocket,
  jid: string,
  mediaUrl: string,
  options?: {
    caption?: string;
    mimeType?: string;
    replyToId?: string;
  },
): Promise<string | undefined> {
  const content = buildVideoContent(mediaUrl, options);

  const result = await sock.sendMessage(
    jid,
    content,
    options?.replyToId ? { quoted: { key: { id: options.replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}

/**
 * Send a document message
 */
export async function sendDocumentMessage(
  sock: WASocket,
  jid: string,
  mediaUrl: string,
  options?: {
    filename?: string;
    mimeType?: string;
    caption?: string;
    replyToId?: string;
  },
): Promise<string | undefined> {
  const content = buildDocumentContent(mediaUrl, options);

  const result = await sock.sendMessage(
    jid,
    content,
    options?.replyToId ? { quoted: { key: { id: options.replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}

/**
 * Send a sticker message
 */
export async function sendStickerMessage(
  sock: WASocket,
  jid: string,
  mediaUrl: string,
  replyToId?: string,
): Promise<string | undefined> {
  const content = buildStickerContent(mediaUrl);

  const result = await sock.sendMessage(
    jid,
    content,
    replyToId ? { quoted: { key: { id: replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}
