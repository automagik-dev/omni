/**
 * Inbound activity handlers — translate Bot Framework activities into Omni
 * events. The plugin's `handleWebhook()` reads the body, runs it through
 * `dispatchActivity`, and emits via `emitMessageReceived` /
 * `emitReactionReceived` / etc.
 */

export type { InboundActivity, MentionEntity, TeamsChannelData } from './activity-types';
export { extractAttachments } from './attachments';
export type { AttachmentExtractionResult, ExtractedMedia } from './attachments';
export { classifyConversation, deriveChatId, extractTeamsChannelData, toActivityMeta } from './conversation';
export { parseMentions, stripMentionMarkup } from './mentions';
export type { MentionParseResult, ParsedMention } from './mentions';
export { parseInboundMessage } from './messages';
export type { ParsedInboundMessage } from './messages';
export { parseReactionActivity } from './reactions';
export type { ParsedReactionEvent } from './reactions';
