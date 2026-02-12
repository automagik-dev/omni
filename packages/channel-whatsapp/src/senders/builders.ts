/**
 * Content builders for outgoing WhatsApp messages
 *
 * Maps content types to Baileys AnyMessageContent builders.
 * Each builder handles one specific content type.
 */

import type { OutgoingMessage } from '@omni/channel-sdk';
import type { AnyMessageContent } from '@whiskeysockets/baileys';
import { toJid } from '../jid';
import { ErrorCode, WhatsAppError } from '../utils/errors';

type ContentBuilder = (message: OutgoingMessage, buildVCard: VCardBuilder) => AnyMessageContent;
type VCardBuilder = (contact: { name: string; phone?: string; email?: string }) => string;

/**
 * Extract media source from an outgoing message.
 *
 * Priority: base64 metadata > URL.
 * Shared across image, video, document, and sticker builders.
 */
const getMediaSource = (message: OutgoingMessage): Buffer | { url: string } => {
  const base64 = message.metadata?.base64 as string | undefined;
  return base64 ? Buffer.from(base64, 'base64') : { url: message.content.mediaUrl || '' };
};

/**
 * Convert a phone number or partial JID to full WhatsApp JID
 */
function toMentionJid(phoneOrJid: string): string {
  if (phoneOrJid.includes('@')) {
    return phoneOrJid;
  }
  const cleaned = phoneOrJid.replace(/\D/g, '');
  return `${cleaned}@s.whatsapp.net`;
}

/**
 * Build text message content with optional mentions
 *
 * Also handles forward messages when metadata.forward is present.
 *
 * WhatsApp mentions require:
 * 1. The `mentions` array with JIDs
 * 2. The text containing `@number` placeholders where mentions should appear
 *
 * If text doesn't contain @mentions, we prepend them.
 */
const buildText: ContentBuilder = (message) => {
  // Check for forward in metadata - forward takes precedence
  const forwardData = message.metadata?.forward as
    | {
        messageId: string;
        fromChatId: string;
        rawPayload?: Record<string, unknown>;
      }
    | undefined;

  if (forwardData) {
    // If we have the full rawPayload from DB, use it directly for proper forwarding
    if (forwardData.rawPayload) {
      return {
        forward: forwardData.rawPayload,
      } as unknown as AnyMessageContent;
    }

    // Fallback: construct key reference (may not work if message not in Baileys memory)
    return {
      forward: {
        key: {
          remoteJid: toJid(forwardData.fromChatId),
          id: forwardData.messageId,
        },
      },
    } as unknown as AnyMessageContent;
  }

  const text = message.content.text || '';

  // Extract mentions from metadata (if any)
  const mentionJids = extractMentionJids(message);
  if (mentionJids) {
    // WhatsApp renders mentions where @{phone} appears in text.
    // The caller should place @phone in text for proper rendering.
    // We pass the mentions array as-is — no text modification.
    return { text, mentions: mentionJids };
  }

  return { text };
};

/**
 * Extract mention JIDs from message metadata (if any).
 * Reusable across text, image, and video builders.
 */
function extractMentionJids(message: OutgoingMessage): string[] | undefined {
  const mentions = message.metadata?.mentions as Array<{ id: string; type?: string }> | undefined;
  if (!mentions || mentions.length === 0) return undefined;
  const userMentions = mentions.filter((m) => !m.type || m.type === 'user');
  if (userMentions.length === 0) return undefined;
  return userMentions.map((m) => toMentionJid(m.id));
}

/**
 * Build image message content
 *
 * Supports URL and base64. Priority: base64 > URL
 * Supports mentions in captions.
 */
const buildImage: ContentBuilder = (message) => {
  const mentionJids = extractMentionJids(message);
  return {
    image: getMediaSource(message),
    caption: message.content.caption,
    mimetype: message.content.mimeType,
    ...(mentionJids ? { mentions: mentionJids } : {}),
  };
};

/**
 * Build audio message content
 *
 * Supports URL, buffer (for converted audio), and base64.
 * Priority: audioBuffer > base64 > URL
 *
 * For PTT (voice notes), Baileys automatically generates waveform and duration
 * via its audio processing pipeline (music-metadata for duration, audio-decode
 * for waveform). We provide a workspace audio-decode shim (ffmpeg-based) since
 * the npm audio-decode package crashes in Bun.
 */
