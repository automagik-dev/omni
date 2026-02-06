/**
 * Extended Message type with all fields returned by the API
 * The SDK's Message type is limited, but the API returns the full database record
 */

// Reaction info as stored in the database
export interface ReactionInfo {
  emoji: string;
  platformUserId?: string;
  personId?: string;
  displayName?: string;
  at?: string;
  isCustomEmoji?: boolean;
  customEmojiId?: string;
}

// Media metadata as stored in the database
export interface MediaMetadata {
  width?: number;
  height?: number;
  duration?: number;
  fileName?: string;
  fileSize?: number;
  isVoiceNote?: boolean;
  waveform?: number[];
  isGif?: boolean;
  processingCostUsd?: number;
  processingModel?: string;
}

// Mention info for @mentions in messages
export interface MentionInfo {
  platformUserId: string;
  displayName?: string;
  startIndex?: number;
  length?: number;
  type?: 'user' | 'role' | 'channel' | 'everyone' | 'here';
}

// Edit history entry
export interface EditHistoryEntry {
  text: string;
  at: string;
  by?: string;
}

// Message types
export type MessageType =
  | 'text'
  | 'audio'
  | 'image'
  | 'video'
  | 'document'
  | 'sticker'
  | 'contact'
  | 'location'
  | 'poll'
  | 'reaction'
  | 'system';

// Message source
export type MessageSource = 'realtime' | 'sync' | 'api' | 'import';

// Delivery status
export type DeliveryStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

// Message status
export type MessageStatus = 'active' | 'edited' | 'deleted' | 'expired';

/**
 * Extended Message interface with all API fields
 */
export interface ExtendedMessage {
  id: string;
  chatId: string;
  externalId: string;
  source: MessageSource;
  messageType: MessageType;
  textContent?: string | null;
  platformTimestamp: string;
  createdAt: string;
  updatedAt: string;

  // Sender info
  senderPersonId?: string | null;
  senderPlatformIdentityId?: string | null;
  senderPlatformUserId?: string | null;
  senderDisplayName?: string | null;
  isFromMe?: boolean;

  // Media
  hasMedia?: boolean;
  mediaMimeType?: string | null;
  mediaUrl?: string | null;
  mediaLocalPath?: string | null;
  mediaMetadata?: MediaMetadata | null;

  // LLM processing results
  transcription?: string | null;
  imageDescription?: string | null;
  videoDescription?: string | null;
  documentExtraction?: string | null;

  // Reply/forward
  replyToMessageId?: string | null;
  replyToExternalId?: string | null;
  quotedText?: string | null;
  quotedSenderName?: string | null;
  forwardedFromMessageId?: string | null;
  forwardCount?: number;
  isForwarded?: boolean;

  // Mentions
  mentions?: MentionInfo[] | null;

  // Status
  status?: MessageStatus;
  deliveryStatus?: DeliveryStatus;

  // Edit history
  editCount?: number;
  originalText?: string | null;
  editHistory?: EditHistoryEntry[] | null;

  // Reactions
  reactions?: ReactionInfo[] | null;
  reactionCounts?: Record<string, number> | null;

  // Raw data (for debugging)
  rawPayload?: unknown;
}

/**
 * Type guard to check if message has media
 */
export function hasMediaContent(message: ExtendedMessage): boolean {
  return !!(message.hasMedia && message.mediaUrl);
}

/**
 * Type guard to check if message is a media type
 */
export function isMediaType(type: MessageType): boolean {
  return ['audio', 'image', 'video', 'document', 'sticker'].includes(type);
}

/**
 * Get display name for message sender
 */
export function getSenderName(message: ExtendedMessage): string | null {
  return message.senderDisplayName || message.senderPlatformUserId || null;
}

/**
 * Aggregate reactions by emoji
 */
export function aggregateReactions(
  reactions: ReactionInfo[] | null | undefined,
): { emoji: string; count: number; users: string[] }[] {
  if (!reactions || reactions.length === 0) return [];

  const grouped = new Map<string, { count: number; users: string[] }>();

  for (const reaction of reactions) {
    const existing = grouped.get(reaction.emoji);
    const userName = reaction.displayName || reaction.platformUserId || 'Unknown';

    if (existing) {
      existing.count++;
      existing.users.push(userName);
    } else {
      grouped.set(reaction.emoji, { count: 1, users: [userName] });
    }
  }

  return Array.from(grouped.entries()).map(([emoji, data]) => ({
    emoji,
    count: data.count,
    users: data.users,
  }));
}
