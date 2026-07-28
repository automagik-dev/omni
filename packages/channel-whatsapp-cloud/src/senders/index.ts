/**
 * Meta WhatsApp Cloud — sender barrel.
 *
 * Each sender takes a `MetaWhatsAppClient` plus call-site arguments and
 * returns the raw `MetaSendResponse` from Graph API. Higher-level
 * dispatch (mapping `OutgoingMessage.content.type` to a sender) lives in
 * `plugin.ts::sendMessage`.
 */

export { sendText } from './text';
export { sendMedia, resolveMetaMediaType, type MetaMediaKind } from './media';
export { sendLocation } from './location';
export { sendContact, type ContactInput } from './contact';
export { sendReaction } from './reaction';
export {
  sendTemplate,
  type SendTemplateButton,
  type SendTemplateHeaderMedia,
} from './template';
