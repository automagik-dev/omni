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
 * Type-level companions live at packages/core/src/types/whatsapp-business.ts.
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
    type: z.enum(['button_reply', 'list_reply', 'nfm_reply']),
    button_reply: z.object({ id: z.string(), title: z.string() }).optional(),
    list_reply: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }).optional(),
    /** WhatsApp Flow completion — `response_json` is the flow's answer payload. */
    nfm_reply: z
      .object({ response_json: z.string(), body: z.string().optional(), name: z.string().optional() })
      .optional(),
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
// Coexistence (WhatsApp Business app + Cloud API on one number)
//   - smb_message_echoes → value.message_echoes[]: messages the business sent
//     from the WhatsApp Business app or a companion device
//   - history           → value.history[]: past chats shared at onboarding
//   - smb_app_state_sync → value.state_sync[]: the app's address book
// Items stay open (passthrough) so fields Meta adds later survive; the
// webhook handler validates each item on its own and skips a bad one.
// ---------------------------------------------------------------------------

export const MetaMessageEchoSchema = z
  .object({
    from: z.string(),
    /** Omitted when the user's phone number is unavailable (BSUID-only user). */
    to: z.string().optional(),
    to_user_id: z.string().optional(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
  })
  .passthrough();

export const MetaHistoryMessageSchema = z
  .object({
    from: z.string(),
    /** Only on messages the business sent (echoes). */
    to: z.string().optional(),
    /** Only on messages the user sent. */
    from_user_id: z.string().optional(),
    id: z.string(),
    timestamp: z.string(),
    /** `media_placeholder` carries no content; the asset follows in a later webhook. */
    type: z.string(),
    history_context: z.object({ status: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export const MetaHistoryThreadSchema = z
  .object({
    /** The WhatsApp user's phone number; omitted when unavailable. */
    id: z.string().optional(),
    context: z
      .object({ wa_id: z.string().optional(), user_id: z.string().optional(), username: z.string().optional() })
      .passthrough()
      .optional(),
    messages: z.array(z.record(z.string(), z.unknown())).default([]),
  })
  .passthrough();

export const MetaHistoryChunkSchema = z
  .object({
    metadata: z
      .object({
        phase: z.coerce.number().optional(),
        chunk_order: z.coerce.number().optional(),
        progress: z.coerce.number().optional(),
      })
      .passthrough()
      .optional(),
    threads: z.array(MetaHistoryThreadSchema).optional(),
    /** Code 2593109: the business turned history sharing off in the app. */
    errors: z
      .array(z.object({ code: z.number(), title: z.string().optional(), message: z.string().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

export const MetaStateSyncItemSchema = z
  .object({
    type: z.string(),
    contact: z
      .object({
        full_name: z.string().optional(),
        first_name: z.string().optional(),
        /** Omitted when the user's phone number is unavailable. */
        phone_number: z.string().optional(),
        user_id: z.string().optional(),
        username: z.string().optional(),
      })
      .passthrough()
      .optional(),
    /** `add` (added or edited) or `remove`. */
    action: z.string(),
    metadata: z.object({ timestamp: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

// ---------------------------------------------------------------------------
// Full webhook payload (entry[].changes[].value)
// ---------------------------------------------------------------------------

/**
 * Passthrough: this all-optional object is the first member of the change
 * value union, so a strict object would match every value and strip whatever
 * it does not name (template status and account alert fields included).
 */
export const MetaWebhookValueSchema = z
  .object({
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
    message_echoes: z.array(z.record(z.string(), z.unknown())).optional(),
    history: z.array(z.record(z.string(), z.unknown())).optional(),
    state_sync: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

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
// Meta-compatible providers: per-instance API and webhook settings
// (a provider such as Kapso mirrors the Cloud API and forwards Meta's webhooks)
// ---------------------------------------------------------------------------

/** How the access token is sent: Meta's `Authorization: Bearer`, or a provider key as `X-API-Key`. */
export const MetaAuthModeSchema = z.enum(['bearer', 'x-api-key']);

/**
 * Which signature this instance's webhooks carry: Meta's `X-Hub-Signature-256`
 * (`sha256=` + hex HMAC-SHA256 with the instance's webhook secret when it has
 * one, else META_APP_SECRET), or a provider's `X-Webhook-Signature` (bare hex
 * HMAC-SHA256 with the instance's webhook secret).
 */
export const MetaSignatureModeSchema = z.enum(['x-hub-signature-256', 'x-webhook-signature']);

/**
 * Whether a URL is on one of Meta's own hosts (Graph API, lookaside media). A
 * provider key (`x-api-key`) must never be sent to one.
 */
export function isMetaHostUrl(url: string): boolean {
  try {
    // A fully qualified name may end in a dot (`graph.facebook.com.`): it is the same host.
    const host = new URL(url).hostname.toLowerCase().replace(/\.+$/, '');
    return /(^|\.)(facebook\.com|fbsbx\.com)$/.test(host);
  } catch {
    return false;
  }
}

/** Cloud API base URL with its version, e.g. `https://api.kapso.ai/meta/whatsapp/v24.0`. */
export const MetaApiBaseUrlSchema = z
  .string()
  .url()
  .refine((url) => url.startsWith('https://'), { message: 'apiBaseUrl must be an https URL' });

/**
 * An instance's provider settings as the plugin reads them on connect. All
 * unset = Meta direct (Graph API, Bearer token, X-Hub-Signature-256).
 */
export const MetaProviderSettingsSchema = z.object({
  apiBaseUrl: MetaApiBaseUrlSchema.optional(),
  authMode: MetaAuthModeSchema.default('bearer'),
  webhookSecret: z.string().min(1).optional(),
  signatureMode: MetaSignatureModeSchema.default('x-hub-signature-256'),
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
export const WhatsAppBusinessConnectRequestSchema = z
  .object({
    accessToken: z.string().min(1).optional(),
    exchangeHandle: z.string().min(1).optional(),
    phoneNumberId: z.string().min(1),
    wabaId: z.string().min(1),
    appId: z.string().optional(),
    businessId: z.string().optional(),
    // Meta-compatible provider settings (e.g. Kapso). Each one omitted keeps
    // the instance's stored value, so a re-connect that only re-enters the
    // token never moves an instance between Meta and its provider; `null`
    // clears a stored value. All unset = Meta direct.
    /** Provider API base URL with its version. `null` returns the instance to Meta's Graph API. */
    apiBaseUrl: MetaApiBaseUrlSchema.nullable().optional(),
    /** `bearer` (Meta) or `x-api-key` (provider key header; needs a non-Meta `apiBaseUrl`). `null` resets to bearer. */
    authMode: MetaAuthModeSchema.nullable().optional(),
    /** The secret a provider signs forwarded webhooks with. Stored like the access token. */
    webhookSecret: z.string().min(1).nullable().optional(),
    /** `x-hub-signature-256` (Meta) or `x-webhook-signature` (provider; needs `webhookSecret`). `null` resets to Meta's. */
    signatureMode: MetaSignatureModeSchema.nullable().optional(),
  })
  .refine((v) => Boolean(v.accessToken) !== Boolean(v.exchangeHandle), {
    message: 'Provide exactly one of `accessToken` (manual flow) or `exchangeHandle` (Embedded Signup flow)',
    path: ['accessToken'],
  });

/**
 * Send-a-Flow descriptor — used as the `POST .../whatsapp-flows/send` request
 * body and as `OutgoingMessage.metadata.flow` on the plugin dispatch path.
 * Exactly one of `flowId` / `flowName` identifies the flow. `draft: true`
 * sends an unpublished flow (Meta's mode=draft) for testing.
 */
const WhatsAppFlowFieldsSchema = z.object({
  flowId: z.string().trim().min(1).optional().describe('Flow id (exactly one of flowId/flowName)'),
  flowName: z.string().min(1).optional().describe('Flow name (exactly one of flowId/flowName)'),
  /** Button label that opens the flow. */
  cta: z.string().trim().min(1).max(30).describe('Button label that opens the flow'),
  bodyText: z.string().min(1).max(1024).describe('Message body shown above the button'),
  headerText: z.string().max(60).optional().describe('Header line'),
  footerText: z.string().max(60).optional().describe('Footer line'),
  /** First screen id (defaults to the flow's entry screen when omitted). */
  screen: z.string().optional().describe("First screen id (defaults to the flow's entry screen)"),
  /** Input data for the first screen — must be non-empty when present. */
  data: z.record(z.string(), z.unknown()).optional().describe('Input data for the first screen'),
  /** Correlates the nfm_reply back to this send; generated when omitted. */
  flowToken: z.string().optional().describe('Correlates the nfm_reply back to this send; generated when omitted'),
  draft: z.boolean().optional().describe('Send the unpublished draft (testing)'),
  /**
   * 'navigate' (default): static flow, screens resolved client-side.
   * 'data_exchange': endpoint-backed flow — opening it calls the data
   * endpoint with INIT; requires the flow to have a registered endpoint_uri.
   */
  flowAction: z
    .enum(['navigate', 'data_exchange'])
    .optional()
    .describe("'navigate' (default, static flow) or 'data_exchange' (endpoint-backed flow)"),
});

const hasOneFlowRef = (v: { flowId?: string; flowName?: string }) => Boolean(v.flowId) !== Boolean(v.flowName);
const FLOW_REF_ISSUE = { message: 'Provide exactly one of flowId or flowName', path: ['flowId'] };

export const WhatsAppFlowSendSchema = WhatsAppFlowFieldsSchema.refine(hasOneFlowRef, FLOW_REF_ISSUE);

/**
 * The `flow` field of `POST /messages/send`: the same descriptor, with
 * `bodyText` optional because the message `text` fills it when missing.
 */
export const WhatsAppFlowInMessageSchema = WhatsAppFlowFieldsSchema.extend({
  bodyText: WhatsAppFlowFieldsSchema.shape.bodyText.optional().describe('Message body; defaults to the message text'),
}).refine(hasOneFlowRef, FLOW_REF_ISSUE);

export const WhatsAppBusinessRegisterRequestSchema = z.object({
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
export type MetaMessageEcho = z.infer<typeof MetaMessageEchoSchema>;
export type MetaHistoryMessage = z.infer<typeof MetaHistoryMessageSchema>;
export type MetaHistoryChunk = z.infer<typeof MetaHistoryChunkSchema>;
export type MetaStateSyncItem = z.infer<typeof MetaStateSyncItemSchema>;
export type MetaAuthMode = z.infer<typeof MetaAuthModeSchema>;
export type MetaSignatureMode = z.infer<typeof MetaSignatureModeSchema>;
export type MetaProviderSettings = z.infer<typeof MetaProviderSettingsSchema>;
export type EmbeddedSignupExchangeRequest = z.infer<typeof EmbeddedSignupExchangeRequestSchema>;
export type EmbeddedSignupExchangeResponse = z.infer<typeof EmbeddedSignupExchangeResponseSchema>;
export type WhatsAppBusinessConnectRequest = z.infer<typeof WhatsAppBusinessConnectRequestSchema>;
export type WhatsAppFlowSend = z.infer<typeof WhatsAppFlowSendSchema>;
export type SendTemplateRequest = z.infer<typeof SendTemplateRequestSchema>;
