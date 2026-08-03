/**
 * Hermes (Mutant) WhatsApp gateway — webhook envelope schemas.
 *
 * Hermes is a Brazilian BSP-style gateway (H3rmes, mutant.com.br) whose
 * webhook bodies WRAP the exact WhatsApp Cloud API inbound shapes:
 *
 *   { contacts: [...], messages: [<Cloud API inbound message>], media_id, message_type: "IN" }
 *   { statuses: [<Cloud API status entry>], media_id }
 *
 * `media_id` is the Hermes UUID of the WhatsApp LINE (not a file id) — it is
 * the webhook → instance resolution key, playing the same role
 * `metadata.phone_number_id` plays for the Meta webhook. The inner message
 * objects are validated by the whatsapp-business schemas (source of truth for
 * the Cloud API shapes); `InboundMediaSchema.file` carries the
 * Hermes-specific direct download URL.
 *
 * Source of truth: the official Mutant Postman collection ("Hermes API").
 */

import { z } from 'zod';
import { MetaInboundMessageSchema, MetaWebhookStatusEntrySchema } from './whatsapp-business';

/** `contacts[]` entry — sender profile attached to inbound messages. */
export const HermesContactSchema = z.object({
  profile: z.object({ name: z.string().optional() }).optional(),
  wa_id: z.string().optional(),
});

/**
 * One webhook POST from Hermes. Message and status deliveries arrive as
 * separate posts, but nothing in the contract forbids both arrays at once —
 * the handler processes whichever are present.
 */
export const HermesWebhookPayloadSchema = z.object({
  /** Hermes UUID of the WhatsApp line this event belongs to. */
  media_id: z.string(),
  /** "IN" on inbound customer messages; absent on status posts. */
  message_type: z.string().optional(),
  contacts: z.array(HermesContactSchema).optional(),
  messages: z.array(MetaInboundMessageSchema).optional(),
  statuses: z.array(MetaWebhookStatusEntrySchema).optional(),
});

export type HermesContact = z.infer<typeof HermesContactSchema>;
export type HermesWebhookPayload = z.infer<typeof HermesWebhookPayloadSchema>;
