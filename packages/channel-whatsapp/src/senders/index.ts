/**
 * Message senders
 *
 * Provides functions for building and sending various message types.
 */

// Text
export { buildTextContent, sendTextMessage } from './text';

// Media (image, audio, video, document, sticker)
export {
  buildImageContent,
  buildAudioContent,
  buildVideoContent,
  buildDocumentContent,
  buildStickerContent,
  sendImageMessage,
  sendAudioMessage,
  sendVideoMessage,
  sendDocumentMessage,
  sendStickerMessage,
} from './media';

// Reaction
export {
  buildReactionContent,
  sendReaction,
  removeReaction,
} from './reaction';

// Location
export {
  buildLocationContent,
  sendLocationMessage,
  isValidLocation,
  type LocationData,
} from './location';

// Contact
export {
  buildVCard,
  buildContactContent,
  buildMultiContactContent,
  sendContactMessage,
  sendMultiContactMessage,
  type ContactData,
} from './contact';

// Unified content builder
export { buildMessageContent } from './builders';
