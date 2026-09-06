/**
 * Shared test doubles for the ASC Flow suite — mirrors the
 * MockEventBus/MockLogger/MockStorage pattern from channel-hermes.
 *
 * `fetch` is always stubbed. No test in this package may reach the real ASC
 * platform: a stray call there sends a WhatsApp message to a real handset.
 */

// No test may sit on the inbound hold: without this every webhook test blocks
// for the full 120s deadline. Read per call by the handler, so setting it here
// holds regardless of which module imported first.
process.env.ASC_FLOW_HOLD_MS ??= '0';

import type { Logger, PluginContext, PluginStorage } from '@omni/channel-sdk';
import type { EventBus, PublishResult, Subscription } from '@omni/core/events';

import type { AscFlowPlugin } from '../plugin';

export const instanceId = '00000000-0000-4000-8000-000000000004';
export const BASE_URL = 'https://asc.test';
export const LOGIN = 'test-login';
export const CHAVE = 'test-chave';
export const HANDOFF_SERVICO = 130;

export class MockLogger implements Logger {
  debug() {}
  info() {}
  warn() {}
  error() {}
  child(): Logger {
    return this;
  }
}

class MockStorage implements PluginStorage {
  private readonly data = new Map<string, unknown>();

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

export class MockEventBus implements EventBus {
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

export function createContext(eventBus: MockEventBus): PluginContext {
  return {
    eventBus,
    storage: new MockStorage(),
    logger: new MockLogger(),
    config: {
      env: 'development',
      apiBaseUrl: 'http://localhost:3000',
      webhookBaseUrl: 'http://localhost:3000/webhooks',
      mediaStorage: { type: 'local', basePath: '/tmp/media' },
    },
    db: { execute: async () => [], getDrizzle: () => null },
  };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** A platform "everything is fine" body. HTTP 200 alone is not success. */
export const OK_BODY = { cod_error: 0, sucesso: 1, msg: 'Retorno realizado' };

export interface RecordedCall {
  /** Endpoint path, e.g. `/mensagem`. */
  path: string;
  body: Record<string, unknown>;
  authorization: string | null;
}

/**
 * Install a `fetch` double that records every platform call and answers with
 * `OK_BODY`, except where `overrides` says otherwise (keyed by path).
 */
export function stubPlatform(overrides: Record<string, () => Response> = {}): {
  calls: RecordedCall[];
  restore: () => void;
} {
  const calls: RecordedCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace('/rest/v2', '');
    calls.push({
      path,
      body: JSON.parse(String(init?.body ?? '{}')),
      authorization: new Headers(init?.headers).get('authorization'),
    });
    const override = overrides[path];
    if (override) return override();
    if (path === '/authuser') {
      return jsonResponse({ success: true, result: { token: 'jwt-token', expiry: '1h' } });
    }
    return jsonResponse(OK_BODY);
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

/** The `chatInput` `openTurn` opens the in-flight window with. */
export const TURN_TEXT = 'oi';

/**
 * Put a turn in flight for `cod`, the way the flow's `api_rest` node does.
 *
 * Outbound is only deliverable while a poll is waiting: a text turn rides back
 * in the poll body, so `sendMessage` refuses when nothing is polling. Every
 * outbound test therefore opens the window first, exactly as production does.
 */
export async function openTurn(plugin: AscFlowPlugin, cod = '42', text = TURN_TEXT): Promise<void> {
  await plugin.handleWebhook(
    new Request(`http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codAtendimento: cod, chatInput: text }),
    }),
  );
}

/** Connect the plugin against the stubbed platform. */
export async function connectPlugin(
  plugin: AscFlowPlugin,
  extraCredentials: Record<string, unknown> = {},
): Promise<void> {
  await plugin.connect(instanceId, {
    instanceId,
    credentials: {
      ascFlowBaseUrl: BASE_URL,
      ascFlowLogin: LOGIN,
      ascFlowChave: CHAVE,
      ascFlowHandoffServico: HANDOFF_SERVICO,
      ...extraCredentials,
    },
  });
}
