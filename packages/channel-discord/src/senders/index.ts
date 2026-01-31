/**
 * Message senders
 *
 * Provides functions for building and sending various message types.
 */

// Text
export { buildTextContent, sendTextMessage, editTextMessage, deleteMessage } from './text';

// Media (image, audio, video, document)
export { buildMediaContent, sendMediaMessage, sendMultipleFiles, sendMediaBuffer } from './media';

// Embeds
export {
  buildEmbed,
  buildEmbedContent,
  sendEmbedMessage,
  editEmbedMessage,
  createInfoEmbed,
  createSuccessEmbed,
  createWarningEmbed,
  createErrorEmbed,
} from './embeds';

// Reactions
export { addReaction, removeReaction, removeUserReaction, removeAllReactions, removeEmojiReactions } from './reaction';

// Stickers
export { buildStickerContent, sendStickerMessage, getGuildStickers, getSticker } from './sticker';

// Polls
export { buildPoll, sendPollMessage, endPoll, getPollResults } from './poll';

// Unified content builder
export { buildMessageContent, isSupportedContentType, getFileType } from './builders';
