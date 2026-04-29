/**
 * Gupshup-specific types for the channel plugin
 *
 * Inbound: Gupshup native format (messageobj/senderobj/contextobj)
 * Outbound: Custom Integration callback URL
 */

// Instance config
export interface GupshupConfig {
  gupshupCallbackUrl: string; // required — Custom Integration callback URL
  gupshupAuthToken: string; // required — Custom Integration auth token
  gupshupEventId?: string; // optional, default: "nx_omni_agent_reply"
  webhookVerifyToken?: string; // optional — skip token check if not set
}

// Outbound message shape (internal)
export interface GupshupOutboundMessage {
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'STICKER' | 'LOCATION' | 'HANDOFF' | 'CLOSE_CONTACT';
  text?: string;
  url?: string;
  caption?: string;
  filename?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
  dados_lead?: string;
  motivo_handoff?: string;
  handoff_fields?: Record<string, unknown>;
  // Close-contact fields — present only on type === 'CLOSE_CONTACT'
  close_reason?: string;
  close_outcome?: string;
  close_fields?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────
// Inbound — Gupshup native format
// Content-Type arrives as application/x-www-form-urlencoded but body is raw JSON.
// Parse with JSON.parse(await request.text()).
// ─────────────────────────────────────────────────────────────

export interface GupshupNativeMessageObj {
  id: string; // wamid — use as message ID
  type: 'text' | 'audio' | 'image' | 'video' | 'sticker' | 'file' | 'contacts' | 'location' | string;
  from: string; // sender phone
  timestamp: number; // unix seconds

  // text
  text?: string;

  // media (audio, image, video, sticker, file)
  url?: string;
  contentType?: string; // MIME type
  mediaId?: string;
  fileName?: string; // file/document only

  // location — lat/lng arrive as strings, not numbers
  latitude?: string;
  longitude?: string;
  address?: string;
  name?: string; // place name (location) or contact-related

  // reply context — present when user replies to a prior message
  replyContext?: {
    id: string;
    internalId?: string;
  };

  raw?: {
    payload?: Record<string, unknown>;
    sender?: { name?: string; phone?: string; country_code?: string; dial_code?: string };
    type?: string;
    id?: string;
    source?: string;
    context?: Record<string, unknown>;
  };
}

export interface GupshupNativeSenderObj {
  channelid: string; // sender phone
  display?: string; // display name
  channeltype?: string;
}

export interface GupshupNativeContextObj {
  senderName?: string;
  botname?: string;
  channeltype?: string;
  contexttype?: string;
  contextid?: string;
  preventReply?: boolean;
  cc?: string;
  dc?: string;
}

export interface GupshupNativeInboundWebhook {
  source?: string;
  sender: string; // remetente phone
  channel: string; // "whatsapp"
  isGroup?: boolean;
  destination: string | number;
  botname: string; // instance identifier
  event_type: string; // "user_input" / "async_response" / "click_to_chat_advertise" for inbound messages; non-message events (message_event, billing_event, etc.) are dropped upstream
  message?: string; // redundant — prefer messageobj
  postbackText?: string | null;
  senderobj: GupshupNativeSenderObj;
  contextobj?: GupshupNativeContextObj;
  messageobj: GupshupNativeMessageObj;
  messageHeader?: {
    event_type?: string;
    nsTraceId?: string;
    project_id?: string;
    'x-gs-priority'?: number;
  };
}

// API response
export interface GupshupSendResponse {
  status?: string;
  [key: string]: unknown;
}

export interface GupshupErrorResponse {
  status: 'error';
  message: string;
  errorCode?: string;
}
