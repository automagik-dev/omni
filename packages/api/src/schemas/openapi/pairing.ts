/**
 * OpenAPI schemas for device pairing (wish: omni-labs-distribution, Group 2).
 *
 * Three public operations, documented with `security: []`. They answer 404
 * unless the deployment set OMNI_PAIRING_ENABLED=true (and always with
 * multitenancy on), exactly like a path that does not exist.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

export const PairingStartBodyOpenApiSchema = z
  .object({
    deviceName: z.string().min(1).max(80).openapi({
      description: 'What the owner will see this device called, e.g. "Felipe’s MacBook"',
    }),
  })
  .openapi('PairingStartBody');

export const PairingStartSchema = z
  .object({
    data: z.object({
      pairingId: z.string().uuid().openapi({ description: 'Handle for polling and cancelling' }),
      code: z.string().openapi({ description: 'Show this to the person: XXXX-XXXX, valid until expiresAt' }),
      sendTo: z.string().openapi({ description: 'The pairing WhatsApp number to send the code to, +E.164' }),
      waLink: z.string().openapi({ description: 'https://wa.me/… link that opens that chat with the code typed' }),
      expiresAt: z.string().datetime(),
      pollToken: z.string().openapi({
        description: 'Secret for GET/DELETE /pair/{id} as the x-pairing-token header. Returned once; keep it.',
      }),
      pollIntervalMs: z.number().int().openapi({ description: 'How often to poll' }),
    }),
  })
  .openapi('PairingStart');

export const PairingPollSchema = z
  .object({
    data: z.object({
      status: z.enum(['pending', 'approved', 'consumed', 'cancelled', 'expired']).openapi({
        description:
          '`approved` comes exactly once, carrying the key; every later poll reads `consumed`. `expired` after ten minutes.',
      }),
      apiKey: z.string().optional().openapi({ description: 'The new API key (x-api-key). Only on the approved poll.' }),
      keyId: z.string().uuid().optional(),
      scopes: z.array(z.string()).optional().openapi({ description: 'Scopes the server configured for paired keys' }),
      keyExpiresAt: z.string().datetime().optional(),
      apiUrl: z.string().nullable().optional().openapi({
        description: 'Base URL the device should use from now on; null means the URL it paired against',
      }),
    }),
  })
  .openapi('PairingPoll');

const pathId = z.object({ id: z.string().uuid() });
const tokenHeader = z.object({
  'x-pairing-token': z.string().openapi({ description: 'The pollToken POST /pair/start returned' }),
});

export function registerPairingSchemas(registry: OpenAPIRegistry): void {
  registry.register('PairingStartBody', PairingStartBodyOpenApiSchema);
  registry.register('PairingStart', PairingStartSchema);
  registry.register('PairingPoll', PairingPollSchema);

  registry.registerPath({
    method: 'post',
    path: '/pair/start',
    operationId: 'startDevicePairing',
    tags: ['Auth'],
    summary: 'Start pairing a device (public)',
    description:
      'Returns a short code and the WhatsApp number to send it to. When the pairing instance’s owner sends the ' +
      'code from its own "Message yourself" chat (or a number the server allowlists sends it in a direct chat), ' +
      'the pairing is approved and the next poll returns an API key. Unauthenticated, rate-limited per IP; 404 ' +
      'unless the server enables pairing.',
    security: [],
    request: { body: { content: { 'application/json': { schema: PairingStartBodyOpenApiSchema } } } },
    responses: {
      200: { description: 'Pairing started', content: { 'application/json': { schema: PairingStartSchema } } },
      400: { description: 'Invalid body', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'Pairing is not enabled here', content: { 'application/json': { schema: ErrorSchema } } },
      429: {
        description: 'Rate limited, or too many pairings waiting',
        content: { 'application/json': { schema: ErrorSchema } },
      },
      503: {
        description: 'The pairing channel cannot take codes right now',
        content: { 'application/json': { schema: ErrorSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/pair/{id}',
    operationId: 'pollDevicePairing',
    tags: ['Auth'],
    summary: 'Poll a device pairing (public)',
    description:
      'Status of a pairing, read with its poll token. The poll that finds it approved mints the API key and ' +
      'returns it; the key is never returned again. Unknown ids and wrong tokens both answer 404.',
    security: [],
    request: { params: pathId, headers: tokenHeader },
    responses: {
      200: { description: 'Pairing status', content: { 'application/json': { schema: PairingPollSchema } } },
      404: { description: 'Unknown pairing or wrong token', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: '/pair/{id}',
    operationId: 'cancelDevicePairing',
    tags: ['Auth'],
    summary: 'Cancel a device pairing (public)',
    description:
      'Cancels a pending pairing, read with its poll token. `cancelled` is false when it was no longer pending.',
    security: [],
    request: { params: pathId, headers: tokenHeader },
    responses: {
      200: {
        description: 'Cancelled, or no longer pending',
        content: { 'application/json': { schema: z.object({ data: z.object({ cancelled: z.boolean() }) }) } },
      },
      404: { description: 'Unknown pairing or wrong token', content: { 'application/json': { schema: ErrorSchema } } },
    },
  });
}
