/**
 * Legacy-alias regression tests for the whatsapp-cloud → whatsapp-business
 * channel rename.
 *
 * The old URLs are external contracts: the webhook path lives in customer
 * Meta App dashboards and the flows/data path inside Meta-side flow
 * `endpoint_uri` registrations. These tests pin that every legacy path stays
 * registered and lands on the SAME behavior as the canonical path — if
 * someone "cleans up" the aliases, this file goes red.
 */

import { describe, expect, test } from 'bun:test';
import type { ChannelRegistry } from '@omni/channel-sdk';
import type { Database } from '@omni/db';
import { createApp } from '../app';

const CHALLENGE = 'challenge-12345';

function buildAppWithStubPlugin() {
  const seen: string[] = [];
  const stubPlugin = {
    id: 'whatsapp-business',
    handleWebhook: async (request: Request) => {
      seen.push(new URL(request.url).pathname);
      const url = new URL(request.url);
      return new Response(url.searchParams.get('hub.challenge') ?? 'ok', { status: 200 });
    },
  };
  const registry = {
    get: (id: string) => (id === 'whatsapp-business' ? stubPlugin : undefined),
    getAll: () => [stubPlugin],
  } as unknown as ChannelRegistry;

  // Handlers under test never touch the DB before our assertions; auth paths
  // reject earlier. A throwing stub guarantees that stays true.
  const db = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error('db must not be touched by alias routing tests');
      },
    },
  ) as unknown as Database;

  const { app } = createApp(db, null, registry);
  return { app, seen };
}

describe('whatsapp-business legacy aliases', () => {
  test('webhook verification works on BOTH canonical and legacy paths', async () => {
    const { app } = buildAppWithStubPlugin();
    for (const channelSegment of ['whatsapp-business', 'whatsapp-cloud']) {
      const res = await app.request(
        `/api/v2/channels/${channelSegment}/webhook?hub.mode=subscribe&hub.challenge=${CHALLENGE}`,
      );
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(CHALLENGE);
    }
  });

  test('webhook POST delivery reaches the plugin on both paths', async () => {
    const { app, seen } = buildAppWithStubPlugin();
    for (const channelSegment of ['whatsapp-business', 'whatsapp-cloud']) {
      const res = await app.request(`/api/v2/channels/${channelSegment}/webhook`, {
        method: 'POST',
        body: JSON.stringify({ entry: [] }),
      });
      expect(res.status).toBe(200);
    }
    expect(seen).toHaveLength(2);
  });

  test('legacy per-instance REST prefix re-dispatches into the authed canonical route (401, not 404)', async () => {
    const { app } = buildAppWithStubPlugin();
    // No credentials: reaching the canonical protected route means 401 from
    // auth. A 404 here would mean the alias catch-all is gone.
    const res = await app.request('/api/v2/instances/11111111-1111-4111-8111-111111111111/whatsapp-cloud/connection');
    expect(res.status).toBe(401);
  });

  test('legacy flows/data path is registered (unknown instance → 404 JSON, not a bare router 404)', async () => {
    const { app } = buildAppWithStubPlugin();
    const registryMiss = await app.request('/api/v2/channels/whatsapp-cloud/flows/data/some-instance', {
      method: 'POST',
      body: '{}',
    });
    // Stub plugin has no handleFlowData → the route's own PLUGIN_NOT_FOUND
    // envelope proves the legacy path resolves to the flows/data handler.
    expect(registryMiss.status).toBe(503);
    const body = (await registryMiss.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PLUGIN_NOT_FOUND');
  });
});
