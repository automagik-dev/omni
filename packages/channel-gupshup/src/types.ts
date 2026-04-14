/**
 * Gupshup-specific types for the channel plugin
 * Based on Meta/WA Business API inbound + Gupshup Custom Integration outbound
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
  type: 'TEXT' | 'IMAGE' | 'AUDIO' | 'VIDEO' | 'DOCUMENT' | 'STICKER' | 'LOCATION';
  text?: string;
  url?: string;
  caption?: string;
  filename?: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  address?: string;
}

// Meta/WA Business API inbound - top level
export interface GupshupInboundWebhook {
  object: string;
  gs_app_id?: string;
  entry: GupshupEntry[];
}

export interface GupshupEntry {
  id: string;
  changes: GupshupChange[];
}

export interface GupshupChange {
  field: 'messages' | 'billing-event' | 'account_update' | string;
  value: GupshupChangeValue;
}

export interface GupshupChangeValue {
  messaging_product?: string;
  metadata?: { display_phone_number: string; phone_number_id: string };
  contacts?: GupshupInboundContact[];
  messages?: GupshupInboundMessage[];
  statuses?: GupshupStatusEvent[];
}

export interface GupshupInboundContact {
  wa_id: string;
  profile: { name: string };
}

// Status events
export interface GupshupStatusEvent {
  id: string;
  gs_id?: string;
  status: 'enqueued' | 'sent' | 'delivered' | 'read' | 'failed';
  timestamp: string;
  recipient_id?: string;
  destination?: string;
}

// Inbound message — unified
export interface GupshupInboundMessage {
  id: string;
  from: string;
  type:
    | 'text'
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'sticker'
    | 'location'
    | 'contacts'
    | 'interactive'
    | 'button';
  timestamp: string;
  context?: { id: string; from: string; gs_id?: string; meta_msg_id?: string };
  // type-specific payloads
  text?: { body: string };
  image?: { id: string; url: string; mime_type: string; sha256?: string; caption?: string };
  audio?: { id: string; url: string; mime_type: string; voice?: boolean; sha256?: string };
  video?: { id: string; url: string; mime_type: string; sha256?: string; caption?: string };
  document?: {
    id: string;
    url: string;
    mime_type: string;
    sha256?: string;
    filename?: string;
    caption?: string;
  };
  sticker?: { id: string; url: string; mime_type: string; sha256?: string; animated?: boolean };
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: Array<{
    name?: { formatted_name?: string; first_name?: string; last_name?: string };
    phones?: Array<{ phone: string; type?: string; wa_id?: string }>;
  }>;
  interactive?: {
    type: 'button_reply' | 'list_reply';
    button_reply?: { id: string; title: string };
    list_reply?: { id: string; title: string; description?: string };
  };
  button?: { text: string; payload: string };
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