const buildAudio: ContentBuilder = (message) => {
  const isPtt = message.content.mimeType?.includes('ogg') || (message.metadata?.ptt as boolean) === true;
  const audioBuffer = message.metadata?.audioBuffer as Buffer | undefined;
  const base64 = message.metadata?.base64 as string | undefined;

  // Priority: buffer > base64 > URL
  let audioSource: Buffer | { url: string };
  if (audioBuffer) {
    audioSource = audioBuffer;
  } else if (base64) {
    audioSource = Buffer.from(base64, 'base64');
  } else {
    audioSource = { url: message.content.mediaUrl || '' };
  }

  // Don't set `seconds` — Baileys needs it undefined so it saves the original
  // file to disk, which is then used for both duration (music-metadata) and
  // waveform (audio-decode shim via ffmpeg) computation.
  return {
    audio: audioSource,
    mimetype: message.content.mimeType || 'audio/ogg; codecs=opus',
    ptt: isPtt,
  };
};

/**
 * Build video message content
 *
 * Supports URL and base64. Priority: base64 > URL
 * Supports mentions in captions.
 */
const buildVideo: ContentBuilder = (message) => {
  const mentionJids = extractMentionJids(message);
  return {
    video: getMediaSource(message),
    caption: message.content.caption,
    ...(mentionJids ? { mentions: mentionJids } : {}),
    mimetype: message.content.mimeType,
  };
};

/**
 * Build document message content
 *
 * Supports URL and base64. Priority: base64 > URL
 */
const buildDocument: ContentBuilder = (message) => {
  return {
    document: getMediaSource(message),
    mimetype: message.content.mimeType || 'application/octet-stream',
    fileName: message.content.filename || 'document',
  };
};

/**
 * Build sticker message content
 *
 * Supports URL and base64. Priority: base64 > URL
 */
const buildSticker: ContentBuilder = (message) => {
  return {
    sticker: getMediaSource(message),
  };
};

/**
 * Build location message content
 */
const buildLocation: ContentBuilder = (message) => {
  if (!message.content.location) {
    throw new WhatsAppError(ErrorCode.SEND_FAILED, 'Location content missing location data');
  }
  return {
    location: {
      degreesLatitude: message.content.location.latitude,
      degreesLongitude: message.content.location.longitude,
      name: message.content.location.name,
      address: message.content.location.address,
    },
  };
};

/**
 * Build contact message content
 */
const buildContact: ContentBuilder = (message, buildVCard) => {
  if (!message.content.contact) {
    throw new WhatsAppError(ErrorCode.SEND_FAILED, 'Contact content missing contact data');
  }
  return {
    contacts: {
      contacts: [
        {
          displayName: message.content.contact.name,
          vcard: buildVCard(message.content.contact),
        },
      ],
    },
  };
};

/**
 * Build reaction message content
 */
const buildReaction: ContentBuilder = (message) => {
  if (!message.content.targetMessageId) {
    throw new WhatsAppError(ErrorCode.SEND_FAILED, 'Reaction content missing target message ID');
  }
  return {
    react: {
      text: message.content.emoji || '',
      key: {
        remoteJid: toJid(message.to),
        id: message.content.targetMessageId,
        fromMe: true,
      },
    },
  };
};

/**
 * Build poll message content
 *
 * Uses Baileys poll format:
 * { poll: { name: string, values: string[], selectableCount: number } }
 */
const buildPoll: ContentBuilder = (message) => {
  const pollData = message.metadata?.poll as
    | {
        question: string;
        answers: string[];
        multiSelect?: boolean;
      }
    | undefined;

  if (!pollData) {
    throw new WhatsAppError(ErrorCode.SEND_FAILED, 'Poll content missing poll data in metadata');
  }

  return {
    poll: {
      name: pollData.question,
      values: pollData.answers,
      // selectableCount: 0 = unlimited selections, 1 = single select
      selectableCount: pollData.multiSelect ? 0 : 1,
    },
  } as unknown as AnyMessageContent;
};

/**
 * Map of content type to builder function
 */
const contentBuilders: Record<string, ContentBuilder> = {
  text: buildText,
  image: buildImage,
  audio: buildAudio,
  video: buildVideo,
  document: buildDocument,
  sticker: buildSticker,
  location: buildLocation,
  contact: buildContact,
  reaction: buildReaction,
  poll: buildPoll,
};

/**
 * Build Baileys message content from OutgoingMessage
 *
 * Uses a lookup table instead of switch statement to reduce complexity.
 */
export function buildMessageContent(message: OutgoingMessage, buildVCard: VCardBuilder): AnyMessageContent {
  const builder = contentBuilders[message.content.type];

  if (!builder) {
    throw new WhatsAppError(ErrorCode.SEND_FAILED, `Unsupported content type: ${message.content.type}`);
  }

  return builder(message, buildVCard);
}
