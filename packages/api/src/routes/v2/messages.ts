/**
 * Messages routes - Send messages through channel instances
 */

import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const messagesRoutes = new Hono<{ Variables: AppVariables }>();

// Send text message schema
const sendTextSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID to send from'),
  to: z.string().min(1).describe('Recipient (phone number or platform ID)'),
  text: z.string().min(1).describe('Message text'),
  replyTo: z.string().optional().describe('Message ID to reply to'),
});

// Send media schema
const sendMediaSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID to send from'),
  to: z.string().min(1).describe('Recipient'),
  type: z.enum(['image', 'audio', 'video', 'document']).describe('Media type'),
  url: z.string().url().optional().describe('Media URL'),
  base64: z.string().optional().describe('Base64 encoded media'),
  filename: z.string().optional().describe('Filename for documents'),
  caption: z.string().optional().describe('Caption for media'),
  voiceNote: z.boolean().optional().describe('Send audio as voice note'),
});

// Send reaction schema
const sendReactionSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Chat ID'),
  messageId: z.string().min(1).describe('Message ID to react to'),
  emoji: z.string().min(1).describe('Emoji to react with'),
});

// Send sticker schema
const sendStickerSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Recipient'),
  url: z.string().url().optional().describe('Sticker URL'),
  base64: z.string().optional().describe('Base64 encoded sticker'),
});

// Send contact schema
const sendContactSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Recipient'),
  contact: z.object({
    name: z.string().min(1).describe('Contact name'),
    phone: z.string().optional().describe('Phone number'),
    email: z.string().email().optional().describe('Email address'),
    organization: z.string().optional().describe('Organization'),
  }),
});

// Send location schema
const sendLocationSchema = z.object({
  instanceId: z.string().uuid().describe('Instance ID'),
  to: z.string().min(1).describe('Recipient'),
  latitude: z.number().describe('Latitude'),
  longitude: z.number().describe('Longitude'),
  name: z.string().optional().describe('Location name'),
  address: z.string().optional().describe('Address'),
});

/**
 * POST /messages - Send text message
 */
messagesRoutes.post('/', zValidator('json', sendTextSchema), async (c) => {
  const { instanceId, to, text: _text, replyTo: _replyTo } = c.req.valid('json');
  const services = c.get('services');

  // Verify instance exists
  const instance = await services.instances.getById(instanceId);

  // TODO: Send message via channel plugin
  // For now, return a mock response
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return c.json(
    {
      data: {
        messageId,
        externalMessageId: messageId,
        status: 'sent',
        instanceId: instance.id,
        to,
      },
    },
    201,
  );
});

/**
 * POST /messages/media - Send media message
 */
messagesRoutes.post('/media', zValidator('json', sendMediaSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  // Verify instance exists
  const instance = await services.instances.getById(data.instanceId);

  // Validate that either url or base64 is provided
  if (!data.url && !data.base64) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Either url or base64 must be provided' } }, 400);
  }

  // TODO: Send media via channel plugin
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return c.json(
    {
      data: {
        messageId,
        externalMessageId: messageId,
        status: 'sent',
        instanceId: instance.id,
        to: data.to,
        mediaType: data.type,
      },
    },
    201,
  );
});

/**
 * POST /messages/reaction - Send reaction
 */
messagesRoutes.post('/reaction', zValidator('json', sendReactionSchema), async (c) => {
  const { instanceId, to: _to, messageId: _messageId, emoji: _emoji } = c.req.valid('json');
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(instanceId);

  // TODO: Send reaction via channel plugin
  return c.json({ success: true });
});

/**
 * POST /messages/sticker - Send sticker
 */
messagesRoutes.post('/sticker', zValidator('json', sendStickerSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(data.instanceId);

  // Validate that either url or base64 is provided
  if (!data.url && !data.base64) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Either url or base64 must be provided' } }, 400);
  }

  // TODO: Send sticker via channel plugin
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return c.json(
    {
      data: {
        messageId,
        externalMessageId: messageId,
        status: 'sent',
      },
    },
    201,
  );
});

/**
 * POST /messages/contact - Send contact card
 */
messagesRoutes.post('/contact', zValidator('json', sendContactSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(data.instanceId);

  // TODO: Send contact via channel plugin
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return c.json(
    {
      data: {
        messageId,
        externalMessageId: messageId,
        status: 'sent',
      },
    },
    201,
  );
});

/**
 * POST /messages/location - Send location
 */
messagesRoutes.post('/location', zValidator('json', sendLocationSchema), async (c) => {
  const data = c.req.valid('json');
  const services = c.get('services');

  // Verify instance exists
  await services.instances.getById(data.instanceId);

  // TODO: Send location via channel plugin
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  return c.json(
    {
      data: {
        messageId,
        externalMessageId: messageId,
        status: 'sent',
      },
    },
    201,
  );
});

export { messagesRoutes };
