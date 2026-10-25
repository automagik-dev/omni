/**
 * OpenAPI schemas for this Omni's version and the updates its owner confirms
 * (routes/v2/system.ts, system/update.ts).
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

const error = (description: string) => ({ description, content: { 'application/json': { schema: ErrorSchema } } });
const ok = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { 'application/json': { schema: z.object({ data: schema }) } },
});

export const UpdateStatusSchema = z
  .object({
    current: z.string().openapi({ description: 'The version this Omni runs' }),
    channel: z.enum(['latest', 'next']).openapi({ description: 'The npm dist-tag this Omni follows' }),
    latest: z
      .string()
      .nullable()
      .openapi({ description: 'What the channel publishes now; null when the registry could not be read' }),
    updateAvailable: z.boolean(),
    mode: z.enum(['off', 'command']).openapi({ description: 'off: the operator has not set OMNI_UPDATE_COMMAND' }),
    confirm: z.enum(['whatsapp', 'app']).openapi({
      description:
        "Who says yes: whatsapp, the owner's `update <CODE>`; app, the request itself (a loopback-only Omni " +
        'whose operator set OMNI_UPDATE_CONFIRM=app, such as a sandbox)',
    }),
    pending: z
      .object({ version: z.string(), expiresAt: z.string().datetime() })
      .optional()
      .openapi({ description: 'An update waiting for the owner to confirm it on WhatsApp' }),
    inFlight: z
      .object({ version: z.string(), startedAt: z.string().datetime() })
      .optional()
      .openapi({ description: 'An update the owner confirmed that has not finished' }),
  })
  .openapi('UpdateStatus');

export function registerSystemSchemas(registry: OpenAPIRegistry): void {
  registry.register('UpdateStatus', UpdateStatusSchema);

  registry.registerPath({
    method: 'get',
    path: '/system/update',
    operationId: 'getUpdateStatus',
    tags: ['System'],
    summary: 'Version and update status',
    description:
      'What this Omni runs, what its update channel publishes, and any update waiting or running. Needs ' +
      'system:read (device keys carry it by default).',
    responses: { 200: ok(UpdateStatusSchema, 'Update status') },
  });

  registry.registerPath({
    method: 'post',
    path: '/system/update',
    operationId: 'requestUpdate',
    tags: ['System'],
    summary: 'Ask for an update the owner confirms',
    description:
      'Asks this Omni to update to the version its channel publishes now. Nothing changes yet: the owner gets ' +
      '"Update Omni from X to Y? Reply update <CODE>" in their own WhatsApp self chat, and only that reply, ' +
      "within ten minutes, runs the operator's OMNI_UPDATE_COMMAND. On an Omni that listens only on loopback and " +
      'whose operator set OMNI_UPDATE_CONFIRM=app (a sandbox), the request is the yes: the app asked the person ' +
      'on screen, and the update starts at once. Off unless the operator set OMNI_UPDATE_COMMAND. Needs ' +
      'system:update (device keys carry it by default) or system:admin.',
    request: {
      body: {
        content: {
          'application/json': {
            schema: z.object({
              version: z.string().openapi({ description: 'Exactly the version the channel publishes now' }),
            }),
          },
        },
      },
    },
    responses: {
      202: ok(
        z.discriminatedUnion('status', [
          z.object({
            status: z.literal('awaiting-confirmation'),
            version: z.string(),
            expiresAt: z.string().datetime(),
          }),
          z.object({ status: z.literal('started'), version: z.string(), startedAt: z.string().datetime() }),
        ]),
        "Waiting for the owner's yes on WhatsApp, or started (confirm: app)",
      ),
      400: error('Malformed body'),
      409: error(
        'UPDATE_NOT_CONFIGURED, CONFIRM_CHANNEL_MISSING, UPDATE_PENDING, UPDATE_IN_PROGRESS, VERSION_MISMATCH or ALREADY_CURRENT',
      ),
      502: error('CONFIRM_SEND_FAILED: the owner could not be reached on WhatsApp'),
      503: error(
        'REGISTRY_UNAVAILABLE: the update channel could not be read; UPDATE_START_FAILED: the command could not start',
      ),
    },
  });
}
