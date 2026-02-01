/**
 * OpenAPI schemas for person endpoints
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema, PaginationMetaSchema } from './common';

// Identity schema
export const IdentitySchema = z.object({
  id: z.string().uuid().openapi({ description: 'Identity UUID' }),
  personId: z.string().uuid().openapi({ description: 'Person UUID' }),
  channel: z.string().openapi({ description: 'Channel type' }),
  platformUserId: z.string().openapi({ description: 'Platform user ID' }),
  displayName: z.string().nullable().openapi({ description: 'Display name' }),
  profilePicUrl: z.string().nullable().openapi({ description: 'Profile picture URL' }),
  messageCount: z.number().int().openapi({ description: 'Total messages' }),
  lastSeenAt: z.string().datetime().nullable().openapi({ description: 'Last seen timestamp' }),
});

// Person schema
export const PersonSchema = z.object({
  id: z.string().uuid().openapi({ description: 'Person UUID' }),
  displayName: z.string().nullable().openapi({ description: 'Display name' }),
  email: z.string().email().nullable().openapi({ description: 'Email address' }),
  phone: z.string().nullable().openapi({ description: 'Phone number' }),
  createdAt: z.string().datetime().openapi({ description: 'Creation timestamp' }),
  updatedAt: z.string().datetime().openapi({ description: 'Last update timestamp' }),
});

// Presence schema
export const PersonPresenceSchema = z.object({
  person: PersonSchema,
  identities: z.array(IdentitySchema),
  summary: z.object({
    totalMessages: z.number().int(),
    channels: z.array(z.string()),
    lastSeenAt: z.string().datetime().nullable(),
  }),
  byChannel: z.record(
    z.string(),
    z.object({
      identities: z.array(IdentitySchema),
      messageCount: z.number().int(),
      lastSeenAt: z.string().datetime().nullable(),
    }),
  ),
});

// Link identities request
export const LinkIdentitiesSchema = z.object({
  identityA: z.string().uuid().openapi({ description: 'First identity ID' }),
  identityB: z.string().uuid().openapi({ description: 'Second identity ID' }),
});

// Unlink identity request
export const UnlinkIdentitySchema = z.object({
  identityId: z.string().uuid().openapi({ description: 'Identity ID to unlink' }),
  reason: z.string().min(1).openapi({ description: 'Reason for unlinking' }),
});

// Merge persons request
export const MergePersonsSchema = z.object({
  sourcePersonId: z.string().uuid().openapi({ description: 'Person to merge from (will be deleted)' }),
  targetPersonId: z.string().uuid().openapi({ description: 'Person to merge into (will be kept)' }),
  reason: z.string().optional().openapi({ description: 'Reason for merge' }),
});

export function registerPersonSchemas(registry: OpenAPIRegistry): void {
  registry.register('Identity', IdentitySchema);
  registry.register('Person', PersonSchema);
  registry.register('PersonPresence', PersonPresenceSchema);
  registry.register('LinkIdentitiesRequest', LinkIdentitiesSchema);
  registry.register('UnlinkIdentityRequest', UnlinkIdentitySchema);
  registry.register('MergePersonsRequest', MergePersonsSchema);

  registry.registerPath({
    method: 'get',
    path: '/persons',
    tags: ['Persons'],
    summary: 'Search persons',
    description: 'Search for persons by name, email, or phone.',
    request: {
      query: z.object({
        search: z.string().min(1).openapi({ description: 'Search term' }),
        limit: z.number().int().min(1).max(100).default(20).openapi({ description: 'Max results' }),
      }),
    },
    responses: {
      200: {
        description: 'Search results',
        content: { 'application/json': { schema: z.object({ items: z.array(PersonSchema) }) } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/persons/{id}',
    tags: ['Persons'],
    summary: 'Get person by ID',
    description: 'Get details of a specific person.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Person UUID' }) }) },
    responses: {
      200: {
        description: 'Person details',
        content: { 'application/json': { schema: z.object({ data: PersonSchema }) } },
      },
      404: { description: 'Person not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/persons/{id}/presence',
    tags: ['Persons'],
    summary: 'Get person presence',
    description: 'Get all identities and presence information for a person.',
    request: { params: z.object({ id: z.string().uuid().openapi({ description: 'Person UUID' }) }) },
    responses: {
      200: {
        description: 'Presence data',
        content: { 'application/json': { schema: z.object({ data: PersonPresenceSchema }) } },
      },
      404: { description: 'Person not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/persons/{id}/timeline',
    tags: ['Persons'],
    summary: 'Get person timeline',
    description: 'Get cross-channel message timeline for a person.',
    request: {
      params: z.object({ id: z.string().uuid().openapi({ description: 'Person UUID' }) }),
      query: z.object({
        channels: z.string().optional().openapi({ description: 'Channel types (comma-separated)' }),
        since: z.string().datetime().optional().openapi({ description: 'Start date' }),
        until: z.string().datetime().optional().openapi({ description: 'End date' }),
        limit: z.number().int().min(1).max(100).default(50).openapi({ description: 'Max results' }),
        cursor: z.string().optional().openapi({ description: 'Pagination cursor' }),
      }),
    },
    responses: {
      200: {
        description: 'Timeline events',
        content: {
          'application/json': { schema: z.object({ items: z.array(z.unknown()), meta: PaginationMetaSchema }) },
        },
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/persons/link',
    tags: ['Persons'],
    summary: 'Link identities',
    description: 'Link two identities to the same person.',
    request: { body: { content: { 'application/json': { schema: LinkIdentitiesSchema } } } },
    responses: {
      200: {
        description: 'Identities linked',
        content: { 'application/json': { schema: z.object({ data: PersonSchema }) } },
      },
      404: { description: 'Identity not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/persons/unlink',
    tags: ['Persons'],
    summary: 'Unlink identity',
    description: 'Unlink an identity from its person.',
    request: { body: { content: { 'application/json': { schema: UnlinkIdentitySchema } } } },
    responses: {
      200: {
        description: 'Identity unlinked',
        content: {
          'application/json': {
            schema: z.object({ data: z.object({ person: PersonSchema, identity: IdentitySchema }) }),
          },
        },
      },
      404: { description: 'Identity not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/persons/merge',
    tags: ['Persons'],
    summary: 'Merge persons',
    description: 'Merge two persons into one.',
    request: { body: { content: { 'application/json': { schema: MergePersonsSchema } } } },
    responses: {
      200: {
        description: 'Persons merged',
        content: {
          'application/json': {
            schema: z.object({
              data: z.object({
                person: PersonSchema,
                mergedIdentityIds: z.array(z.string().uuid()),
                deletedPersonId: z.string().uuid(),
              }),
            }),
          },
        },
      },
      404: { description: 'Person not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
