/**
 * OpenAPI schemas for human login (wish: omni-labs-distribution).
 *
 * Omni's own login endpoints under /api/v2/login, all public (`security: []`) and
 * all 404 unless the deployment set OMNI_LOGIN_ENABLED=true. Better Auth's own
 * endpoints under /api/auth (the RFC 8628 device flow and passkeys) follow Better
 * Auth's documentation and are not repeated here.
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

const claimToken = z.object({
  'x-omni-claim-token': z.string().openapi({ description: 'The claim token printed in the server log at boot' }),
});
const error = (description: string) => ({ description, content: { 'application/json': { schema: ErrorSchema } } });
const ok = (schema: z.ZodTypeAny, description: string) => ({
  description,
  content: { 'application/json': { schema: z.object({ data: schema }) } },
});
const json = (schema: z.ZodTypeAny) => ({ body: { content: { 'application/json': { schema } } } });

export const LoginStatusSchema = z
  .object({
    claimed: z.boolean().openapi({ description: 'Whether this Omni has an owner' }),
    whatsapp: z.string().nullable().openapi({
      description: "The owner's own WhatsApp number (+E.164) while connected; a device's QR opens its self chat",
    }),
    deviceUrl: z.string().openapi({ description: 'The device-approval page (RFC 8628 verification_uri)' }),
  })
  .openapi('LoginStatus');

export const DeviceKeySchema = z
  .object({
    apiKey: z.string().openapi({ description: 'The device’s Omni API key (x-api-key). Returned once.' }),
    keyId: z.string().uuid(),
    scopes: z.array(z.string()),
    keyExpiresAt: z.string().datetime().nullable().openapi({ description: 'Null: never expires; revoke it instead' }),
    apiUrl: z.string().openapi({ description: 'The base URL the device should use' }),
  })
  .openapi('DeviceKey');

const SentToSchema = z.object({ sentTo: z.string().openapi({ description: 'The masked number the code went to' }) });

export function registerLoginSchemas(registry: OpenAPIRegistry): void {
  registry.register('LoginStatus', LoginStatusSchema);
  registry.register('DeviceKey', DeviceKeySchema);
  const common = { tags: ['Auth'], security: [] };

  registry.registerPath({
    ...common,
    method: 'get',
    path: '/login/status',
    operationId: 'getLoginStatus',
    summary: 'Login status (public)',
    description: 'Whether this Omni has an owner, and what a device needs to start signing in.',
    responses: { 200: ok(LoginStatusSchema, 'Status'), 404: error('Login is not enabled here') },
  });

  registry.registerPath({
    ...common,
    method: 'post',
    path: '/api/login/device-key',
    operationId: 'createDeviceKey',
    summary: 'Trade a device token for an Omni key (public)',
    description:
      'A device that finished the RFC 8628 device flow at /api/auth/device/token, after its owner approved it on ' +
      'the approval page or by sending the code to themselves on WhatsApp, sends that access token here as a ' +
      'Bearer token and gets an Omni API key. The token works once.',
    request: {
      headers: z.object({
        authorization: z.string().openapi({ description: 'Bearer <access_token from /api/auth/device/token>' }),
        'x-omni-client': z.string().optional().openapi({ description: 'omni-desktop, omni-dsh or omni-cli' }),
      }),
      ...json(z.object({ deviceName: z.string().min(1).max(80) })),
    },
    responses: {
      200: ok(DeviceKeySchema, 'The device key'),
      401: error('Missing, unknown or used device token'),
      404: error('Login is not enabled here'),
    },
  });

  registry.registerPath({
    ...common,
    method: 'post',
    path: '/login/send-code',
    operationId: 'sendOwnerLoginCode',
    summary: "Send a login code to the owner's WhatsApp (public)",
    description: "A 6-digit code arrives in the owner's own self chat. The number is never taken from the request.",
    responses: {
      200: ok(SentToSchema, 'Code sent'),
      409: error("The owner's WhatsApp is not connected"),
      404: error('Login is not enabled here, or the Omni is unclaimed'),
    },
  });

  registry.registerPath({
    ...common,
    method: 'post',
    path: '/login/verify',
    operationId: 'verifyOwnerLoginCode',
    summary: 'Sign in with that code (public)',
    description: 'Sets the owner’s session cookie.',
    request: json(z.object({ code: z.string().regex(/^\d{6}$/) })),
    responses: { 200: ok(z.object({ signedIn: z.boolean() }), 'Signed in'), 400: error('Wrong or expired code') },
  });

  for (const [method, path, operationId, summary, body, response] of [
    [
      'get',
      '/api/login/claim/accounts',
      'listClaimAccounts',
      'WhatsApp accounts this Omni can be claimed with',
      null,
      z.array(z.object({ instanceId: z.string().uuid(), name: z.string(), phone: z.string() })),
    ],
    [
      'post',
      '/api/login/claim/whatsapp',
      'connectClaimWhatsApp',
      'Link a first WhatsApp to an unclaimed Omni',
      null,
      z.object({ instanceId: z.string().uuid() }),
    ],
    [
      'post',
      '/api/login/claim/send-code',
      'sendClaimCode',
      "Send a claim code to that account's self chat",
      z.object({ instanceId: z.string().uuid() }),
      SentToSchema,
    ],
    [
      'post',
      '/api/login/claim/verify',
      'verifyClaimCode',
      'Claim the Omni with that code',
      z.object({ instanceId: z.string().uuid(), code: z.string() }),
      z.object({ claimed: z.boolean() }),
    ],
  ] as const) {
    registry.registerPath({
      ...common,
      method,
      path,
      operationId,
      summary: `${summary} (public, claim token)`,
      description: 'Only while the Omni has no owner, and only with the claim token from the boot log; otherwise 404.',
      request: { headers: claimToken, ...(body ? json(body) : {}) },
      responses: { 200: ok(response, 'Done'), 404: error('Claimed already, wrong token, or login off') },
    });
  }

  registry.registerPath({
    ...common,
    method: 'get',
    path: '/api/login/claim/whatsapp/{id}',
    operationId: 'getClaimWhatsApp',
    summary: 'Linking state of the claim WhatsApp (public, claim token)',
    description: 'The QR to scan (SVG) until linked, then the masked number.',
    request: { headers: claimToken, params: z.object({ id: z.string().uuid() }) },
    responses: {
      200: ok(
        z.object({ connected: z.boolean(), phone: z.string().nullable(), qrSvg: z.string().nullable() }),
        'State',
      ),
      404: error('Claimed already, wrong token, or login off'),
    },
  });
}
