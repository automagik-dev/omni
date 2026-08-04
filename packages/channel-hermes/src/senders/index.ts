/**
 * Hermes — sender barrel.
 *
 * Each sender takes a `HermesClient` plus call-site arguments and returns
 * the raw `HermesSendResponse` (`message.id` = Hermes UUID). Higher-level
 * dispatch (mapping `OutgoingMessage.content.type` to a sender) lives in
 * `plugin.ts::sendMessage`.
 */

export { sendText } from './text';
export { sendMedia, resolveHermesMediaType, type HermesMediaKind, type HermesMediaSource } from './media';
export { sendLocation } from './location';
export { sendContact } from './contact';
export { sendReaction } from './reaction';
export { sendTemplate, type SendTemplateOptions } from './template';
export {
  sendInteractiveButtons,
  sendInteractiveList,
  sendLocationRequest,
  sendPlannedInteractive,
  type InteractiveButton,
  type InteractiveListSection,
  type SendInteractiveListOptions,
} from './interactive';
