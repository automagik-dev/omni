/**
 * OpenAPI schemas for conversation endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

// Conversation schema
export const ConversationSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Conversation UUID' }),
  title: z.string().nullable().openapi({ description: 'Conversation title' }),
  summary: z.string().nullable().openapi({ description: 'Conversation summary' }),
  state: z.record(z.string(), z.unknown()).nullable().openapi({ description: 'Arbitrary state object' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Create conversation request
export const CreateConversationSchema = z.object({
  title: z.string().max(500).nullable().optional().openapi({ description: 'Conversation title' }),
  summary: z.string().nullable().optional().openapi({ description: 'Conversation summary' }),
  state: z.record(z.string(), z.unknown()).nullable().optional().openapi({ description: 'Arbitrary state object' }),
});

// Chat schema (lightweight, for nested listing)
const ChatRefSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Chat UUID' }),
  name: z.string().nullable().openapi({ description: 'Chat name' }),
  chatType: z.string().openapi({ description: 'Chat type (dm, group, etc.)' }),
  instanceId: z.string().uuid().openapi({ description: 'Instance UUID' }),
  conversationId: z.string().uuid().nullable().openapi({ description: 'Parent conversation UUID' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

export function registerConversationSchemas(registry: OpenAPIRegistry): void {
  registry.register('Conversation', ConversationSchema);
  registry.register('CreateConversationRequest', CreateConversationSchema);

  registry.registerPath({
    method: 'get',
    path: '/conversations',
    operationId: 'listConversations',
    tags: ['Conversations'],
    summary: 'List conversations',
    description: 'Get all conversations ordered by most recently updated.',
    request: {
      query: z.object({
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .default(50)
          .optional()
          .openapi({ description: 'Max results (default 50, max 200)' }),
      }),
    },
    responses: {
      200: {
        description: 'List of conversations',
        content: { 'application/json': { schema: z.object({ items: z.array(ConversationSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/conversations/{id}',
    operationId: 'getConversation',
    tags: ['Conversations'],
    summary: 'Get conversation',
    description: 'Get details of a specific conversation.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Conversation UUID' }) }) },
    responses: {
      200: {
        description: 'Conversation details',
        content: { 'application/json': { schema: z.object({ data: ConversationSchema }) } },
      },
      404: { description: 'Conversation not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/conversations',
    operationId: 'createConversation',
    tags: ['Conversations'],
    summary: 'Create conversation',
    description: 'Create a new cross-channel conversation container.',
    request: { body: { content: { 'application/json': { schema: CreateConversationSchema } } } },
    responses: {
      201: {
        description: 'Conversation created',
        content: { 'application/json': { schema: z.object({ data: ConversationSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: '/conversations/{id}',
    operationId: 'updateConversation',
    tags: ['Conversations'],
    summary: 'Update conversation',
    description: 'Update an existing conversation.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Conversation UUID' }) }),
      body: { content: { 'application/json': { schema: CreateConversationSchema.partial() } } },
    },
    responses: {
      200: {
        description: 'Conversation updated',
        content: { 'application/json': { schema: z.object({ data: ConversationSchema }) } },
      },
      404: { description: 'Conversation not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/conversations/{id}',
    operationId: 'deleteConversation',
    tags: ['Conversations'],
    summary: 'Delete conversation',
    description: 'Delete a conversation. Linked chats will have their conversationId set to null.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Conversation UUID' }) }) },
    responses: {
      200: { description: 'Conversation deleted', content: { 'application/json': { schema: SuccessSchema } } },
      404: { description: 'Conversation not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/conversations/{id}/chats',
    operationId: 'getConversationChats',
    tags: ['Conversations'],
    summary: 'Get chats in conversation',
    description: 'List all chats belonging to a conversation.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Conversation UUID' }) }) },
    responses: {
      200: {
        description: 'List of chats',
        content: { 'application/json': { schema: z.object({ items: z.array(ChatRefSchema) }) } },
      },
      404: { description: 'Conversation not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
