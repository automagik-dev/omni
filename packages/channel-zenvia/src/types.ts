import { z } from 'zod';

import type { ZenviaHandoffRouting } from './handoff-routing';

export const ZENVIA_HANDOFF_SOLUTIONS = ['conversion', 'zenvia_chat', 'nlu'] as const;
export type ZenviaHandoffSolution = (typeof ZENVIA_HANDOFF_SOLUTIONS)[number];

export interface ZenviaConfig {
  apiToken: string;
  senderId: string;
  handoffSolution?: ZenviaHandoffSolution;
  webhookVerifyToken?: string;
  salesApiKey?: string;
  handoffGroupId?: string;
  handoffUserId?: string;
  handoffRouting?: ZenviaHandoffRouting;
}

export const ZenviaSalesProspectSchema = z.object({ id: z.string().min(1) }).passthrough();
export type ZenviaSalesProspect = z.infer<typeof ZenviaSalesProspectSchema>;

export const ZenviaSalesGroupsSchema = z.array(
  z.object({ id: z.string().min(1), name: z.string().optional(), displayName: z.string().optional() }).passthrough(),
);
export type ZenviaSalesGroups = z.infer<typeof ZenviaSalesGroupsSchema>;

export const ZenviaSalesTransferResponseSchema = z
  .object({
    success: z.boolean().optional().catch(undefined).describe('Only an explicit false refuses the transfer'),
  })
  .passthrough();

export const ZenviaErrorBodySchema = z
  .object({
    code: z.string().optional().catch(undefined).describe('Vendor error code, kept when it is a string'),
    message: z.string().optional().catch(undefined).describe('Vendor error message, kept when it is a string'),
  })
  .passthrough();

export type ZenviaOutboundContent =
  | { type: 'text'; text: string }
  | { type: 'file'; fileUrl: string; fileMimeType?: string; fileName?: string; fileCaption?: string }
  | { type: 'location'; latitude: number; longitude: number; name?: string; address?: string }
  | { type: 'template'; templateId: string; fields?: Record<string, string | number | boolean> };

export interface ZenviaConversationRouting {
  solution: ZenviaHandoffSolution;
  properties?: Record<string, unknown>;
}

export interface ZenviaOutboundMessage {
  from: string;
  to: string;
  contents: ZenviaOutboundContent[];
  idRef?: string;
  conversation?: ZenviaConversationRouting;
}

export const ZenviaSendResponseSchema = z
  .object({
    id: z.string().min(1).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    direction: z.enum(['IN', 'OUT']).optional(),
  })
  .passthrough();
export type ZenviaSendResponse = z.infer<typeof ZenviaSendResponseSchema>;

const TextContentSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
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

export const ZenviaMessageStatusEventSchema = z
  .object({
    id: z.string().optional(),
    type: z.literal('MESSAGE_STATUS'),
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

export const ZenviaEventEnvelopeSchema = z.object({ type: z.string() }).passthrough();
