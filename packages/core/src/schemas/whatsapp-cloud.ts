/**
 * WhatsApp Cloud API (Meta) — Zod schemas.
 *
 * Runtime validators for:
 *   - Meta webhook payload (entry[].changes[].value, discriminated on type)
 *   - Inbound message types (text, image, audio, video, document, sticker, location, contacts, interactive, reaction)
 *   - Statuses (sent/delivered/read/failed + errors)
 *   - Template lifecycle (status updates)
 *   - HSM template components (HEADER/BODY/FOOTER/BUTTONS)
 *   - Embedded Signup OAuth + connect endpoints
 *
 * Type-level companions live at packages/core/src/types/whatsapp-cloud.ts.
 */

import { z } from 'zod';
import { PhoneSchema } from './common';

// ---------------------------------------------------------------------------
// Template component shapes (HSM)
// ---------------------------------------------------------------------------

export const MetaTemplateCategorySchema = z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']);
export const MetaTemplateStatusSchema = z.enum(['APPROVED', 'PENDING', 'REJECTED', 'PAUSED', 'DELETED']);
export const MetaTemplateQualityScoreSchema = z.enum(['GREEN', 'YELLOW', 'RED', 'UNKNOWN']);

export const MetaTemplateHeaderComponentSchema = z.object({
  type: z.literal('HEADER'),
  format: z.enum(['TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'LOCATION']),
  text: z.string().optional(),
  example: z
    .object({
      header_text: z.array(z.string()).optional(),
      header_handle: z.array(z.string()).optional(),
    })
    .optional(),
});

export const MetaTemplateBodyComponentSchema = z.object({
  type: z.literal('BODY'),
  text: z.string(),
  example: z
    .object({
      body_text: z.array(z.array(z.string())).optional(),
    })
    .optional(),
});

export const MetaTemplateFooterComponentSchema = z.object({
  type: z.literal('FOOTER'),
  text: z.string(),
});

export const MetaTemplateButtonSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('QUICK_REPLY'), text: z.string() }),
  z.object({
    type: z.literal('URL'),
    text: z.string(),
    url: z.string().url(),
    example: z.array(z.string()).optional(),
  }),
  z.object({ type: z.literal('PHONE_NUMBER'), text: z.string(), phone_number: z.string() }),
  z.object({ type: z.literal('COPY_CODE'), example: z.string() }),
]);

export const MetaTemplateButtonsComponentSchema = z.object({
  type: z.literal('BUTTONS'),
  buttons: z.array(MetaTemplateButtonSchema).min(1).max(10),
});

export const WhatsAppTemplateComponentSchema = z.discriminatedUnion('type', [
  MetaTemplateHeaderComponentSchema,
  MetaTemplateBodyComponentSchema,
  MetaTemplateFooterComponentSchema,
  MetaTemplateButtonsComponentSchema,
]);

// ---------------------------------------------------------------------------
// Inbound message — Meta webhook → entry[].changes[].value.messages[]
// ---------------------------------------------------------------------------

const InboundContextSchema = z.object({
  id: z.string().optional(),
  from: z.string().optional(),
  forwarded: z.boolean().optional(),
  frequently_forwarded: z.boolean().optional(),
});

const InboundMediaSchema = z.object({
  id: z.string(),
  mime_type: z.string().optional(),
  sha256: z.string().optional(),
  caption: z.string().optional(),
  filename: z.string().optional(),
  voice: z.boolean().optional(),
  /** Hermes (Mutant) gateway extension: direct download URL for the media. Never sent by Meta. */
  file: z.string().optional(),
});

export const MetaInboundTextMessageSchema = z.object({
  type: z.literal('text'),
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  text: z.object({ body: z.string() }),
  context: InboundContextSchema.optional(),
});

export const MetaInboundMediaMessageSchema = z.object({
  type: z.enum(['image', 'audio', 'video', 'document', 'sticker']),
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  image: InboundMediaSchema.optional(),
  audio: InboundMediaSchema.optional(),
  video: InboundMediaSchema.optional(),
  document: InboundMediaSchema.optional(),
  sticker: InboundMediaSchema.optional(),
  context: InboundContextSchema.optional(),
});

