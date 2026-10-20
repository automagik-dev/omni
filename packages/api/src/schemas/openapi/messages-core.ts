/**
 * OpenAPI schemas for the core message endpoints: sending text, and reading stored
 * messages (routes/v2/messages.ts).
 *
 * Kept apart from ./messages because the route imports from that file; these use the
 * route's own validators, so the documented contract cannot drift from what it accepts.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { listQuerySchema, sendTextSchema } from '../../routes/v2/messages';
import { ErrorSchema } from './common';
import { MessageResponseSchema } from './messages';

export const StoredMessageSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Message UUID' }),
  chatId: z.string().uuid().openapi({ description: 'Chat the message belongs to' }),
  externalId: z.string().openapi({ description: 'Platform-native message id' }),
  source: z.string().openapi({ description: 'Where it came from (platform, api, agent, …)' }),
  messageType: z.string().openapi({ description: 'text, audio, image, video, document, sticker, …' }),
  status: z.string().nullable(),
  isFromMe: z.boolean().openapi({ description: 'Sent by the instance owner' }),
  senderDisplayName: z.string().nullable(),
  senderPersonId: z.string().uuid().nullable(),
  textContent: z.string().nullable(),
  transcription: z.string().nullable().openapi({ description: 'Transcript of a voice note' }),
  hasMedia: z.boolean(),
  platformTimestamp: z.string().nullable().openapi({ description: 'ISO time the platform reports' }),
  createdAt: z.string(),
});

const notFound = { description: 'Message not found', content: { 'application/json': { schema: ErrorSchema } } };

export function registerMessageCoreSchemas(registry: OpenAPIRegistry): void {
  registry.register('StoredMessage', StoredMessageSchema);

  registry.registerPath({
    method: 'post',
    path: '/messages/send',
    tags: ['Messages'],
    summary: 'Send a text message',
    description:
      'Plain text only; media goes to POST /messages/send/media (a media payload here answers 422 WRONG_ENDPOINT).',
    request: { body: { content: { 'application/json': { schema: sendTextSchema } } } },
    responses: {
      201: {
        description: 'Sent',
        content: { 'application/json': { schema: z.object({ data: MessageResponseSchema }) } },
      },
      200: {
        description: 'Filtered by the outbound rules; nothing was sent',
        content: { 'application/json': { schema: z.object({ data: MessageResponseSchema }) } },
      },
      400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorSchema } } },
      422: {
        description: 'A media payload, which belongs to /messages/send/media',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/messages',
    tags: ['Messages'],
    summary: 'List messages',
    description:
      'Stored messages across the chats the key can read, filtered by chat, source, type, status, sender, time or text.',
    request: { query: listQuerySchema },
    responses: {
      200: {
        description: 'A page of messages',
        content: {
          'application/json': {
            schema: z.object({
              items: z.array(StoredMessageSchema),
              meta: z.object({
                total: z.number().int(),
                hasMore: z.boolean(),
                cursor: z.string().nullable().optional(),
              }),
            }),
          },
        },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/messages/by-external',
    tags: ['Messages'],
    summary: 'Find a message by its platform id',
    request: {
      query: z.object({
        chatId: z.string().uuid().openapi({ description: 'Chat UUID' }),
        externalId: z.string().openapi({ description: 'Platform-native message id' }),
      }),
    },
    responses: {
      200: {
        description: 'The message, or data: null',
        content: { 'application/json': { schema: z.object({ data: StoredMessageSchema.nullable() }) } },
      },
      400: {
        description: 'chatId and externalId are required',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/messages/{id}',
    tags: ['Messages'],
    summary: 'Get a message',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Message UUID' }) }) },
    responses: {
      200: {
        description: 'The message',
        content: { 'application/json': { schema: z.object({ data: StoredMessageSchema }) } },
      },
      404: notFound,
    },
  });
}
