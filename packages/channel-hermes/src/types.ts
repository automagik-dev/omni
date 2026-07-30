/**
 * Internal types for the Hermes (Mutant) channel plugin.
 *
 * Hermes payloads are Cloud-API-shaped but NOT identical to Meta's:
 *   - Every request is wrapped in a `{ message: { media_id, ... } }` envelope
 *     (the client injects `media_id` — the Hermes UUID of the WhatsApp LINE).
 *   - `text` is a plain STRING (On-Premises style), not `{ body }`.
 *   - Media rides flat on the message object (`content_type` + `url` | `id`),
 *     except stickers which use `sticker: { link }`.
 *
 * Shared webhook schemas live in @omni/core →
 * packages/core/src/schemas/hermes.ts (envelope) + whatsapp-cloud.ts (inner
 * message/status shapes). Source of truth: the official Mutant Postman
 * collection ("Hermes API").
 */

/** Per-instance Hermes config persisted on the `instances` table. */
export interface HermesConfig {
  /** Base URL of the Hermes deployment (e.g. https://hermes.mutant.com.br). */
  baseUrl: string;
  username: string;
  password: string;
  /** Hermes UUID of the WhatsApp line — sent on every request + webhook cross-check key. */
  mediaId: string;
  /** Template namespace registered with Meta for this line (HSM sends). */
  templateNamespace?: string;
}

/** `location` object for type=location. */
export interface HermesLocationPayload {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

/** Simplified contact card input expanded into the Cloud-API `contacts[]` shape. */
export interface HermesContactCardInput {
  /** Display name (becomes formatted_name). */
  name: string;
  /** Optional phone numbers (any format — normalized to digits for wa_id). */
  phones?: string[];
  /** Optional email addresses. */
  emails?: string[];
}

/** One expanded `contacts[]` record (Cloud API contact shape, Hermes passthrough). */
export interface HermesContactRecord {
  name: { formatted_name: string; first_name?: string };
  phones?: Array<{ phone: string; type?: string; wa_id?: string }>;
  emails?: Array<{ email: string; type?: string }>;
}

/** `template` object for type=template (namespace is Hermes-mandatory). */
export interface HermesTemplatePayload {
  namespace: string;
  language: { policy: 'deterministic'; code: string };
  name: string;
  components?: Array<{
    type: 'body';
    parameters: Array<{ type: 'text'; text: string }>;
  }>;
}

/** `interactive` object for type=interactive — button + list variants. */
export interface HermesInteractiveButtonPayload {
  type: 'button';
  body: { text: string };
  action: {
    buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }>;
  };
}

export interface HermesInteractiveListPayload {
  type: 'list';
  header?: { type: 'text'; text: string };
  body: { text: string };
  footer?: { text: string };
  action: {
    button: string;
    sections: Array<{
      title?: string;
      rows: Array<{ id: string; title: string; description?: string }>;
    }>;
  };
}

export type HermesInteractivePayload = HermesInteractiveButtonPayload | HermesInteractiveListPayload;

/**
 * Inner `message` object POSTed to /api/v2/messages — WITHOUT `media_id`,
 * which `HermesClient.sendMessage` injects from its configured line UUID.
 */
export interface HermesOutboundMessage {
  to: string;
  recipient_type?: 'individual';
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
  /** Plain string — Hermes uses the On-Premises text shape, NOT `{ body }`. */
  text?: string;
  /** Media by public URL (image/audio/video/document). */
  url?: string;
  /** Media by pre-uploaded file id (POST /api/v2/upload). */
  id?: string;
  /** MIME type accompanying `url` | `id` media sends. */
  content_type?: string;
  caption?: string;
  /** Stickers use the link object form (public .webp URL). */
  sticker?: { link: string };
  location?: HermesLocationPayload;
  contacts?: HermesContactRecord[];
  reaction?: { message_id: string; emoji: string };
  template?: HermesTemplatePayload;
  interactive?: HermesInteractivePayload;
  /** Reply to an incoming message id (wamid). */
  context?: { message_id: string };
  biz_opaque_callback_data?: string;
}

/** Response envelope from POST /api/v2/messages — `message.id` is the Hermes UUID. */
export interface HermesSendResponse {
  message?: { id: string };
}

/** Response from POST /api/v2/users/sign_in. */
export interface HermesSignInResponse {
  jwt: string;
}

/** Response from POST /api/v2/upload. */
export interface HermesUploadResponse {
  id: string;
}