export const MetaInboundLocationMessageSchema = z.object({
  type: z.literal('location'),
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  }),
  context: InboundContextSchema.optional(),
});

export const MetaInboundContactsMessageSchema = z.object({
  type: z.literal('contacts'),
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  contacts: z.array(
    z
      .object({
        name: z.object({ formatted_name: z.string().optional(), first_name: z.string().optional() }).passthrough(),
        phones: z
          .array(z.object({ phone: z.string().optional(), wa_id: z.string().optional() }).passthrough())
          .optional(),
      })
      .passthrough(),
  ),
  context: InboundContextSchema.optional(),
});

export const MetaInboundReactionMessageSchema = z.object({
  type: z.literal('reaction'),
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  reaction: z.object({
    message_id: z.string(),
    emoji: z.string(),
  }),
});

export const MetaInboundInteractiveMessageSchema = z.object({
  type: z.literal('interactive'),
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  interactive: z.object({
    type: z.enum(['button_reply', 'list_reply']),
    button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }).optional(),
  }),
  context: InboundContextSchema.optional(),
});

export const MetaInboundButtonMessageSchema = z.object({
  type: z.literal('button'),
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  button: z.object({ payload: z.string(), text: z.string() }),
  context: InboundContextSchema.optional(),
});

export const MetaInboundMessageSchema = z.union([
  MetaInboundTextMessageSchema,
  MetaInboundMediaMessageSchema,
  MetaInboundLocationMessageSchema,
  MetaInboundContactsMessageSchema,
  MetaInboundReactionMessageSchema,
  MetaInboundInteractiveMessageSchema,
  MetaInboundButtonMessageSchema,
]);

// ---------------------------------------------------------------------------
// Status webhook — entry[].changes[].value.statuses[]
// ---------------------------------------------------------------------------

export const MetaWebhookStatusEntrySchema = z.object({
  id: z.string(),
  status: z.enum(['sent', 'delivered', 'read', 'failed']),
  timestamp: z.string(),
  recipient_id: z.string(),
  errors: z
    .array(
      z
        .object({
          code: z.number(),
          title: z.string(),
          message: z.string().optional(),
          error_data: z.object({ details: z.string().optional() }).passthrough().optional(),
        })
        .passthrough(),
    )
    .optional(),
  conversation: z
    .object({
      id: z.string(),
      origin: z.object({ type: z.string() }).passthrough().optional(),
    })
    .passthrough()
    .optional(),
  pricing: z
    .object({
      pricing_model: z.string(),
      billable: z.boolean(),
      category: z.string(),
    })
    .passthrough()
    .optional(),
});

// ---------------------------------------------------------------------------
// Template status update — entry[].changes[].field === 'message_template_status_update'
// ---------------------------------------------------------------------------

export const MetaTemplateStatusUpdateSchema = z.object({
  message_template_id: z.string(),
  message_template_name: z.string(),
  message_template_language: z.string(),
  event: z.enum(['APPROVED', 'REJECTED', 'FLAGGED', 'PAUSED', 'DISABLED']),
  reason: z.string().optional(),
});

// ---------------------------------------------------------------------------
// Full webhook payload (entry[].changes[].value)
// ---------------------------------------------------------------------------

