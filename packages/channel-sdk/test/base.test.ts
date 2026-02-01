/**
 * Tests for BaseChannelPlugin and related base classes
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';
import type { ChannelType } from '@omni/core/types';
import {
  BaseChannelPlugin,
  ChannelRegistry,
  DEFAULT_CAPABILITIES,
  InstanceManager,
  aggregateHealthChecks,
  createHealthCheck,
} from '../src';
import type {
  ChannelCapabilities,
  HealthCheck,
  InstanceConfig,
  Logger,
  OutgoingMessage,
  PluginContext,
  PluginStorage,
  SendResult,
} from '../src';

// ─────────────────────────────────────────────────────────────
// Mock implementations
// ─────────────────────────────────────────────────────────────

class MockLogger implements Logger {
  logs: Array<{ level: string; message: string; data?: Record<string, unknown> }> = [];

  debug(message: string, data?: Record<string, unknown>) {
    this.logs.push({ level: 'debug', message, data });
  }
  info(message: string, data?: Record<string, unknown>) {
    this.logs.push({ level: 'info', message, data });
  }
  warn(message: string, data?: Record<string, unknown>) {
    this.logs.push({ level: 'warn', message, data });
  }
  error(message: string, data?: Record<string, unknown>) {
    this.logs.push({ level: 'error', message, data });
  }
  child(_context: Record<string, unknown>): Logger {
    return this;
  }
}

class MockStorage implements PluginStorage {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
  async has(key: string): Promise<boolean> {
    return this.data.has(key);
  }
  async keys(): Promise<string[]> {
    return Array.from(this.data.keys());
  }
}

class MockEventBus implements EventBus {
  published: Array<{ type: string; payload: unknown; metadata?: unknown }> = [];

  async connect(): Promise<void> {}

  async publish(type: string, payload: unknown, metadata?: unknown): Promise<PublishResult> {
    this.published.push({ type, payload, metadata });
    return { id: 'test-id', sequence: 1, stream: 'test-stream' };
  }

  async publishGeneric(type: string, payload: unknown, metadata?: unknown): Promise<PublishResult> {
    return this.publish(type, payload, metadata);
  }

  async subscribe(): Promise<Subscription> {
    return { id: 'sub-1', pattern: '*', unsubscribe: async () => {} };
  }

  async subscribePattern(): Promise<Subscription> {
    return { id: 'sub-2', pattern: '*', unsubscribe: async () => {} };
  }

  async subscribeMany(): Promise<Subscription> {
    return { id: 'sub-3', pattern: '*', unsubscribe: async () => {} };
  }

  async subscribeAll(): Promise<Subscription> {
    return { id: 'sub-4', pattern: '*', unsubscribe: async () => {} };
  }

  async close(): Promise<void> {}

  isConnected(): boolean {
    return true;
  }
}

// ─────────────────────────────────────────────────────────────
// Test implementation of BaseChannelPlugin
// ─────────────────────────────────────────────────────────────

class TestChannelPlugin extends BaseChannelPlugin {
  readonly id = 'whatsapp-baileys' as ChannelType;
  readonly name = 'Test WhatsApp';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = {
    ...DEFAULT_CAPABILITIES,
    canSendMedia: true,
  };

  connectCalled = false;
  disconnectCalled = false;

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    this.connectCalled = true;
    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
    });
    await this.emitInstanceConnected(instanceId, { profileName: 'Test Bot' });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.disconnectCalled = true;
    await this.emitInstanceDisconnected(instanceId, 'Test disconnect');
  }

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    await this.emitMessageSent({
      instanceId,
      externalId: 'msg-123',
      chatId: message.to,
      to: message.to,
      content: { type: message.content.type, text: message.content.text },
    });
    return { success: true, messageId: 'msg-123', timestamp: Date.now() };
  }
}

// ─────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────

describe('BaseChannelPlugin', () => {
  let plugin: TestChannelPlugin;
  let context: PluginContext;
  let eventBus: MockEventBus;
  let logger: MockLogger;

  beforeEach(() => {
    plugin = new TestChannelPlugin();
    eventBus = new MockEventBus();
    logger = new MockLogger();

    context = {
      eventBus,
      storage: new MockStorage(),
      logger,
      config: {
        env: 'development',
        apiBaseUrl: 'http://localhost:3000',
        webhookBaseUrl: 'http://localhost:3000/webhooks',
        mediaStorage: { type: 'local', basePath: '/tmp/media' },
      },
      db: { execute: async () => [], getDrizzle: () => null },
    };
  });

  it('should initialize with context', async () => {
    await plugin.initialize(context);

    // Initialization should complete without error
    // Logs are now handled at the loader level, not base plugin
    expect(plugin.connectCalled).toBe(false); // Not connected yet
  });

  it('should connect an instance and emit events', async () => {
    await plugin.initialize(context);
    await plugin.connect('wa-001', { instanceId: 'wa-001', credentials: {} });

    expect(plugin.connectCalled).toBe(true);
    expect(eventBus.published.length).toBe(1);
    expect(eventBus.published[0]?.type).toBe('instance.connected');
  });

  it('should send messages and emit events', async () => {
    await plugin.initialize(context);
    await plugin.connect('wa-001', { instanceId: 'wa-001', credentials: {} });

    const result = await plugin.sendMessage('wa-001', {
      to: 'user-123',
      content: { type: 'text', text: 'Hello!' },
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-123');
    expect(eventBus.published.some((p) => p.type === 'message.sent')).toBe(true);
  });

  it('should track connected instances', async () => {
    await plugin.initialize(context);
    await plugin.connect('wa-001', { instanceId: 'wa-001', credentials: {} });
    await plugin.connect('wa-002', { instanceId: 'wa-002', credentials: {} });

    const connected = plugin.getConnectedInstances();
    expect(connected.length).toBe(2);
    expect(connected).toContain('wa-001');
    expect(connected).toContain('wa-002');
  });

  it('should return health status', async () => {
    await plugin.initialize(context);
    await plugin.connect('wa-001', { instanceId: 'wa-001', credentials: {} });

    const health = await plugin.getHealth();
    expect(health.status).toBe('healthy');
    expect(health.checks.length).toBeGreaterThan(0);
  });

  it('should destroy and disconnect all instances', async () => {
    await plugin.initialize(context);
    await plugin.connect('wa-001', { instanceId: 'wa-001', credentials: {} });

    await plugin.destroy();

    expect(plugin.disconnectCalled).toBe(true);
    expect(plugin.getConnectedInstances().length).toBe(0);
  });
});

describe('InstanceManager', () => {
  let manager: InstanceManager;

  beforeEach(() => {
    manager = new InstanceManager();
  });

  it('should set and get instances', () => {
    const config: InstanceConfig = { instanceId: 'test-1', credentials: {} };
    const status = { state: 'connected' as const, since: new Date() };

    manager.setInstance('test-1', config, status);

    expect(manager.has('test-1')).toBe(true);
    expect(manager.get('test-1')?.status.state).toBe('connected');
  });

  it('should track connected instances', () => {
    manager.setInstance('test-1', { instanceId: 'test-1', credentials: {} }, { state: 'connected', since: new Date() });
    manager.setInstance(
      'test-2',
      { instanceId: 'test-2', credentials: {} },
      { state: 'disconnected', since: new Date() },
    );
    manager.setInstance('test-3', { instanceId: 'test-3', credentials: {} }, { state: 'connected', since: new Date() });

    expect(manager.count()).toBe(3);
    expect(manager.connectedCount()).toBe(2);
    expect(manager.getConnectedIds()).toContain('test-1');
    expect(manager.getConnectedIds()).toContain('test-3');
  });

  it('should remove instances', () => {
    manager.setInstance('test-1', { instanceId: 'test-1', credentials: {} }, { state: 'connected', since: new Date() });
    expect(manager.has('test-1')).toBe(true);

    manager.remove('test-1');
    expect(manager.has('test-1')).toBe(false);
  });
});

describe('ChannelRegistry', () => {
  let registry: ChannelRegistry;
  let plugin: TestChannelPlugin;

  beforeEach(() => {
    registry = new ChannelRegistry();
    plugin = new TestChannelPlugin();
  });

  it('should register plugins', () => {
    registry.register(plugin);

    expect(registry.has('whatsapp-baileys')).toBe(true);
    expect(registry.get('whatsapp-baileys')).toBe(plugin);
  });

  it('should list all plugins', () => {
    registry.register(plugin);

    expect(registry.getAll().length).toBe(1);
    expect(registry.getIds()).toContain('whatsapp-baileys');
  });

  it('should unregister plugins', async () => {
    registry.register(plugin);
    await registry.unregister('whatsapp-baileys');

    expect(registry.has('whatsapp-baileys')).toBe(false);
  });
});

describe('Health utilities', () => {
  it('should aggregate health checks correctly', () => {
    const allPass: HealthCheck[] = [createHealthCheck('check1', 'pass'), createHealthCheck('check2', 'pass')];
    expect(aggregateHealthChecks(allPass)).toBe('healthy');

    const hasWarn: HealthCheck[] = [createHealthCheck('check1', 'pass'), createHealthCheck('check2', 'warn')];
    expect(aggregateHealthChecks(hasWarn)).toBe('degraded');

    const hasFail: HealthCheck[] = [createHealthCheck('check1', 'pass'), createHealthCheck('check2', 'fail')];
    expect(aggregateHealthChecks(hasFail)).toBe('unhealthy');
  });

  it('should create health check objects', () => {
    const check = createHealthCheck('mycheck', 'pass', 'All good', { count: 5 });

    expect(check.name).toBe('mycheck');
    expect(check.status).toBe('pass');
    expect(check.message).toBe('All good');
    expect(check.data).toEqual({ count: 5 });
  });
});
