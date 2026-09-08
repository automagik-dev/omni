/**
 * Internal types for the ASC Brazil (ASCWhats GW) channel plugin.
 *
 * ASC is an official Meta BSP whose gateway (`apigw.ascbrazil.com.br`) is a
 * thin proxy over the WhatsApp Cloud API:
 *   - Outbound `POST /api/v1/messages` is a faithful mirror of Graph
 *     `POST /{phone_number_id}/messages` (same body, same response shape).
 *   - Inbound webhooks arrive in the official Meta Cloud API format —
 *     parsed with the shared `MetaWebhookPayloadSchema` from @omni/core.
 *   - Auth is two static headers on every call: `originador` (the WABA
 *     phone number, digits-only E.164) + `asc-token`.
 *
 * Source of truth: the ASC swagger ("ASCWhats GW", OpenAPI 3.0).
 */

/** Per-instance ASC config persisted on the `instances` table. */
export interface AscConfig {
  /** Gateway base URL — defaults to the ASC production host. */
  baseUrl: string;
  /** WABA phone number (digits-only E.164, e.g. 553432576099) — `originador` header. */
  originador: string;
  /** ASC access token — `asc-token` header. */
  ascToken: string;
  /** Optional webhook verify token (the `chave` registered via ASC setWebhook). */
  webhookVerifyToken?: string;
}

/** `link`-form media object (ASC fetches the public URL, like Graph). */
export interface AscMediaPayload {
  link: string;
  caption?: string;
  filename?: string;
}

/** `template` object for type=template — Graph HSM shape, passthrough components. */
export interface AscTemplatePayload {
  name: string;
  language: { code: string; policy?: 'deterministic' };
  components?: unknown[];
}

/**
 * Body POSTed to /api/v1/messages — mirror of the Graph API outbound shape.
 * `interactive` stays untyped: the Cloud-API interactive plan built by the
 * shared `planInteractive` (@omni/channel-sdk) is passed through verbatim.
 */
export interface AscOutboundMessage {
  messaging_product: 'whatsapp';
  recipient_type?: 'individual';
  to: string;
  type:
    | 'text'
    | 'image'
    | 'audio'
    | 'video'
    | 'document'
    | 'sticker'
    | 'location'
    | 'contacts'
    | 'template'
    | 'interactive';
  context?: { message_id: string };
  text?: { body: string; preview_url?: boolean };
  image?: AscMediaPayload;
  audio?: AscMediaPayload;
  video?: AscMediaPayload;
  document?: AscMediaPayload;
  sticker?: AscMediaPayload;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: unknown[];
  template?: AscTemplatePayload;
  interactive?: unknown;
}

/** Response from POST /api/v1/messages — Graph mirror; `messages[0].id` is the wamid. */
export interface AscSendResponse {
  messaging_product?: string;
  contacts?: Array<{ input: string; wa_id: string }>;
  messages?: Array<{ id: string }>;
}

/** Response from GET /api/v1/getDownloadMedia/{mediaId}. */
export interface AscMediaInfo {
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
  id?: string;
  messaging_product?: string;
}
