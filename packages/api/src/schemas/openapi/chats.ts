/**
 * OpenAPI schemas for the unified chat endpoints (routes/v2/chats.ts).
 *
 * Request bodies and queries are the route's own validators, imported rather than
 * restated, so the documented contract cannot drift from what the route accepts.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import {
  ChatTypeSchema,
  addParticipantSchema,
  createChatSchema,
  listMessagesQuerySchema,
  listQuerySchema,
  updateChatSchema,
} from '../../routes/v2/chats';
import { ErrorSchema, SuccessSchema } from './common';

export const ChatSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Chat UUID' }),
  instanceId: z.string().uuid().openapi({ description: 'Instance (channel) the chat lives on' }),
  externalId: z.string().openapi({ description: 'Platform-native chat id (WhatsApp JID, Telegram id, …)' }),
  canonicalId: z.string().nullable().openapi({ description: 'Canonical platform id when the platform has several' }),
  chatType: ChatTypeSchema.openapi({ description: 'Kind of chat' }),
  channel: z.string().openapi({ description: 'Channel type, e.g. whatsapp-baileys' }),
  name: z.string().nullable().openapi({ description: 'Display name' }),
  description: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  parentChatId: z.string().uuid().nullable(),
  participantCount: z.number().int().nullable(),
  messageCount: z.number().int().nullable(),
  unreadCount: z.number().int().nullable().openapi({ description: 'Messages not yet read' }),
  lastMessageAt: z.string().nullable().openapi({ description: 'ISO time of the latest message' }),
  lastMessagePreview: z.string().nullable(),
  lastMessageFromMe: z.boolean().nullable(),
  isGroup: z.boolean(),
  labels: z.array(z.string()).nullable(),
  settings: z.record(z.unknown()).nullable(),
  platformMetadata: z.record(z.unknown()).nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const ChatParticipantSchema = z.object({
  id: z.string().uuid(),
  chatId: z.string().uuid(),
  platformUserId: z.string(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  role: z.string().nullable(),
  personId: z.string().uuid().nullable(),
});

const ChatListResponse = z.object({
  items: z.array(ChatSchema),
  meta: z.object({
    hasMore: z.boolean(),
    cursor: z.string().nullable().optional(),
    total: z.number().int().optional(),
  }),
});

const idParam = z.object({
  id: z
    .string()
    .openapi({ description: "Chat UUID, or a platform-native chat id resolved through the API key's instance" }),
});

const notFound = { description: 'Chat not found', content: { 'application/json': { schema: ErrorSchema } } };
const chatData = (description: string) => ({
  description,
  content: { 'application/json': { schema: z.object({ data: ChatSchema }) } },
});

export function registerChatSchemas(registry: OpenAPIRegistry): void {
  registry.register('Chat', ChatSchema);
  registry.register('ChatParticipant', ChatParticipantSchema);

  registry.registerPath({
    method: 'get',
    path: '/chats',
    tags: ['Chats'],
    summary: 'List chats',
    description:
      'Chats and groups across the instances the key can read, filtered by instance, channel, type, name, label or state. sort=activity lists the most recent first.',
    request: { query: listQuerySchema },
    responses: {
      200: { description: 'A page of chats', content: { 'application/json': { schema: ChatListResponse } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/chats',
    tags: ['Chats'],
    summary: 'Create a chat',
    request: { body: { content: { 'application/json': { schema: createChatSchema } } } },
    responses: {
      201: chatData('The created chat'),
      400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/chats/{id}',
    tags: ['Chats'],
    summary: 'Get a chat',
    request: { params: idParam },
    responses: { 200: chatData('The chat'), 404: notFound },
  });

  registry.registerPath({
    method: 'patch',
    path: '/chats/{id}',
    tags: ['Chats'],
    summary: 'Update a chat',
    request: { params: idParam, body: { content: { 'application/json': { schema: updateChatSchema } } } },
    responses: { 200: chatData('The updated chat'), 404: notFound },
  });

  registry.registerPath({
    method: 'delete',
    path: '/chats/{id}',
    tags: ['Chats'],
    summary: 'Delete a chat',
    description: 'Soft delete: the chat is hidden from lists and can be restored.',
    request: { params: idParam },
    responses: {
      200: { description: 'Deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/chats/{id}/messages',
    tags: ['Chats'],
    summary: 'List the messages of a chat',
    description: 'Newest first, up to limit; before/after bound the time window and mediaOnly keeps media messages.',
    request: { params: idParam, query: listMessagesQuerySchema },
    responses: {
      200: {
        description: 'Messages',
        content: { 'application/json': { schema: z.object({ items: z.array(z.record(z.unknown())) }) } },
      },
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/chats/{id}/participants',
    tags: ['Chats'],
    summary: 'List the participants of a chat',
    request: { params: idParam },
    responses: {
      200: {
        description: 'Participants',
        content: { 'application/json': { schema: z.object({ items: z.array(ChatParticipantSchema) }) } },
      },
      404: notFound,
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/chats/{id}/participants',
    tags: ['Chats'],
    summary: 'Add a participant to a chat',
    request: { params: idParam, body: { content: { 'application/json': { schema: addParticipantSchema } } } },
    responses: {
      201: {
        description: 'The participant',
        content: { 'application/json': { schema: z.object({ data: ChatParticipantSchema }) } },
      },
      404: notFound,
    },
  });
}
