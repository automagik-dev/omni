/**
 * Persons routes - Identity management
 */

import { zValidator } from '@hono/zod-validator';
import type { ChannelTypeSchema } from '@omni/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppVariables } from '../../types';

const personsRoutes = new Hono<{ Variables: AppVariables }>();

// List/search query schema
const listQuerySchema = z.object({
  search: z.string().min(1).optional().describe('Search term (name, email, or phone)'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().optional().describe('Cursor for pagination'),
});

// Timeline query schema
const timelineQuerySchema = z.object({
  channels: z
    .string()
    .optional()
    .transform((v) => v?.split(',') as z.infer<typeof ChannelTypeSchema>[] | undefined),
  since: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  until: z
    .string()
    .datetime()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined)),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

// Link identities schema
const linkIdentitiesSchema = z.object({
  identityA: z.string().uuid().describe('First identity ID'),
  identityB: z.string().uuid().describe('Second identity ID'),
});

// Unlink identity schema
const unlinkIdentitySchema = z.object({
  identityId: z.string().uuid().describe('Identity ID to unlink'),
  reason: z.string().min(1).describe('Reason for unlinking'),
});

// Merge persons schema
const mergePersonsSchema = z.object({
  sourcePersonId: z.string().uuid().describe('Person to merge from (will be deleted)'),
  targetPersonId: z.string().uuid().describe('Person to merge into (will be kept)'),
  reason: z.string().optional().describe('Reason for merge'),
});

/**
 * GET /persons - List or search persons
 */
personsRoutes.get('/', zValidator('query', listQuerySchema), async (c) => {
  const { search, limit, cursor } = c.req.valid('query');
  const services = c.get('services');

  if (search) {
    // Search mode
    const persons = await services.persons.search(search, limit);
    return c.json({ items: persons });
  }

  // List mode
  const result = await services.persons.list({ limit, cursor });
  return c.json({
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * GET /persons/:id - Get person by ID
 */
personsRoutes.get('/:id', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const person = await services.persons.getById(id);

  return c.json({ data: person });
});

/**
 * GET /persons/:id/presence - Get person presence (all identities)
 */
personsRoutes.get('/:id/presence', async (c) => {
  const id = c.req.param('id');
  const services = c.get('services');

  const presence = await services.persons.getPresence(id);

  return c.json({
    data: {
      person: presence.person,
      identities: presence.identities,
      summary: presence.summary,
      byChannel: Object.fromEntries(
        presence.identities.reduce((acc, identity) => {
          const channel = identity.channel;
          let channelData = acc.get(channel);
          if (!channelData) {
            channelData = {
              identities: [],
              messageCount: 0,
              lastSeenAt: null as Date | null,
            };
            acc.set(channel, channelData);
          }
          channelData.identities.push(identity);
          channelData.messageCount += identity.messageCount;
          if (identity.lastSeenAt && (!channelData.lastSeenAt || identity.lastSeenAt > channelData.lastSeenAt)) {
            channelData.lastSeenAt = identity.lastSeenAt;
          }
          return acc;
        }, new Map<
          string,
          { identities: typeof presence.identities; messageCount: number; lastSeenAt: Date | null }
        >()),
      ),
    },
  });
});

/**
 * GET /persons/:id/timeline - Get person timeline (cross-channel)
 */
personsRoutes.get('/:id/timeline', zValidator('query', timelineQuerySchema), async (c) => {
  const id = c.req.param('id');
  const query = c.req.valid('query');
  const services = c.get('services');

  const result = await services.events.getTimeline(id, {
    channels: query.channels,
    since: query.since,
    until: query.until,
    limit: query.limit,
    cursor: query.cursor,
  });

  return c.json({
    items: result.items,
    meta: {
      hasMore: result.hasMore,
      cursor: result.cursor,
    },
  });
});

/**
 * POST /persons/link - Link two identities
 */
personsRoutes.post('/link', zValidator('json', linkIdentitiesSchema), async (c) => {
  const { identityA, identityB } = c.req.valid('json');
  const services = c.get('services');

  const person = await services.persons.linkIdentities(identityA, identityB);

  return c.json({ data: person });
});

/**
 * POST /persons/unlink - Unlink an identity
 */
personsRoutes.post('/unlink', zValidator('json', unlinkIdentitySchema), async (c) => {
  const { identityId, reason } = c.req.valid('json');
  const services = c.get('services');

  const result = await services.persons.unlinkIdentity(identityId, reason);

  return c.json({
    data: {
      person: result.person,
      identity: result.identity,
    },
  });
});

/**
 * POST /persons/merge - Merge two persons
 */
personsRoutes.post('/merge', zValidator('json', mergePersonsSchema), async (c) => {
  const { sourcePersonId, targetPersonId, reason } = c.req.valid('json');
  const services = c.get('services');

  const result = await services.persons.mergePersons(sourcePersonId, targetPersonId, reason);

  return c.json({
    data: {
      person: result.person,
      mergedIdentityIds: result.mergedIdentityIds,
      deletedPersonId: result.deletedPersonId,
    },
  });
});

export { personsRoutes };
