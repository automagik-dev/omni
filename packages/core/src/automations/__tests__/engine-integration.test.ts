/**
 * Integration tests for automation engine with real WhatsApp payloads
 *
 * Tests the full flow: event → condition evaluation → action execution
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '../../events/bus';
import { generateId } from '../../ids';
import { type ActionDependencies, executeActions } from '../actions';
import { evaluateConditions } from '../conditions';
import { createTemplateContext } from '../templates';
import type { AutomationAction, AutomationCondition } from '../types';

// Import real fixtures using relative path
import fixtures from '../../../../channel-whatsapp/test/fixtures/real-payloads.json';

// Helper to safely get array element with type assertion
function getFixture<T>(arr: T[], index: number): T {
  const item = arr[index];
  if (item === undefined) {
    throw new Error(`Fixture at index ${index} not found`);
  }
  return item;
}

describe('Full automation flow with real WhatsApp payloads', () => {
  let mockSendMessage: ReturnType<typeof mock>;
  let mockEventBus: EventBus;
  let deps: ActionDependencies;

  beforeEach(() => {
    mockSendMessage = mock(async (_instanceId: string, _to: string, _content: string) => {});
    mockEventBus = {
      publish: mock(async () => ({ id: generateId(), timestamp: Date.now() })),
      publishGeneric: mock(async (type: string) => ({
        id: generateId(),
        type,
        timestamp: Date.now(),
        metadata: {},
        payload: {},
      })),
      subscribe: mock(async () => ({ unsubscribe: async () => {} })),
      subscribePattern: mock(async () => ({ unsubscribe: async () => {} })),
      flush: mock(async () => {}),
      close: mock(async () => {}),
    } as unknown as EventBus;

    deps = {
      eventBus: mockEventBus,
      sendMessage: mockSendMessage,
    };
  });

  afterEach(() => {
    mock.restore();
  });

  describe('Text message auto-reply flow', () => {
    test('processes incoming text message and triggers send_message action', async () => {
      const payload = getFixture(fixtures.messages.text, 0).payload;
      const instanceId = 'wa-test-123';

      // Simulate automation: when text message received from Alice, send reply
      const conditions: AutomationCondition[] = [
        { field: 'key.fromMe', operator: 'eq', value: false },
        { field: 'message.conversation', operator: 'exists' },
        { field: 'pushName', operator: 'eq', value: 'Alice Test' },
      ];

      const actions: AutomationAction[] = [
        {
          type: 'send_message',
          config: {
            instanceId: '{{instanceId}}',
            to: '{{payload.key.remoteJidAlt}}',
            contentTemplate: 'Thanks for your message: "{{payload.message.conversation}}"',
          },
        },
      ];

      // Step 1: Evaluate conditions
      const matched = evaluateConditions(conditions, payload);
      expect(matched).toBe(true);

      // Step 2: Create context and execute actions
      const context = createTemplateContext(payload, {
        variables: { instanceId },
      });

      const results = await executeActions(actions, context, deps);

      // Step 3: Verify action executed
      expect(results).toHaveLength(1);
      expect(getFixture(results, 0).status).toBe('success');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
      // Trailing `undefined` = trustedTenantId (G5): a direct `executeActions`
      // call with nothing threaded stays in the legacy world.
      expect(mockSendMessage).toHaveBeenCalledWith(
        instanceId,
        '5511999990001@s.whatsapp.net',
        'Thanks for your message: "Buenas como q tão as coisas aí"',
        undefined,
      );
    });
  });

  describe('Audio message handling flow', () => {
    test('detects voice note and triggers log action', async () => {
      const payload = getFixture(fixtures.messages.audio, 0).payload;

      // Automation: when voice note received, log it
      const conditions: AutomationCondition[] = [
        { field: 'message.audioMessage', operator: 'exists' },
        { field: 'message.audioMessage.ptt', operator: 'eq', value: true },
      ];

      const actions: AutomationAction[] = [
        {
          type: 'log',
          config: {
            level: 'info',
            message:
              'Voice note received from {{payload.pushName}}, duration: {{payload.message.audioMessage.seconds}}s',
          },
        },
      ];

      const matched = evaluateConditions(conditions, payload);
      expect(matched).toBe(true);

      const context = createTemplateContext(payload);
      const results = await executeActions(actions, context, deps);

      expect(results).toHaveLength(1);
      expect(getFixture(results, 0).status).toBe('success');
      expect(getFixture(results, 0).result).toEqual({
        level: 'info',
        message: 'Voice note received from Alice Test, duration: 9s',
      });
    });
  });

  describe('Presence-based automation flow', () => {
    test('detects composing presence and emits custom event', async () => {
      const presencePayload = getFixture(fixtures.events.presence, 0); // composing

      const conditions: AutomationCondition[] = [{ field: 'status', operator: 'eq', value: 'composing' }];

      const actions: AutomationAction[] = [
        {
          type: 'emit_event',
          config: {
            eventType: 'custom.user_typing',
            payloadTemplate: {
              userId: '{{payload.userId}}',
              chatId: '{{payload.chatId}}',
            },
          },
        },
      ];

      const matched = evaluateConditions(conditions, presencePayload as Record<string, unknown>);
      expect(matched).toBe(true);

      const context = createTemplateContext(presencePayload as Record<string, unknown>);
      const results = await executeActions(actions, context, deps);

      expect(results).toHaveLength(1);
      expect(getFixture(results, 0).status).toBe('success');
      expect(mockEventBus.publishGeneric).toHaveBeenCalledTimes(1);
    });
  });

  describe('Group event automation flow', () => {
    test('handles group participant add event', async () => {
      const addEvent = getFixture(fixtures.events.groupParticipantsUpdate, 0);

      const conditions: AutomationCondition[] = [
        { field: 'action', operator: 'eq', value: 'add' },
        { field: 'id', operator: 'contains', value: '@g.us' },
      ];

      const actions: AutomationAction[] = [
        {
          type: 'log',
          config: {
            level: 'info',
            message: 'New member added to group {{payload.id}}',
          },
        },
      ];

      const matched = evaluateConditions(conditions, addEvent as Record<string, unknown>);
      expect(matched).toBe(true);

      const context = createTemplateContext(addEvent as Record<string, unknown>);
      const results = await executeActions(actions, context, deps);

      expect(results).toHaveLength(1);
      expect(getFixture(results, 0).status).toBe('success');
      expect((getFixture(results, 0).result as { message: string }).message).toContain('@g.us');
    });
  });

  describe('Chained actions with variable passing', () => {
    test('webhook response is available to subsequent actions', async () => {
      const payload = getFixture(fixtures.messages.text, 0).payload;
      const instanceId = 'wa-test-123';

      // Mock fetch for webhook action
      const originalFetch = globalThis.fetch;
      globalThis.fetch = mock(async () => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ response: 'Hello from agent!' }),
      })) as unknown as typeof fetch;

      try {
        const actions: AutomationAction[] = [
          {
            type: 'webhook',
            config: {
              url: 'https://api.example.com/agent',
              method: 'POST',
              bodyTemplate: '{"message": "{{payload.message.conversation}}"}',
              waitForResponse: true,
              responseAs: 'agent',
            },
          },
          {
            type: 'send_message',
            config: {
              instanceId: '{{instanceId}}',
              to: '{{payload.key.remoteJidAlt}}',
              contentTemplate: '{{agent.response}}',
            },
          },
        ];

        const context = createTemplateContext(payload, {
          variables: { instanceId },
        });

        const results = await executeActions(actions, context, deps);

        expect(results).toHaveLength(2);
        expect(getFixture(results, 0).status).toBe('success');
        expect(getFixture(results, 1).status).toBe('success');

        // Verify the agent response was passed to send_message
        expect(mockSendMessage).toHaveBeenCalledWith(
          instanceId,
          '5511999990001@s.whatsapp.net',
          'Hello from agent!',
          undefined,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Call event automations', () => {
    test('detects missed call and sends notification', async () => {
      const callTerminate = getFixture(fixtures.events.call, 2); // terminate event

      const conditions: AutomationCondition[] = [
        { field: 'status', operator: 'eq', value: 'terminate' },
        { field: 'isVideo', operator: 'eq', value: true },
      ];

      const actions: AutomationAction[] = [
        {
          type: 'log',
          config: {
            level: 'info',
            message: 'Missed video call from {{payload.from}}',
          },
        },
      ];

      const matched = evaluateConditions(conditions, callTerminate as Record<string, unknown>);
      expect(matched).toBe(true);

      const context = createTemplateContext(callTerminate as Record<string, unknown>);
      const results = await executeActions(actions, context, deps);

      expect(results).toHaveLength(1);
      expect(getFixture(results, 0).status).toBe('success');
    });
  });

  describe('Complex real-world automation scenarios', () => {
    test('Poll interaction: detect when poll is created', async () => {
      const pollPayload = getFixture(fixtures.messages.poll, 0).payload;

      const conditions: AutomationCondition[] = [
        { field: 'message.pollCreationMessageV3', operator: 'exists' },
        { field: 'key.fromMe', operator: 'eq', value: false },
      ];

      const actions: AutomationAction[] = [
        {
          type: 'log',
          config: {
            level: 'info',
            message: 'Poll created: "{{payload.message.pollCreationMessageV3.name}}" by {{payload.pushName}}',
          },
        },
      ];

      const matched = evaluateConditions(conditions, pollPayload);
      expect(matched).toBe(true);

      const context = createTemplateContext(pollPayload);
      const results = await executeActions(actions, context, deps);

      expect(getFixture(results, 0).status).toBe('success');
      expect((getFixture(results, 0).result as { message: string }).message).toBe(
        'Poll created: "Quero saber" by Alice Test',
      );
    });

    test('Contact card sharing: detect and log contact shares', async () => {
      const contactPayload = getFixture(fixtures.messages.contact, 0).payload;

      const conditions: AutomationCondition[] = [
        { field: 'message.contactMessage', operator: 'exists' },
        { field: 'message.contactMessage.displayName', operator: 'exists' },
      ];

      const actions: AutomationAction[] = [
        {
          type: 'log',
          config: {
            level: 'info',
            message: 'Contact shared: {{payload.message.contactMessage.displayName}}',
          },
        },
      ];

      const matched = evaluateConditions(conditions, contactPayload);
      expect(matched).toBe(true);

      const context = createTemplateContext(contactPayload);
      const results = await executeActions(actions, context, deps);

      expect((getFixture(results, 0).result as { message: string }).message).toBe('Contact shared: Alice Test');
    });
  });

  describe('Error handling in automation flow', () => {
    test('continues to next action when one fails', async () => {
      const payload = getFixture(fixtures.messages.text, 0).payload;

      const actions: AutomationAction[] = [
        {
          type: 'send_message',
          config: {
            // Missing required fields - will fail
            instanceId: '',
            to: '',
            contentTemplate: 'test',
          },
        },
        {
          type: 'log',
          config: {
            level: 'info',
            message: 'This should still run',
          },
        },
      ];

      const context = createTemplateContext(payload);
      const results = await executeActions(actions, context, deps);

      // First action failed
      expect(getFixture(results, 0).status).toBe('failed');
      // Second action still ran
      expect(getFixture(results, 1).status).toBe('success');
    });
  });
});
