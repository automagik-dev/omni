/**
 * OpenAPI schemas for message endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, SuccessSchema } from './common';

// Message response schema
export const MessageResponseSchema = z.object({
  messageId: z.string().openapi({ description: 'Internal message ID' }),
  externalMessageId: z.string().openapi({ description: 'External platform message ID' }),
  status: z.string().openapi({ description: 'Message status' }),
  instanceId: z.string().uuid().optional().openapi({ description: 'Instance UUID' }),
  to: z.string().optional().openapi({ description: 'Recipient' }),
  mediaType: z.string().optional().openapi({ description: 'Media type if applicable' }),
});

// Send text request
export const SendTextSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID to send from' }),
  to: z.string().min(1).openapi({ description: 'Recipient (phone number or platform ID)' }),
  text: z.string().min(1).openapi({ description: 'Message text' }),
  replyTo: z.string().optional().openapi({ description: 'Message ID to reply to' }),
});

// Send media request
export const SendMediaSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID to send from' }),
  to: z.string().min(1).openapi({ description: 'Recipient' }),
  type: z.enum(['image', 'audio', 'video', 'document']).openapi({ description: 'Media type' }),
  url: z.string().url().optional().openapi({ description: 'Media URL' }),
  base64: z.string().optional().openapi({ description: 'Base64 encoded media' }),
  filename: z.string().optional().openapi({ description: 'Filename for documents' }),
  caption: z.string().optional().openapi({ description: 'Caption for media' }),
  voiceNote: z.boolean().optional().openapi({ description: 'Send audio as voice note' }),
});

// Send reaction request
export const SendReactionSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
  to: z.string().min(1).openapi({ description: 'Chat ID' }),
  messageId: z.string().min(1).openapi({ description: 'Message ID to react to' }),
  emoji: z.string().min(1).openapi({ description: 'Emoji to react with' }),
});

// Send sticker request
export const SendStickerSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
  to: z.string().min(1).openapi({ description: 'Recipient' }),
  url: z.string().url().optional().openapi({ description: 'Sticker URL' }),
  base64: z.string().optional().openapi({ description: 'Base64 encoded sticker' }),
});

// Send contact request
export const SendContactSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
  to: z.string().min(1).openapi({ description: 'Recipient' }),
  contact: z.object({
    name: z.string().min(1).openapi({ description: 'Contact name' }),
    phone: z.string().optional().openapi({ description: 'Phone number' }),
    email: z.string().email().optional().openapi({ description: 'Email address' }),
    organization: z.string().optional().openapi({ description: 'Organization' }),
  }),
});

// Send location request
export const SendLocationSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
  to: z.string().min(1).openapi({ description: 'Recipient' }),
  latitude: z.number().openapi({ description: 'Latitude' }),
  longitude: z.number().openapi({ description: 'Longitude' }),
  name: z.string().optional().openapi({ description: 'Location name' }),
  address: z.string().optional().openapi({ description: 'Address' }),
});

// Send presence request
export const SendPresenceSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID to send from' }),
  to: z.string().min(1).openapi({ description: 'Chat ID to show presence in' }),
  type: z.enum(['typing', 'recording', 'paused']).openapi({ description: 'Presence type' }),
  duration: z
    .number()
    .int()
    .min(0)
    .max(30000)
    .optional()
    .default(5000)
    .openapi({ description: 'Duration in ms before auto-pause (default 5000, 0 = until paused)' }),
});

// Presence response
export const PresenceResponseSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
  chatId: z.string().openapi({ description: 'Chat ID where presence was sent' }),
  type: z.string().openapi({ description: 'Presence type sent' }),
  duration: z.number().openapi({ description: 'Duration in ms' }),
});

// Mark message read request
export const MarkMessageReadSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
});

// Mark batch read request
export const MarkBatchReadSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
  chatId: z.string().min(1).openapi({ description: 'Chat ID containing the messages' }),
  messageIds: z.array(z.string().min(1)).min(1).max(100).openapi({ description: 'Message IDs to mark as read' }),
});

// Mark chat read request
export const MarkChatReadSchema = z.object({
  instanceId: z.string().uuid().openapi({ description: 'Instance ID' }),
});

// Read receipt response
export const ReadReceiptResponseSchema = z.object({
  messageId: z.string().optional().openapi({ description: 'Internal message ID (if single message)' }),
  externalMessageId: z.string().optional().openapi({ description: 'External message ID' }),
  chatId: z.string().optional().openapi({ description: 'Chat ID' }),
  instanceId: z.string().uuid().optional().openapi({ description: 'Instance ID' }),
  messageCount: z.number().optional().openapi({ description: 'Number of messages marked (batch only)' }),
});

export function registerMessageSchemas(registry: OpenAPIRegistry): void {
  registry.register('MessageResponse', MessageResponseSchema);
  registry.register('SendTextRequest', SendTextSchema);
  registry.register('SendMediaRequest', SendMediaSchema);
  registry.register('SendReactionRequest', SendReactionSchema);
  registry.register('SendStickerRequest', SendStickerSchema);
  registry.register('SendContactRequest', SendContactSchema);
  registry.register('SendLocationRequest', SendLocationSchema);
  registry.register('SendPresenceRequest', SendPresenceSchema);
  registry.register('PresenceResponse', PresenceResponseSchema);
  registry.register('MarkMessageReadRequest', MarkMessageReadSchema);
  registry.register('MarkBatchReadRequest', MarkBatchReadSchema);
  registry.register('MarkChatReadRequest', MarkChatReadSchema);
  registry.register('ReadReceiptResponse', ReadReceiptResponseSchema);

  registry.registerPath({
    method: 'post',
    path: '/messages',
    operationId: 'sendTextMessage',
    tags: ['Messages'],
    summary: 'Send text message',
    description: 'Send a text message through a channel instance.',
    request: { body: { content: { 'application/json': { schema: SendTextSchema } } } },
    responses: {
      201: {
        description: 'Message sent',
        content: { 'application/json': { schema: z.object({ data: MessageResponseSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Instance not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/messages/media',
    operationId: 'sendMediaMessage',
    tags: ['Messages'],
    summary: 'Send media message',
    description: 'Send an image, audio, video, or document through a channel instance.',
    request: { body: { content: { 'application/json': { schema: SendMediaSchema } } } },
    responses: {
      201: {
        description: 'Media sent',
        content: { 'application/json': { schema: z.object({ data: MessageResponseSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Instance not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/messages/reaction',
    operationId: 'sendReaction',
    tags: ['Messages'],
    summary: 'Send reaction',
    description: 'React to a message with an emoji.',
    request: { body: { content: { 'application/json': { schema: SendReactionSchema } } } },
    responses: {
      200: { description: 'Reaction sent', content: { 'application/json': { schema: SuccessSchema } } },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Instance not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/messages/sticker',
    operationId: 'sendSticker',
    tags: ['Messages'],
    summary: 'Send sticker',
    description: 'Send a sticker through a channel instance.',
    request: { body: { content: { 'application/json': { schema: SendStickerSchema } } } },
    responses: {
      201: {
        description: 'Sticker sent',
        content: { 'application/json': { schema: z.object({ data: MessageResponseSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Instance not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/messages/contact',
    operationId: 'sendContact',
    tags: ['Messages'],
    summary: 'Send contact card',
    description: 'Send a contact card through a channel instance.',
    request: { body: { content: { 'application/json': { schema: SendContactSchema } } } },
    responses: {
      201: {
        description: 'Contact sent',
        content: { 'application/json': { schema: z.object({ data: MessageResponseSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Instance not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/messages/location',
    operationId: 'sendLocation',
    tags: ['Messages'],
    summary: 'Send location',
    description: 'Send a location through a channel instance.',
    request: { body: { content: { 'application/json': { schema: SendLocationSchema } } } },
    responses: {
      201: {
        description: 'Location sent',
        content: { 'application/json': { schema: z.object({ data: MessageResponseSchema }) } },
      },
      400: { description: 'Validation error', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Instance not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Presence endpoint
  registry.registerPath({
    method: 'post',
    path: '/messages/send/presence',
    operationId: 'sendPresence',
    tags: ['Messages', 'Presence'],
    summary: 'Send presence indicator',
    description:
      'Send typing/recording indicator in a chat. Auto-pauses after duration. WhatsApp supports typing, recording, paused. Discord only supports typing.',
    request: { body: { content: { 'application/json': { schema: SendPresenceSchema } } } },
    responses: {
      200: {
        description: 'Presence sent',
        content: { 'application/json': { schema: z.object({ success: z.boolean(), data: PresenceResponseSchema }) } },
      },
      400: {
        description: 'Validation error or capability not supported',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Instance not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Mark single message as read
  registry.registerPath({
    method: 'post',
    path: '/messages/{id}/read',
    operationId: 'markMessageRead',
    tags: ['Messages', 'Read Receipts'],
    summary: 'Mark message as read',
    description: 'Send read receipt for a specific message. WhatsApp only.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Message ID' }) }),
      body: { content: { 'application/json': { schema: MarkMessageReadSchema } } },
    },
    responses: {
      200: {
        description: 'Message marked as read',
        content: {
          'application/json': { schema: z.object({ success: z.boolean(), data: ReadReceiptResponseSchema }) },
        },
      },
      400: {
        description: 'Validation error or capability not supported',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Message not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Mark batch messages as read
  registry.registerPath({
    method: 'post',
    path: '/messages/read',
    operationId: 'markMessagesRead',
    tags: ['Messages', 'Read Receipts'],
    summary: 'Mark multiple messages as read',
    description: 'Send read receipts for multiple messages in a single chat. WhatsApp only.',
    request: { body: { content: { 'application/json': { schema: MarkBatchReadSchema } } } },
    responses: {
      200: {
        description: 'Messages marked as read',
        content: {
          'application/json': { schema: z.object({ success: z.boolean(), data: ReadReceiptResponseSchema }) },
        },
      },
      400: {
        description: 'Validation error or capability not supported',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Instance or chat not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  // Mark chat as read
  registry.registerPath({
    method: 'post',
    path: '/chats/{id}/read',
    operationId: 'markChatRead',
    tags: ['Chats', 'Read Receipts'],
    summary: 'Mark entire chat as read',
    description: 'Mark all unread messages in a chat as read. WhatsApp only.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Chat ID' }) }),
      body: { content: { 'application/json': { schema: MarkChatReadSchema } } },
    },
    responses: {
      200: {
        description: 'Chat marked as read',
        content: {
          'application/json': { schema: z.object({ success: z.boolean(), data: ReadReceiptResponseSchema }) },
        },
      },
      400: {
        description: 'Validation error or capability not supported',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      404: { description: 'Chat not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
