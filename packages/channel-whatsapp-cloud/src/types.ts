/**
 * Internal types for the WhatsApp Cloud channel plugin.
 *
 * For shared types (template components, webhook payloads) see
 * @omni/core → packages/core/src/types/whatsapp-cloud.ts.
 */

import type {
  MetaTemplateCategory,
  MetaTemplateStatus,
  WhatsAppTemplateComponent,
} from '@omni/core/types';

/** Per-instance Meta config persisted on `instances` table. */
export interface WhatsAppCloudConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  appId?: string;
  businessId?: string;
  apiVersion: string;
  /** Provenance: 'manual' | 'embedded_signup' */
  connectionMethod: string;
  displayPhoneNumber?: string;
}

/** Global app-level config from env (META_APP_SECRET, META_VERIFY_TOKEN, etc.). */
export interface MetaAppLevelConfig {
  appId?: string;
  appSecret?: string;
  verifyToken?: string;
  apiVersion: string;
  embeddedSignupConfigId?: string;
}

/**
 * Outbound message payload as sent to Graph API:
 * POST /{phone_number_id}/messages
 */
export interface MetaOutboundMessage {
  messaging_product: 'whatsapp';
  recipient_type?: 'individual';
  to: string;
  /** type drives which optional field is present. */
  type:
    | 'text'
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'sticker'
    | 'location'
    | 'contacts'
    | 'reaction'
    | 'template'
    | 'interactive';
  context?: { message_id: string };
  text?: { body: string; preview_url?: boolean };
  image?: MetaMediaPayload;
  audio?: MetaMediaPayload;
  video?: MetaMediaPayload;
  document?: MetaMediaPayload;
  sticker?: MetaMediaPayload;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown[];
  reaction?: { message_id: string; emoji: string };
  template?: MetaTemplatePayload;
  interactive?: unknown;
  /** Mark as 'read' via POST /messages with `status: read` — only used internally for markAsRead(). */
  status?: 'read';
  message_id?: string;
}

export interface MetaMediaPayload {
  /** Either `id` (uploaded media handle) or `link` (public URL) must be set. */
  id?: string;
  link?: string;
  caption?: string;
  filename?: string;
}

export interface MetaTemplatePayload {
  name: string;
  language: { code: string; policy?: 'deterministic' };
  components?: Array<{
    type: 'header' | 'body' | 'button';
    sub_type?: 'quick_reply' | 'url' | 'copy_code';
    index?: string;
    parameters?: Array<
      | { type: 'text'; text: string }
      | { type: 'currency'; currency: { fallback_value: string; code: string; amount_1000: number } }
      | { type: 'date_time'; date_time: { fallback_value: string } }
      | { type: 'image'; image: { link?: string; id?: string } }
      | { type: 'video'; video: { link?: string; id?: string } }
      | { type: 'document'; document: { link?: string; id?: string; filename?: string } }
      | { type: 'location'; location: { latitude: number; longitude: number; name?: string; address?: string } }
      | { type: 'payload'; payload: string }
    >;
  }>;
}

/** Graph API response for POST /{phone_number_id}/messages */
export interface MetaSendResponse {
  messaging_product: 'whatsapp';
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string; message_status?: string }>;
}

/** Graph API error envelope. */
export interface MetaApiError {
  error: {
    message: string;
    type: string;
    code: number;
    error_subcode?: number;
    error_data?: { details?: string; messaging_product?: string };
    fbtrace_id?: string;
  };
}

/** Persisted template record (mirrors whatsapp_templates row). */
export interface WhatsAppTemplateRecord {
  id: string;
  instanceId: string;
  metaId: string | null;
  wabaId: string;
  name: string;
  language: string;
  category: MetaTemplateCategory;
  status: MetaTemplateStatus;
  components: WhatsAppTemplateComponent[] | null;
  rejectionReason: string | null;
  qualityScore: string | null;
}
