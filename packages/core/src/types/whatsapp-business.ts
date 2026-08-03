/**
 * WhatsApp Cloud API (Meta) types — shared across @omni packages.
 *
 * Mirrors the Graph API component shapes for HSM templates and webhook payloads.
 * Source of truth for runtime validation lives at:
 *   packages/core/src/schemas/whatsapp-business.ts (Zod schemas)
 */

export const META_TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
export type MetaTemplateCategory = (typeof META_TEMPLATE_CATEGORIES)[number];

export const META_TEMPLATE_STATUSES = ['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DELETED'] as const;
export type MetaTemplateStatus = (typeof META_TEMPLATE_STATUSES)[number];

export const META_TEMPLATE_QUALITY_SCORES = ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'] as const;
export type MetaTemplateQualityScore = (typeof META_TEMPLATE_QUALITY_SCORES)[number];

export type MetaTemplateHeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';

export interface WhatsAppTemplateHeaderComponent {
  type: 'HEADER';
  format: MetaTemplateHeaderFormat;
  /** Required when format === 'TEXT'. May embed `{{1}}` placeholders. */
  text?: string;
  /** Required for media/location formats — references uploaded media handle or example URL. */
  example?: {
    header_text?: string[];
    header_handle?: string[];
  };
}

export interface WhatsAppTemplateBodyComponent {
  type: 'BODY';
  /** Body text — may contain `{{1}}`, `{{2}}` … placeholders. */
  text: string;
  example?: {
    body_text?: string[][];
  };
}

export interface WhatsAppTemplateFooterComponent {
  type: 'FOOTER';
  text: string;
}

export type MetaTemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string[] }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string }
  | { type: 'COPY_CODE'; example: string };

export interface WhatsAppTemplateButtonsComponent {
  type: 'BUTTONS';
  buttons: MetaTemplateButton[];
}

// WhatsAppTemplateComponent is exported from ../schemas/whatsapp-business (Zod source of truth).

/**
 * Webhook value.metadata shape — present on every entry change.
 */
export interface MetaWebhookMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

/**
 * One inbound message as delivered by the Meta webhook (entry[].changes[].value.messages[]).
 * Discriminated on `type`.
 */
export type MetaInboundMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'reaction'
  | 'interactive'
  | 'button'
  | 'unknown';

export interface MetaInboundContext {
  /** wamid of the message this is a reply to. */
  id?: string;
  from?: string;
  forwarded?: boolean;
  frequently_forwarded?: boolean;
}

/**
 * Status webhook entry — message lifecycle updates (sent → delivered → read | failed).
 */
export type MetaStatusType = 'sent' | 'delivered' | 'read' | 'failed';

// MetaWebhookStatusEntry and MetaTemplateStatusUpdate are exported from
// ../schemas/whatsapp-business (Zod source of truth).
