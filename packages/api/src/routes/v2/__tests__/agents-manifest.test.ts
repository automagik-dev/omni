/**
 * Agent event manifest routes (issue #985, RFC #925 G4a).
 *
 * Route-level contract with a mocked service: GET returns the stored manifest
 * (null when undeclared), PUT replaces it after AgentEventManifestSchema
 * validation at the boundary — bad event tokens and malformed shapes must be
 * refused with 400 before the service is touched.
 */

import { describe, expect, test } from 'bun:test';
import type { AgentEventManifest } from '@omni/core';
import { NotFoundError } from '@omni/core';
import { Hono } from 'hono';
import { errorHandler } from '../../../middleware/error';
import type { AppVariables } from '../../../types';
import { agentsRoutes } from '../agents';

const AGENT_ID = '11111111-1111-4111-8111-111111111111';
const MISSING_ID = '22222222-2222-4222-8222-222222222222';

const storedManifest: AgentEventManifest = {
  accepts: [{ event: 'custom.clickup.task.status_changed', filter: { list_id: '901300373349' } }],
  publishes: [{ event: 'custom.review.parecer.ready' }],
};

function agentRow(eventManifest: AgentEventManifest | null) {
  return {
    id: AGENT_ID,
    name: 'reviewer',
    provider: 'claude',
    agentType: 'assistant',
    capabilities: [],
    isInternal: false,
    isActive: true,
    eventManifest,
  };
}

function buildApp(options: { existing?: AgentEventManifest | null } = {}) {
  const updates: { id: string; manifest: AgentEventManifest }[] = [];
  const existing = options.existing ?? null;

  const services = {
    agents: {
      getById: async (id: string) => {
        if (id !== AGENT_ID) throw new NotFoundError('Agent', id);
        return agentRow(existing);
      },
      updateManifest: async (id: string, manifest: AgentEventManifest) => {
        if (id !== AGENT_ID) throw new NotFoundError('Agent', id);
        updates.push({ id, manifest });
        return agentRow(manifest);
      },
    },
  } as unknown as AppVariables['services'];

  const app = new Hono<{ Variables: AppVariables }>();
  app.onError(errorHandler);
  app.use('*', async (c, next) => {
    c.set('services', services);
    await next();
  });
  app.route('/api/v2/agents', agentsRoutes);
  return { app, updates };
}

describe('GET /agents/:id/manifest', () => {
  test('returns null for an agent that never declared a manifest', async () => {
    const { app } = buildApp();
    const res = await app.request(`/api/v2/agents/${AGENT_ID}/manifest`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: null });
  });

  test('returns the stored manifest', async () => {
    const { app } = buildApp({ existing: storedManifest });
    const res = await app.request(`/api/v2/agents/${AGENT_ID}/manifest`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { data: AgentEventManifest };
    expect(json.data).toEqual(storedManifest);
  });

  test('404s for a missing agent', async () => {
    const { app } = buildApp();
    const res = await app.request(`/api/v2/agents/${MISSING_ID}/manifest`);
    expect(res.status).toBe(404);
  });

  test('400s for a non-UUID id', async () => {
    const { app } = buildApp();
    const res = await app.request('/api/v2/agents/not-a-uuid/manifest');
    expect(res.status).toBe(400);
  });
});

describe('PUT /agents/:id/manifest', () => {
  test('replaces the manifest through the service and returns it', async () => {
    const { app, updates } = buildApp();
    const res = await app.request(`/api/v2/agents/${AGENT_ID}/manifest`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(storedManifest),
    });
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.manifest).toEqual(storedManifest);
    const json = (await res.json()) as { data: AgentEventManifest };
    expect(json.data).toEqual(storedManifest);
  });

  test('applies defaults: omitted sections become empty arrays', async () => {
    const { app, updates } = buildApp();
    const res = await app.request(`/api/v2/agents/${AGENT_ID}/manifest`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishes: [{ event: 'custom.review.parecer.ready' }] }),
    });
    expect(res.status).toBe(200);
    expect(updates[0]?.manifest).toEqual({ accepts: [], publishes: [{ event: 'custom.review.parecer.ready' }] });
  });

  test('refuses an event token outside every namespace (400, service untouched)', async () => {
    const { app, updates } = buildApp();
    const res = await app.request(`/api/v2/agents/${AGENT_ID}/manifest`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishes: [{ event: 'review.parecer.ready' }] }),
    });
    expect(res.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  test('refuses malformed shapes (unknown keys, string entries)', async () => {
    const { app, updates } = buildApp();

    const unknownKey = await app.request(`/api/v2/agents/${AGENT_ID}/manifest`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accepts: [{ event: 'message.received', filters: {} }] }),
    });
    expect(unknownKey.status).toBe(400);

    const stringEntry = await app.request(`/api/v2/agents/${AGENT_ID}/manifest`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishes: ['custom.review.parecer.ready'] }),
    });
    expect(stringEntry.status).toBe(400);
    expect(updates).toHaveLength(0);
  });

  test('404s for a missing agent with a valid body', async () => {
    const { app } = buildApp();
    const res = await app.request(`/api/v2/agents/${MISSING_ID}/manifest`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accepts: [], publishes: [] }),
    });
    expect(res.status).toBe(404);
  });
});