export const MetaWebhookValueSchema = z.object({
  messaging_product: z.literal('whatsapp').optional(),
  metadata: z
    .object({
      display_phone_number: z.string(),
      phone_number_id: z.string(),
    })
    .optional(),
  contacts: z
    .array(
      z
        .object({
          profile: z.object({ name: z.string().optional() }).passthrough().optional(),
          wa_id: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
  messages: z.array(MetaInboundMessageSchema).optional(),
  statuses: z.array(MetaWebhookStatusEntrySchema).optional(),
  errors: z
    .array(
      z
        .object({
          code: z.number(),
          title: z.string(),
          message: z.string().optional(),
        })
        .passthrough(),
    )
    .optional(),
});

export const MetaWebhookChangeSchema = z.object({
  field: z.string(),
  value: z.union([MetaWebhookValueSchema, MetaTemplateStatusUpdateSchema, z.record(z.string(), z.unknown())]),
});

export const MetaWebhookEntrySchema = z.object({
  id: z.string(),
  changes: z.array(MetaWebhookChangeSchema),
  time: z.number().optional(),
});

export const MetaWebhookPayloadSchema = z.object({
  object: z.literal('whatsapp_business_account'),
  entry: z.array(MetaWebhookEntrySchema),
});

// ---------------------------------------------------------------------------
// Embedded Signup OAuth + connect endpoints
// ---------------------------------------------------------------------------

export const EmbeddedSignupExchangeRequestSchema = z.object({
  code: z.string().min(1),
});

export const EmbeddedSignupExchangeResponseSchema = z.object({
  /**
   * Opaque single-use handle that maps server-side to the long-lived Meta
   * access token. The browser passes this back to `/connect` instead of the
   * raw token to keep the secret out of network logs / browser memory.
   *
   * Format: `eshandle_<uuid>`. TTL ~5 minutes. See
   * `packages/api/src/lib/oauth-token-cache.ts`.
   */
  exchangeHandle: z.string(),
  wabaIds: z.array(z.string()),
  phoneNumbers: z.array(
    z.object({
      phone_number_id: z.string(),
      wabaId: z.string(),
      display_phone_number: z.string().optional(),
      verified_name: z.string().optional(),
      quality_rating: z.string().optional(),
    }),
  ),
});

/**
 * `/connect` request — caller supplies either:
 *   - `exchangeHandle` from the Embedded Signup flow (server resolves the
 *     token internally), OR
 *   - `accessToken` directly (manual paste flow for dev / tenants with a
 *     pre-existing WABA token).
 *
 * One of the two MUST be present; the route enforces this via a Zod
 * refinement so the schema rejects requests with neither / both.
 */
export const WhatsAppCloudConnectRequestSchema = z
  .object({
    accessToken: z.string().min(1).optional(),
    exchangeHandle: z.string().min(1).optional(),
    phoneNumberId: z.string().min(1),
    wabaId: z.string().min(1),
    appId: z.string().optional(),
    businessId: z.string().optional(),
  })
  .refine((v) => Boolean(v.accessToken) !== Boolean(v.exchangeHandle), {
    message: 'Provide exactly one of `accessToken` (manual flow) or `exchangeHandle` (Embedded Signup flow)',
    path: ['accessToken'],
  });

export const WhatsAppCloudRegisterRequestSchema = z.object({
  /** 6-digit PIN required by Meta for new number registration. */
  pin: z
    .string()
    .regex(/^\d{6}$/, 'PIN must be exactly 6 digits')
    .optional(),
});

// ---------------------------------------------------------------------------
// Send template request (outbound)
// ---------------------------------------------------------------------------

export const SendTemplateRequestSchema = z.object({
  to: PhoneSchema,
  templateName: z.string().min(1),
  language: z.string().min(2).default('pt_BR'),
  variables: z.record(z.string(), z.string()).default({}),
  headerMedia: z
    .object({
      type: z.enum(['image', 'video', 'document']),
      url: z.string().url().optional(),
      handle: z.string().optional(),
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type WhatsAppTemplateComponent = z.infer<typeof WhatsAppTemplateComponentSchema>;
export type MetaInboundMessage = z.infer<typeof MetaInboundMessageSchema>;
export type MetaWebhookStatusEntry = z.infer<typeof MetaWebhookStatusEntrySchema>;
export type MetaWebhookPayload = z.infer<typeof MetaWebhookPayloadSchema>;
export type MetaTemplateStatusUpdate = z.infer<typeof MetaTemplateStatusUpdateSchema>;
export type EmbeddedSignupExchangeRequest = z.infer<typeof EmbeddedSignupExchangeRequestSchema>;
export type EmbeddedSignupExchangeResponse = z.infer<typeof EmbeddedSignupExchangeResponseSchema>;
export type WhatsAppCloudConnectRequest = z.infer<typeof WhatsAppCloudConnectRequestSchema>;
export type SendTemplateRequest = z.infer<typeof SendTemplateRequestSchema>;
