/**
 * Gupshup-specific types for the channel plugin
 */

/**
 * Gupshup instance configuration
 */
export interface GupshupConfig {
  /** API key from Gupshup dashboard */
  gupshupApiKey: string;

  /** App name tied to the WhatsApp number in Gupshup */
  gupshupAppName: string;

  /** E.164 phone number managed by Gupshup (e.g. +5511999999999) */
  gupshupSourcePhone: string;

  /** Token for webhook validation (compared against query param on inbound POST) */
  webhookVerifyToken: string;
}

// ─────────────────────────────────────────────────────────────
// Inbound webhook payload types
// ─────────────────────────────────────────────────────────────

/**
 * Top-level Gupshup inbound webhook payload
 * Covers message events, delivery receipts, and read receipts
 */
export interface GupshupInboundPayload {
  app: string;
  timestamp: number;
  version: number;
  type: 'message' | 'message-event';
  payload: GupshupMessagePayload | GupshupMessageEventPayload;
}

/**
 * Message event payload (delivery/read receipts)
 */
export interface GupshupMessageEventPayload {
  id: string;
  gsId?: string;
  type: 'delivered' | 'read' | 'failed';
  timestamp: number;
  destination: string;
}

/**
 * Inbound message payload from Gupshup
 */
export interface GupshupMessagePayload {
  /** Unique message ID assigned by Gupshup */
  id: string;

  /** Source phone number (sender, E.164 without +) */
  source: string;

  /** Message type */
  type: GupshupMessageType;

  /** Payload content — varies by type */
  payload:
    | GupshupTextContent
    | GupshupMediaContent
    | GupshupLocationContent
    | GupshupContactContent
    | GupshupInteractiveContent;

  /** Sender info */
  sender: {
    phone: string;
    name?: string;
    country_code?: string;
    dial_code?: string;
  };
}

export type GupshupMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'location'
  | 'contact'
  | 'interactive'
  | 'sticker';

export interface GupshupTextContent {
  text: string;
}

export interface GupshupMediaContent {
  /** Public CDN URL (filemanager.gupshup.io) */
  url: string;
  caption?: string;
  filename?: string;
  /** MIME type if provided */
  contentType?: string;
}

export interface GupshupLocationContent {
  longitude: number;
  latitude: number;
  name?: string;
  address?: string;
}

export interface GupshupContactContent {
  contacts: GupshupContact[];
}

export interface GupshupContact {
  name?: { formatted_name?: string };
  phones?: Array<{ phone: string; type?: string }>;
}

export interface GupshupInteractiveContent {
  type: 'button_reply' | 'list_reply';
  button_reply?: { id: string; title: string };
  list_reply?: { id: string; title: string; description?: string };
}

// ─────────────────────────────────────────────────────────────
// API response types
// ─────────────────────────────────────────────────────────────

/**
 * Successful response from Gupshup send API
 * POST https://api.gupshup.io/wa/api/v1/msg
 */
export interface GupshupSendResponse {
  status: 'submitted' | 'success';
  messageId: string;
}

/**
 * Error response from Gupshup API
 */
export interface GupshupErrorResponse {
  status: 'error';
  message: string;
  /** Gupshup error code (numeric string) */
  errorCode?: string;
}
