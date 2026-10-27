/**
 * OpenAPI schemas for chat keys: children of an API key, each locked to one
 * chat (wish: omni-chat-threads). The request bodies here are the ones the
 * routes in `routes/v2/keys.ts` validate with, so the spec and the route
 * cannot drift apart.
 *
 * The rest of `/keys` predates the OpenAPI registry and is still on the
 * grandfather list (`__tests__/openapi-undocumented-routes.ts`).
 */

import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { z } from '../../lib/zod-openapi';
import { ErrorSchema } from './common';

/** `POST /keys/children`: the chat row the child is locked to, and nothing else. */
export const MintChildKeyBodySchema = z
  .object({
    chatId: z.string().uuid().openapi({ description: "The chat row's UUID (not its JID)" }),
  })
  .strict();

/** `POST /keys/children/:id/revoke`. */
export const RevokeChildKeyBodySchema = z
  .object({
    reason: z
      .string()
      .max(500)
      .optional()
      .openapi({ description: 'Accepted for compatibility; not recorded (the revoke is recorded as own_child)' }),
  })
  .strict();

export const ChildKeySchema = z.object({
  id: z.string().uuid().openapi({ description: 'The chat key id' }),
  plainTextKey: z.string().openapi({ description: 'The key itself. Returned once; never stored by Omni in clear.' }),
  parentKeyId: z.string().uuid().openapi({ description: 'The key that minted it (the caller)' }),
  chatId: z.string().uuid().openapi({ description: "The chat row's UUID" }),
  chatExternalId: z.string().openapi({ description: "The chat's id on its channel (a WhatsApp JID)" }),
  instanceId: z.string().uuid().openapi({ description: "The chat's instance" }),
  scopes: z.array(z.string()).openapi({
    description:
      'The cs scopes the caller holds: messages:send and chats:read, plus context:write and turns:close when held',
  }),
  expiresAt: z
    .string()
    .datetime()
    .nullable()
    .openapi({ description: "The caller's own expiry; null when it never expires" }),
  replacedKeyId: z
    .string()
    .uuid()
    .nullable()
    .openapi({ description: "The caller's previous key for this chat, revoked by this mint" }),
});

export const ChildKeyRevokeResultSchema = z.object({
  id: z.string().uuid().openapi({ description: 'The chat key id' }),
  status: z.enum(['revoked', 'already_revoked']).openapi({ description: 'What the call did' }),
});

const ERROR_CONTENT = { 'application/json': { schema: ErrorSchema } };

export function registerKeySchemas(registry: OpenAPIRegistry): void {
  registry.register('MintChildKeyRequest', MintChildKeyBodySchema);
  registry.register('ChildKey', ChildKeySchema);
  registry.register('RevokeChildKeyRequest', RevokeChildKeyBodySchema);
  registry.register('ChildKeyRevokeResult', ChildKeyRevokeResultSchema);

  registry.registerPath({
    method: 'post',
    path: '/keys/children',
    operationId: 'mintChildKey',
    tags: ['Keys'],
    summary: 'Mint a chat key',
    description:
      'Mint a `cs` key locked to one chat (its UUID and JID), its instance and its recipient, with the ' +
      "caller's expiry. The caller must be a root key: no parent, no chat, instance or recipient lock, " +
      'no tenant credential, holding chats:keys, chats:read and messages:send. A second mint for the ' +
      "same chat revokes the caller's previous key for it. A caller may hold 500 live chat keys.",
    request: { body: { content: { 'application/json': { schema: MintChildKeyBodySchema } } } },
    responses: {
      201: {
        description: 'Chat key minted',
        content: { 'application/json': { schema: z.object({ data: ChildKeySchema }) } },
      },
      400: { description: 'Invalid body (any field besides chatId)', content: ERROR_CONTENT },
      403: { description: 'The caller may not mint chat keys, or not on that instance', content: ERROR_CONTENT },
      404: { description: 'No chat row with that id', content: ERROR_CONTENT },
      409: { description: 'CHILD_LIMIT: the caller already holds 500 live chat keys', content: ERROR_CONTENT },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/keys/children/self/revoke',
    operationId: 'revokeOwnChatKey',
    tags: ['Keys'],
    summary: 'A chat key revokes itself',
    description:
      "The calling chat key cuts itself. It names no target, so it can reach no other key; the key's " +
      'chat, instance and recipient locks do not apply to this one route.',
    responses: {
      200: {
        description: 'The calling key is revoked',
        content: { 'application/json': { schema: z.object({ data: ChildKeyRevokeResultSchema }) } },
      },
      403: { description: 'The caller is not a chat key', content: ERROR_CONTENT },
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/keys/children/{id}/revoke',
    operationId: 'revokeChildKey',
    tags: ['Keys'],
    summary: 'Revoke one of your chat keys',
    description:
      "Revoke a chat key the caller minted. Ownership is the key's parent, never who created it; the " +
      'caller must pass the same checks as for a mint.',
    request: {
      params: z.object({ id: z.string().openapi({ description: 'The chat key id' }) }),
      body: { required: false, content: { 'application/json': { schema: RevokeChildKeyBodySchema } } },
    },
    responses: {
      200: {
        description: 'Revoked, or already revoked',
        content: { 'application/json': { schema: z.object({ data: ChildKeyRevokeResultSchema }) } },
      },
      400: { description: 'Invalid body', content: ERROR_CONTENT },
      403: {
        description: "The caller may not revoke chat keys, or the key is not the caller's",
        content: ERROR_CONTENT,
      },
      404: { description: 'No key with that id', content: ERROR_CONTENT },
    },
  });
}
