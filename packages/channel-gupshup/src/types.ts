/**
 * Gupshup-specific types for the channel plugin
 *
 * Inbound: Gupshup native format (messageobj/senderobj/contextobj)
 * Outbound: Custom Integration callback URL
 */

import type { GupshupCustomerField, GupshupHandoffOptions } from './handoff-options';

// Instance config
export interface GupshupConfig {
  gupshupCallbackUrl: string; // required — Custom Integration callback URL
  gupshupAuthToken: string; // required — Custom Integration auth token
  gupshupEventId?: string; // optional, default: "nx_omni_agent_reply"
  webhookVerifyToken?: string; // optional — skip token check if not set
  /** Validated HANDOFF routing defaults + customerFields template (see handoff-options.ts). */
  handoffOptions?: GupshupHandoffOptions;
}

// Outbound message shape (internal)
export interface GupshupOutboundMessage {
  type:
    | 'TEXT'
    | 'IMAGE'
    | 'AUDIO'
    | 'VIDEO'
    | 'DOCUMENT'
    | 'STICKER'
    | 'LOCATION'
    | 'HANDOFF'
    | 'CLOSING'
    | 'BUTTONS'
    | 'LIST'
    | 'FLOW';
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
  /** Custom Integration contact fields, rendered from the instance template — HANDOFF only. */
  customer_fields?: GupshupCustomerField[];
  // Close-contact fields — present only on type === 'CLOSING' (the wire
  // literal Gupshup's Journey routes on; the Omni-side concept is "close
  // contact" but the partner contract uses 'CLOSING').
  close_reason?: string;
  close_outcome?: string;
  close_fields?: Record<string, unknown>;
  /** Reply buttons — present only on type === 'BUTTONS' (≤3, title ≤20 chars). */
  buttons?: GupshupReplyButton[];
  /** List message — present only on type === 'LIST' (≤10 rows). */
  list?: GupshupListMessage;
  /** WhatsApp Flow descriptor — present only on type === 'FLOW'. */
  flow?: GupshupFlowMessage;
}

export interface GupshupReplyButton {
  /** Echoed back when the contact taps it; defaults to the title. */
  id: string;
  title: string;
}

export interface GupshupListMessage {
  /** Label of the button that opens the list (≤20 chars). */
  button: string;
  section_title?: string;
  rows: Array<{ id: string; title: string; description?: string }>;
}

export interface GupshupFlowMessage {
  /** Meta flow id (the Journey's WhatsApp Flow node needs the id, not the name). */
  id: string;
  /** Label of the button that opens the flow. */
  cta: string;
  /** Correlates the submission back to this send. */
  token: string;
  /** 'navigate' (static flow) or 'data_exchange' (endpoint-backed). */
  action: 'navigate' | 'data_exchange';
  /** First screen — navigate only. */
  screen?: string;
  /** Initial data for the first screen — navigate only. */
  data?: Record<string, unknown>;
  header?: string;
  footer?: string;
  /** Send the unpublished (draft) version — for testing. */
  draft?: boolean;
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
    /** WhatsApp Flow submission (normalized from the Flow Journey's API node). */
    flowResponse?: { flowToken: string; flowId?: string; answers: Record<string, unknown> };
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
