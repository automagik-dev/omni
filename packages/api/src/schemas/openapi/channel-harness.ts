/**
 * OpenAPI schemas for the harness channel driving/inspection routes
 * (packages/api/src/routes/v2/channel-harness.ts, issue #953).
 *
 * Auth-required E2E test surface: drive an inbound turn (say), read the
 * verbatim per-chat capture (transcript), simulate a component tap (tap),
 * and reset transcripts.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

const HarnessCapabilityProfileSchema = z
  .object({
    canSendText: z.boolean(),
    canSendMedia: z.boolean(),
    canSendButtons: z.boolean(),
    canSendList: z.boolean(),
    maxButtons: z.number().int(),
    maxListRows: z.number().int(),
    maxMessageLength: z.number().int().openapi({ description: '0 = unlimited' }),
  })
  .openapi({
    description:
      'What the simulated platform renders, per instance. Configured via profileMetadata.harnessProfile ' +
      'on the instance and enforced by the plugin sendMessage().',
  });

const HarnessInboundEntrySchema = z.object({
  seq: z.number().int().openapi({ description: 'Position in the chat transcript (1-based, per chat)' }),
  direction: z.literal('inbound'),
  at: z.number().openapi({ description: 'Unix ms timestamp' }),
  kind: z.enum(['say', 'tap']),
  externalId: z.string(),
  from: z.string(),
  content: z.object({ type: z.string(), text: z.string().optional() }),
  tap: z
    .object({
      sourceSeq: z.number().int().openapi({ description: 'seq of the outbound whose component was tapped' }),
      optionIndex: z.number().int().openapi({ description: '1-based index into that outbound buttons' }),
      optionId: z.string().optional().openapi({ description: 'button.data when set' }),
      optionText: z.string().openapi({ description: 'button.text — what comes back as the inbound text' }),
    })
    .optional()
    .openapi({ description: "Present on kind 'tap'" }),
});

const HarnessOutboundEntrySchema = z.object({
  seq: z.number().int(),
  direction: z.literal('outbound'),
  at: z.number(),
  externalId: z.string().optional().openapi({ description: 'Absent when the send was refused by the profile' }),
  message: z
    .record(z.unknown())
    .openapi({ description: 'The FULL OutgoingMessage verbatim — buttons, list, media, metadata included' }),
  violations: z.array(z.string()).openapi({ description: 'Capability-profile violations; empty when it rendered' }),
  result: z.object({ success: z.boolean(), error: z.string().optional() }),
});

const HarnessTranscriptSchema = z.object({
  chatId: z.string(),
  profile: HarnessCapabilityProfileSchema,
  entries: z.array(z.union([HarnessInboundEntrySchema, HarnessOutboundEntrySchema])),
  droppedEntries: z.number().int().openapi({ description: 'Oldest entries evicted by the per-chat bound (1000)' }),
});

const HarnessSayRequestSchema = z.object({
  chatId: z.string().min(1).max(256).openapi({ description: 'Free-form conversation id — N chats run in parallel' }),
  text: z.string().min(1).max(65536),
  from: z.string().min(1).max(256).optional().openapi({ description: 'Sender id; defaults to user:<chatId>' }),
  senderName: z.string().min(1).max(256).optional(),
});

const HarnessTapRequestSchema = z.object({
  chatId: z.string().min(1).max(256),
  option: z
    .union([z.number().int().min(1), z.string().min(1).max(256)])
    .openapi({ description: '1-based button index, or a string matched against button.data then button.text' }),
  messageSeq: z
    .number()
    .int()
    .min(1)
    .optional()
    .openapi({ description: 'Outbound seq to tap; defaults to the latest rendered outbound with a component' }),
});

export function registerChannelHarnessSchemas(registry: OpenAPIRegistry): void {
  registry.register('HarnessCapabilityProfile', HarnessCapabilityProfileSchema);
  registry.register('HarnessTranscript', HarnessTranscriptSchema);
  registry.register('HarnessSayRequest', HarnessSayRequestSchema);
  registry.register('HarnessTapRequest', HarnessTapRequestSchema);

  const instanceParam = z.object({ instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }) });

  registry.registerPath({
    method: 'post',
    path: '/channels/harness/{instanceId}/say',
    operationId: 'harnessSay',
    tags: ['Test Harness'],
    summary: 'Drive an inbound turn',
    description:
      'Injects an inbound message on a harness instance exactly as a real channel webhook would ' +
      '(message.received → dispatcher → agent: the production path).',
    request: {
      params: instanceParam,
      body: { content: { 'application/json': { schema: HarnessSayRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Inbound injected',
        content: { 'application/json': { schema: z.object({ data: HarnessInboundEntrySchema }) } },
      },
      400: { description: 'Not a harness instance', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/channels/harness/{instanceId}/tap',
    operationId: 'harnessTap',
    tags: ['Test Harness'],
    summary: 'Simulate a component tap',
    description:
      'Converts a button/list row of a component the agent actually sent into the inbound a real tap ' +
      'produces (text = the option title).',
    request: {
      params: instanceParam,
      body: { content: { 'application/json': { schema: HarnessTapRequestSchema } } },
    },
    responses: {
      201: {
        description: 'Tap injected',
        content: { 'application/json': { schema: z.object({ data: HarnessInboundEntrySchema }) } },
      },
      404: {
        description: 'No rendered component / option not found',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      409: {
        description: 'Targeted outbound was refused by the profile — it never rendered',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/channels/harness/{instanceId}/transcript',
    operationId: 'harnessGetTranscript',
    tags: ['Test Harness'],
    summary: 'Read a chat transcript',
    description:
      'Ordered verbatim capture of one chat: every OutgoingMessage handed to sendMessage() (refused sends ' +
      'included, with violations) plus the injected inbounds, and the enforced capability profile.',
    request: {
      params: instanceParam,
      query: z.object({ chatId: z.string().min(1).max(256) }),
    },
    responses: {
      200: {
        description: 'Transcript (empty entries for an unknown chatId)',
        content: { 'application/json': { schema: z.object({ data: HarnessTranscriptSchema }) } },
      },
      400: { description: 'Not a harness instance', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/channels/harness/{instanceId}/transcript',
    operationId: 'harnessResetTranscript',
    tags: ['Test Harness'],
    summary: 'Reset transcripts',
    description: 'Drops one chat transcript, or every transcript of the instance when chatId is omitted.',
    request: {
      params: instanceParam,
      query: z.object({ chatId: z.string().min(1).max(256).optional() }),
    },
    responses: {
      200: {
        description: 'Reset done',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({ reset: z.boolean(), chatId: z.string().optional(), scope: z.string().optional() }),
            }),
          },
        },
      },
      400: { description: 'Not a harness instance', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
