/**
 * Channel type definitions
 */

export const CHANNEL_TYPES = ['whatsapp-baileys', 'whatsapp-cloud', 'discord', 'slack', 'telegram'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CONTENT_TYPES = [
  'text',
  'audio',
  'image',
  'video',
  'document',
  'sticker',
  'contact',
  'location',
  'reaction',
] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const DEBOUNCE_MODES = ['disabled', 'fixed', 'randomized'] as const;
export type DebounceMode = (typeof DEBOUNCE_MODES)[number];

export const SPLIT_DELAY_MODES = ['disabled', 'fixed', 'randomized'] as const;
export type SplitDelayMode = (typeof SPLIT_DELAY_MODES)[number];

export const RULE_TYPES = ['allow', 'deny'] as const;
export type RuleType = (typeof RULE_TYPES)[number];

/**
 * Base interface for channel plugins
 */
export interface ChannelPlugin {
  readonly id: string;
  readonly name: string;
  readonly channelType: ChannelType;

  initialize(config: ChannelConfig): Promise<void>;
  shutdown(): Promise<void>;

  sendMessage(instanceId: string, message: ChannelOutgoingMessage): Promise<ChannelSendResult>;
  handleWebhook?(request: Request): Promise<Response>;
}

export interface ChannelConfig {
  instanceId: string;
  credentials: Record<string, unknown>;
  options?: Record<string, unknown>;
}

export interface ChannelOutgoingMessage {
  to: string;
  content: MessageContent;
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface MessageContent {
  type: ContentType;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  filename?: string;
  caption?: string;
}

export interface ChannelSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
  timestamp: number;
}
