/**
 * Automations Service Tests
 *
 * Tests for the AutomationService, particularly the execute() method.
 *
 * The execute endpoint allows manual triggering of automations:
 * - POST /automations/{id}/execute
 * - Takes an event payload and actually runs the automation actions
 * - Unlike test(), this is NOT a dry run - actions are executed
 *
 * Use cases:
 * - Testing automation configurations with real events
 * - Debugging automation behavior
 * - Manual triggering for one-off tasks
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Automation, Database } from '@omni/db';
import { AutomationService } from '../automations';

// Helper to create a mock automation
function createMockAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'test-automation-123',
    name: 'Test Automation',
    description: 'Test automation for unit tests',
    triggerEventType: 'message.received',
    triggerConditions: null,
    conditionLogic: null,
    actions: [
      {
        type: 'log',
        config: {
          level: 'info',
          message: 'Test log: {{payload.text}}',
        },
      },
    ],
    debounce: null,
    enabled: true,
    priority: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// Create minimal mock database for testing
function createMockDatabase(automation: Automation | null = null) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => ({
          limit: mock(() => Promise.resolve(automation ? [automation] : [])),
        })),
      })),
    })),
    insert: mock(() => ({
      values: mock(() => ({
        returning: mock(() => Promise.resolve([{ id: 'log-123' }])),
      })),
    })),
  } as unknown as Database;
}

// Create mock event bus
function createMockEventBus() {
  return {
    publish: mock(async () => ({ id: 'evt-123', timestamp: Date.now() })),
    publishGeneric: mock(async () => ({
      id: 'evt-123',
      type: 'test',
      timestamp: Date.now(),
      metadata: {},
      payload: {},
    })),
    subscribe: mock(async () => ({ unsubscribe: async () => {} })),
    subscribePattern: mock(async () => ({ unsubscribe: async () => {} })),
    flush: mock(async () => {}),
    close: mock(async () => {}),
  } as unknown as EventBus;
}

describe('AutomationService', () => {
  describe('execute()', () => {
    let service: AutomationService;
    let mockDb: Database;
    let mockEventBus: EventBus;

    beforeEach(() => {
      mockEventBus = createMockEventBus();
    });

    test('returns triggered=false when event type does not match', async () => {
      const automation = createMockAutomation({
        triggerEventType: 'message.received',
      });
      mockDb = createMockDatabase(automation);
      service = new AutomationService(mockDb, mockEventBus);

      const result = await service.execute('test-automation-123', {
        type: 'message.sent', // Different event type
        payload: { text: 'Hello' },
      });

      expect(result.triggered).toBe(false);
      expect(result.results).toHaveLength(0);
      expect(result.automationId).toBe('test-automation-123');
    });

    test('executes actions when event type matches', async () => {
      const automation = createMockAutomation({
        triggerEventType: 'message.received',
        actions: [
          {
            type: 'log',
            config: {
              level: 'info',
              message: 'Received: {{payload.text}}',
            },
          },
        ],
      });
      mockDb = createMockDatabase(automation);
      service = new AutomationService(mockDb, mockEventBus);

      const result = await service.execute('test-automation-123', {
        type: 'message.received',
        payload: { text: 'Hello World' },
      });

      expect(result.triggered).toBe(true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.status).toBe('success');
      expect(result.results[0]?.action).toBe('log');
    });

    test('executes multiple actions in sequence', async () => {
      const automation = createMockAutomation({
        triggerEventType: 'custom.event',
        actions: [
          {
            type: 'log',
            config: { level: 'info', message: 'Step 1' },
          },
          {
            type: 'log',
            config: { level: 'info', message: 'Step 2' },
          },
          {
            type: 'log',
            config: { level: 'info', message: 'Step 3' },
          },
        ],
      });
      mockDb = createMockDatabase(automation);
      service = new AutomationService(mockDb, mockEventBus);

      const result = await service.execute('test-automation-123', {
        type: 'custom.event',
        payload: {},
      });

      expect(result.triggered).toBe(true);
      expect(result.results).toHaveLength(3);
      expect(result.results.every((r) => r.status === 'success')).toBe(true);
    });

    test('logs execution to database', async () => {
      const automation = createMockAutomation();
      mockDb = createMockDatabase(automation);
      service = new AutomationService(mockDb, mockEventBus);

      await service.execute('test-automation-123', {
        type: 'message.received',
        payload: { text: 'Test' },
      });

      // Verify insert was called for logging
      expect(mockDb.insert).toHaveBeenCalled();
    });

    test('emit_event action publishes to event bus', async () => {
      const automation = createMockAutomation({
        triggerEventType: 'webhook.received',
        actions: [
          {
            type: 'emit_event',
            config: {
              eventType: 'custom.processed',
              payloadTemplate: { source: 'automation' },
            },
          },
        ],
      });
      mockDb = createMockDatabase(automation);
      service = new AutomationService(mockDb, mockEventBus);

      const result = await service.execute('test-automation-123', {
        type: 'webhook.received',
        payload: { data: 'test' },
      });

      expect(result.triggered).toBe(true);
      expect(result.results[0]?.status).toBe('success');
      expect(mockEventBus.publishGeneric).toHaveBeenCalled();
    });

    test('handles template substitution in actions', async () => {
      const automation = createMockAutomation({
        triggerEventType: 'message.received',
        actions: [
          {
            type: 'log',
            config: {
              level: 'info',
              message: 'From {{payload.sender.name}}: {{payload.text}}',
            },
          },
        ],
      });
      mockDb = createMockDatabase(automation);
      service = new AutomationService(mockDb, mockEventBus);

      const result = await service.execute('test-automation-123', {
        type: 'message.received',
        payload: {
          sender: { name: 'Alice' },
          text: 'Hello!',
        },
      });

      expect(result.triggered).toBe(true);
      expect(result.results[0]?.status).toBe('success');
    });
  });
});
