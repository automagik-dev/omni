import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { createOmniClient } from '../client';
import { subscriptionBodies } from './connector-contracts';

describe('connector SDK contracts', () => {
  test('both ingress branches retain their exact bodies and nullable-target views', async () => {
    const client = createOmniClient({ baseUrl: 'https://omni.test.invalid', apiKey: 'mock-only' });
    const requests: unknown[] = [];
    client.raw.use({
      async onRequest({ request }) {
        expect(request.headers.get('x-api-key')).toBe('mock-only');
        const body = await request.json();
        requests.push(body);
        const input = z
          .object({
            ingress: z.enum(['connector', 'subscription']).optional(),
            eventKey: z.string(),
            targetAutomationId: z.string().optional(),
          })
          .parse(body);
        return Response.json({
          data: {
            ingress: input.ingress ?? 'subscription',
            targetAutomationId: input.targetAutomationId ?? null,
            providerEventKey: input.eventKey,
          },
        });
      },
    });
    for (const body of subscriptionBodies) {
      const result = await client.connectors.subscriptions.add('connector-id', body);
      expect(requests.at(-1)).toEqual(body);
      expect(result.ingress).toBe(body.ingress ?? 'subscription');
      expect(result.targetAutomationId).toBe(body.targetAutomationId ?? null);
    }
  });

  test('create and PATCH transmit write-only hook secrets and return counter views', async () => {
    const client = createOmniClient({ baseUrl: 'https://omni.test.invalid', apiKey: 'mock-only' });
    const secrets = ['hook-secret-created', 'hook-secret-rotated'];
    const requests: unknown[] = [];
    client.raw.use({
      async onRequest({ request }) {
        requests.push(await request.json());
        return Response.json({
          data: {
            id: 'connector-id',
            hasHookSecret: true,
            totalUnmatched: 2,
            lastUnmatchedAt: '2026-11-01T00:00:00.000Z',
            lastUnmatchedEventType: 'connector.gitlab.push',
          },
        });
      },
    });
    const created = await client.connectors.create({
      provider: 'gitlab',
      name: 'GitLab',
      credentials: {},
      hookSecret: secrets[0],
    });
    const updated = await client.connectors.update(created.id, { hookSecret: secrets[1] });
    expect(requests).toEqual([
      { provider: 'gitlab', name: 'GitLab', credentials: {}, hookSecret: secrets[0] },
      { hookSecret: secrets[1] },
    ]);
    for (const view of [created, updated]) {
      expect(view.hasHookSecret).toBe(true);
      expect(view.totalUnmatched).toBe(2);
      expect(view.lastUnmatchedEventType).toBe('connector.gitlab.push');
      expect(view).not.toHaveProperty('hookSecret');
    }
  });
});
