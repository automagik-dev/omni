/**
 * Typed action execution: invalid input never reaches the provider, provider
 * text is redacted, and a 401/403 revokes the connector. No database or
 * provider is real: the transport and the status update are recording fakes.
 */

import { describe, expect, test } from 'bun:test';
import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry } from '@omni/connector-sdk';
import type { Connector } from '@omni/db';
import { ConnectorService, type PreparedConnectorAction } from '../connectors';

const CONNECTOR_ID = '11111111-1111-1111-1111-111111111111';
const TOKEN = 'pk_secret_action_token';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function prepared(): PreparedConnectorAction {
  const action = clickupManifest.actions.find((candidate) => candidate.key === 'add_comment');
  if (!action) throw new Error('missing add_comment');
  const connector = {
    id: CONNECTOR_ID,
    tenantId: null,
    provider: 'clickup',
    name: 'ClickUp',
    credentials: JSON.stringify({ token: TOKEN }),
    config: {},
    status: 'connected',
  } as unknown as Connector;
  return {
    connector,
    manifest: clickupManifest,
    action,
    credentials: { token: TOKEN },
    config: {},
  };
}

function serviceWith(fetchImpl: typeof fetch) {
  const updates: Array<Record<string, unknown>> = [];
  const db = {
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
          return {};
        },
      }),
    }),
  };
  const service = new ConnectorService(db as never, null, new ConnectorRegistry([clickupManifest]), {
    fetch: fetchImpl,
  });
  return { service, updates };
}

describe('connector.invoke', () => {
  test('an invalid rendered input never reaches the provider', async () => {
    let called = false;
    const { service } = serviceWith((async () => {
      called = true;
      return jsonResponse({});
    }) as unknown as typeof fetch);

    await expect(
      service.executePrepared(prepared(), { taskId: 123, comment: 'no' }, 1_000, null),
    ).rejects.toMatchObject({ code: 'ACTION_INPUT_INVALID' });
    expect(called).toBe(false);
  });

  test('a successful action returns the provider result', async () => {
    const { service } = serviceWith((async () =>
      jsonResponse({ id: 'comment-1', text: 'Done' })) as unknown as typeof fetch);

    const result = await service.executePrepared(prepared(), { taskId: 'task-1', comment: 'Done' }, 1_000, null);
    expect(result).toEqual({ id: 'comment-1', text: 'Done' });
  });

  test('the sanitized connector never exposes the credential', () => {
    const { service } = serviceWith(fetch);
    const view = service.sanitizeConnector({
      id: CONNECTOR_ID,
      provider: 'clickup',
      name: 'ClickUp',
      credentials: JSON.stringify({ token: TOKEN }),
      config: { listId: '1' },
      status: 'connected',
      lastValidatedAt: null,
      lastError: null,
      lastErrorCode: null,
      createdBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      tenantId: null,
    });
    expect(view.hasCredentials).toBe(true);
    expect(view).not.toHaveProperty('credentials');
    expect(JSON.stringify(view)).not.toContain(TOKEN);
  });

  test('a 401 provider error is redacted and revokes the connector', async () => {
    const { service, updates } = serviceWith((async () =>
      jsonResponse({ err: `bad token ${TOKEN}`, ECODE: 'OAUTH_001' }, 401)) as unknown as typeof fetch);

    const error = await service
      .executePrepared(prepared(), { taskId: 'task-1', comment: 'Done' }, 1_000, null)
      .catch((thrown: unknown) => thrown);

    expect(error).toMatchObject({ code: 'PROVIDER_REJECTED' });
    expect((error as Error).message).toContain('401');
    expect((error as Error).message).not.toContain(TOKEN);
    expect(updates.some((update) => update.status === 'revoked')).toBe(true);
  });
});
