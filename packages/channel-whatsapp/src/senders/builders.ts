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
 * Build text message content
 */
const buildText: ContentBuilder = (message) => ({
  text: message.content.text || '',
});

/**
 * Build image message content
 */
const buildImage: ContentBuilder = (message) => ({
  image: { url: message.content.mediaUrl || '' },
  caption: message.content.caption,
  mimetype: message.content.mimeType,
});

/**
 * Build audio message content
 */
const buildAudio: ContentBuilder = (message) => {
  const isPtt = message.content.mimeType?.includes('ogg') || (message.metadata?.ptt as boolean) === true;
  return {
    audio: { url: message.content.mediaUrl || '' },
    mimetype: message.content.mimeType || 'audio/ogg; codecs=opus',
    ptt: isPtt,
  };
};

/**
 * Build video message content
 */
const buildVideo: ContentBuilder = (message) => ({
  video: { url: message.content.mediaUrl || '' },
  caption: message.content.caption,
  mimetype: message.content.mimeType,
});

/**
 * Build document message content
 */
const buildDocument: ContentBuilder = (message) => ({
  document: { url: message.content.mediaUrl || '' },
  mimetype: message.content.mimeType || 'application/octet-stream',
  fileName: message.content.filename || 'document',
});

/**
 * Build sticker message content
 */
const buildSticker: ContentBuilder = (message) => ({
  sticker: { url: message.content.mediaUrl || '' },
});

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
