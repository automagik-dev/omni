/** `omni events sample` and `omni automations scaffold` over a mocked client (#1182). */

import { describe, expect, test } from 'bun:test';
import type { OmniClient } from '@omni/sdk';
import { buildScaffold } from '../automations-scaffold';
import { fetchSamplePayload, sampleLines } from '../events-sample';

const rawPayload = {
  pushName: 'Cezar',
  isMentioningInstance: false,
  instanceId: 'i1',
  rawChatId: '120363@g.us',
  key: { fromMe: false },
  message: { conversation: 'x'.repeat(100) },
};

function mockClient(items: unknown[]) {
  const calls: unknown[] = [];
  const client = {
    events: {
      list: async (q: unknown) => {
        calls.push(q);
        return { items, meta: {} };
      },
    },
  } as unknown as OmniClient;
  return { client, calls };
}

describe('events sample', () => {
  test('fetches one event of the type and flattens its payload', async () => {
    const { client, calls } = mockClient([{ id: 'e1', rawPayload }]);
    const lines = sampleLines(await fetchSamplePayload(client, 'message.received'));
    expect(calls).toEqual([{ eventType: 'message.received', limit: 1 }]);
    expect(lines['payload.rawChatId']).toBe('120363@g.us');
    expect(lines['payload.key.fromMe']).toBe(false);
    expect(lines['payload.message.conversation']).toBe(`${'x'.repeat(80)}…`);
  });

  test('errors when no event exists', async () => {
    const { client } = mockClient([]);
    await expect(fetchSamplePayload(client, 'nope')).rejects.toThrow('No journaled event');
  });
});

describe('automations scaffold', () => {
  test('conditions on the chat identifier and templates two real paths', async () => {
    const { client } = mockClient([{ rawPayload }]);
    const def = buildScaffold('message.received', await fetchSamplePayload(client, 'message.received'));
    expect(def).toEqual({
      triggerEventType: 'message.received',
      conditions: [{ field: 'rawChatId', operator: 'eq', value: '120363@g.us' }],
      actions: [
        {
          type: 'emit_event',
          config: {
            eventType: 'custom.message.received',
            payloadTemplate: {
              pushName: '{{payload.pushName}}',
              isMentioningInstance: '{{payload.isMentioningInstance}}',
            },
          },
        },
      ],
    });
  });

  test('--action sets the stub type', () => {
    expect(buildScaffold('x', { a: 1 }, 'log').actions[0]).toEqual({
      type: 'log',
      config: { payloadTemplate: { a: '{{payload.a}}' } },
    });
  });
});
