/**
 * OpenAPI schemas for the operator's way in (routes/v2/owner.ts, login/operator.ts):
 * `omni claim`, `omni approve` and `omni connect`, behind an admin key (`auth:admin`).
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

const error = (description: string) => ({ description, content: { 'application/json': { schema: ErrorSchema } } });
const ok = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { 'application/json': { schema: z.object({ data: schema }) } },
});
const json = (schema: z.ZodTypeAny) => ({ body: { content: { 'application/json': { schema } } } });
const claimed = z.boolean().openapi({ description: 'True when this call made the operator the owner' });
const off = error('Human login is off on this Omni (OMNI_LOGIN_ENABLED=false, or multitenancy)');

export function registerOwnerSchemas(registry: OpenAPIRegistry): void {
  const common = { tags: ['Auth'] };

  registry.registerPath({
    ...common,
    method: 'post',
    path: '/owner/claim',
    operationId: 'claimAsOperator',
    summary: 'Claim this Omni as its operator',
    description:
      'Makes whoever holds this admin key the owner of an unclaimed Omni, with no WhatsApp. A WhatsApp number can ' +
      'be linked later from the claim link, to approve devices from a phone. Needs auth:admin.',
    responses: {
      200: ok(z.object({ claimed, whatsapp: z.boolean() }), 'The owner, claimed now or before'),
      409: off,
    },
  });

  registry.registerPath({
    ...common,
    method: 'post',
    path: '/owner/approve',
    operationId: 'approveDeviceAsOperator',
    summary: 'Approve a waiting device',
    description:
      'Approves the device showing this code, as the owner. On an unclaimed Omni it claims it first. Needs auth:admin.',
    request: json(z.object({ userCode: z.string().min(4).max(32) })),
    responses: {
      200: ok(
        z.object({
          approved: z.literal(true),
          client: z.string(),
          clientId: z.string().nullable(),
          claimed,
          requestedFrom: z.object({ ip: z.string().nullable(), at: z.string().datetime() }).nullable(),
        }),
        'Approved',
      ),
      404: error('No device is waiting with that code'),
      409: off,
    },
  });

  registry.registerPath({
    ...common,
    method: 'post',
    path: '/owner/connect',
    operationId: 'connectLinkAsOperator',
    summary: 'A one-time connect link for one device',
    description:
      'The link a device opens to connect with no sign-in: the same one the owner gets by texting "connect" to ' +
      'themselves. Works once, for ten minutes. On an unclaimed Omni it claims it first. Needs auth:admin.',
    request: json(
      z.object({
        url: z.string().optional().openapi({
          description: "Where devices reach this Omni, when it differs from this request's own address",
        }),
      }),
    ),
    responses: {
      201: ok(
        z.object({ url: z.string(), appLink: z.string(), expiresAt: z.string().datetime(), claimed }),
        'The link',
      ),
      400: error('No address to put in the link'),
      409: off,
      429: error('Too many links; wait'),
    },
  });
}
