/**
 * Types and wire schemas for the Zenvia channel plugin.
 *
 * Zenvia (api.zenvia.com/v2) is a multi-channel CPaaS whose WhatsApp product
 * is an official Meta BSP. Unlike the Cloud-API mirrors (asc, hermes) its
 * wire format is Zenvia's own:
 *   - Outbound `POST /v2/channels/whatsapp/messages` with
 *     `{ from, to, contents: [...] }`, authenticated by the static
 *     `X-API-TOKEN` header.
 *   - Inbound webhooks are subscription events (`MESSAGE`, `MESSAGE_STATUS`,
 *     `CONVERSATION_STATUS`, …) POSTed as JSON to the URL registered through
 *     `POST /v2/subscriptions`.
 *
 * Every inbound shape is validated here with Zod before it reaches the
 * plugin. Schemas are deliberately permissive (`passthrough`, optional
 * fields): Zenvia adds fields over time and a strict schema would turn an
 * additive vendor change into dropped messages.
 *
 * Source of truth: the public Zenvia API v2 OpenAPI specification.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Config
// ─────────────────────────────────────────────────────────────

/**
 * `conversation.solution` values accepted by `POST /v2/channels/whatsapp/messages`.
 * When the contact replies to a message carrying this field, Zenvia routes
 * the conversation to the chosen solution.
 */
export const ZENVIA_HANDOFF_SOLUTIONS = ['conversion', 'zenvia_chat', 'nlu'] as const;
export type ZenviaHandoffSolution = (typeof ZENVIA_HANDOFF_SOLUTIONS)[number];

/** Per-instance Zenvia config persisted on the `instances` table. */
export interface ZenviaConfig {
  /** API token created in the Zenvia console — `X-API-TOKEN` header. */
  apiToken: string;
  /** Sender identifier (the WhatsApp number registered at Zenvia) — `from` on every send. */
  senderId: string;
  /** Solution a handoff routes the conversation to. Unset = handoff is refused. */
  handoffSolution?: ZenviaHandoffSolution;
  /**
   * Shared secret the subscription sends back as a fixed header
   * (`webhook.headers` on the subscription). When set, every POST must carry it.
   */
  webhookVerifyToken?: string;
}

// ─────────────────────────────────────────────────────────────
// Outbound
// ─────────────────────────────────────────────────────────────

export type ZenviaOutboundContent =
  | { type: 'text'; text: string }
  | { type: 'file'; fileUrl: string; fileMimeType?: string; fileName?: string; fileCaption?: string }
  | { type: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  | { type: 'template'; templateId: string; fields?: Record<string, string | number | boolean> };

/** `conversation` object on an outbound message — the only handoff primitive the API exposes. */
export interface ZenviaConversationRouting {
  solution: ZenviaHandoffSolution;
  properties?: Record<string, unknown>;
}

/** Body POSTed to /v2/channels/whatsapp/messages. */
export interface ZenviaOutboundMessage {
  from: string;
  to: string;
  contents: ZenviaOutboundContent[];
  /** Id of the message being replied to (WhatsApp quote). */
  idRef?: string;
  conversation?: ZenviaConversationRouting;
}

/** Response from /v2/channels/whatsapp/messages — the created message; `id` keys later status events. */
export interface ZenviaSendResponse {
  id?: string;
  from?: string;
  to?: string;
  direction?: 'IN' | 'OUT';
}

// ─────────────────────────────────────────────────────────────
// Inbound (webhook) — Zod schemas
// ─────────────────────────────────────────────────────────────

const TextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
    /** Payload of the button the contact tapped (reply buttons). */
    payload: z.string().optional(),
  })
  .passthrough();

const FileContentSchema = z
  .object({
    type: z.literal('file'),
    fileUrl: z.string().optional(),
    fileMimeType: z.string().optional(),
    fileName: z.string().optional(),
    fileCaption: z.string().optional(),
    /** Zenvia's own upload verdict — REJECTED files carry no usable URL. */
    status: z.string().optional(),
    reason: z.string().optional(),
  })
  .passthrough();

const LocationContentSchema = z
  .object({
    type: z.literal('location'),
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  })
  .passthrough();

const ContactsContentSchema = z
  .object({
    type: z.literal('contacts'),
    contacts: z.array(z.record(z.unknown())),
  })
  .passthrough();

/** Any other content type (list/button replies, flows, orders, …) — kept for the raw payload. */
const OtherContentSchema = z.object({ type: z.string() }).passthrough();

export const ZenviaInboundContentSchema = z.union([
  TextContentSchema,
  FileContentSchema,
  LocationContentSchema,
  ContactsContentSchema,
  OtherContentSchema,
]);
export type ZenviaInboundContent = z.infer<typeof ZenviaInboundContentSchema>;

export const ZenviaReferralSchema = z
  .object({
    headline: z.string().optional(),
    body: z.string().optional(),
    source: z
      .object({
        id: z.string().optional(),
        type: z.string().optional(),
        url: z.string().optional(),
      })
      .passthrough()
      .optional(),
    ctwaId: z.string().optional(),
  })
  .passthrough();
export type ZenviaReferral = z.infer<typeof ZenviaReferralSchema>;

export const ZenviaInboundMessageSchema = z
  .object({
    id: z.string().min(1),
    from: z.string().min(1),
    to: z.string().optional(),
    direction: z.enum(['IN', 'OUT']).optional(),
    channel: z.string().optional(),
    contents: z.array(ZenviaInboundContentSchema).min(1),
    timestamp: z.string().optional(),
    /** Quoted message id (reply) or the message whose button was tapped. */
    idRef: z.string().optional(),
    visitor: z
      .object({
        name: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      })
      .passthrough()
      .optional(),
    referral: ZenviaReferralSchema.optional(),
  })
  .passthrough();
export type ZenviaInboundMessage = z.infer<typeof ZenviaInboundMessageSchema>;

export const ZenviaMessageEventSchema = z
  .object({
    id: z.string().optional(),
    type: z.literal('MESSAGE'),
    direction: z.enum(['IN', 'OUT']).optional(),
    message: ZenviaInboundMessageSchema,
  })
  .passthrough();
export type ZenviaMessageEvent = z.infer<typeof ZenviaMessageEventSchema>;

export const ZenviaMessageStatusEventSchema = z
  .object({
    id: z.string().optional(),
    type: z.literal('MESSAGE_STATUS'),
    /** Deprecated top-level id — still sent; `message.id` is preferred. */
    messageId: z.string().optional(),
    message: z
      .object({
        id: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        direction: z.enum(['IN', 'OUT']).optional(),
      })
      .passthrough()
      .optional(),
    messageStatus: z
      .object({
        code: z.string(),
        timestamp: z.string().optional(),
        description: z.string().optional(),
        causes: z
          .array(
            z
              .object({
                channelErrorCode: z.string().optional(),
                reason: z.string().optional(),
                details: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();
export type ZenviaMessageStatusEvent = z.infer<typeof ZenviaMessageStatusEventSchema>;

/** Envelope discriminator — every subscription event carries `type`. */
export const ZenviaEventEnvelopeSchema = z.object({ type: z.string() }).passthrough();
