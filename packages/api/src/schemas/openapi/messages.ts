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

export function registerMessageSchemas(registry: OpenAPIRegistry): void {
  registry.register('MessageResponse', MessageResponseSchema);
  registry.register('SendTextRequest', SendTextSchema);
  registry.register('SendMediaRequest', SendMediaSchema);
  registry.register('SendReactionRequest', SendReactionSchema);
  registry.register('SendStickerRequest', SendStickerSchema);
  registry.register('SendContactRequest', SendContactSchema);
  registry.register('SendLocationRequest', SendLocationSchema);

  registry.registerPath({
    method: 'post',
    path: '/messages',
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
}
