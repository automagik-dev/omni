/**
 * Tests for Bolt.js HTTP mode connection
 *
 * Group 2: HTTP Mode Connection
 *
 * Uses bun:test mock.module to replace @slack/bolt so that creating
 * App instances does NOT trigger real auth.test() calls, which would
 * produce unhandled rejections from fake tokens.
 */

import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

// Mock @slack/bolt before importing the pooled receiver.
// The real App constructor lazily calls auth.test() with our fake token,
// causing unhandled rejections that poison other test files.
mock.module('@slack/bolt', () => {
  class MockApp {
    client: { auth: { test: () => Promise<unknown> } };
    constructor(_opts: Record<string, unknown>) {
      this.client = {
        auth: { test: () => Promise.resolve({ ok: true, user_id: 'U_MOCK', bot_id: 'B_MOCK' }) },
      };
    }
    error(_handler: (err: Error) => Promise<void>) {
      // no-op
    }
    // The pooled receiver registers a no-op listener per revocation event.
    event(_name: string, _listener: unknown) {
      // no-op
    }
  }

  // HTTPReceiver mock that provides a requestListener
  class MockHTTPReceiver {
    requestListener: (req: IncomingMessage, res: import('node:http').ServerResponse) => void;
    constructor(_opts: Record<string, unknown>) {
      this.requestListener = (_req, res) => {
        res.writeHead(200);
        res.end('ok');
      };
    }
  }

  // The pooled receiver exposes its SocketModeClient for lifecycle tracking (#941).
  class MockSocketModeReceiver {
    client = Object.assign(new EventEmitter(), {
      websocket: { isActive: () => true },
    });
  }

  return {
    App: MockApp,
    HTTPReceiver: MockHTTPReceiver,
    SocketModeReceiver: MockSocketModeReceiver,
  };
});

// Import AFTER mock.module so the mocks are active
const { SlackAppReceiver } = await import('../connection/app-receiver');

// ─────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────

const noop = () => {};
const noopLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop,
};

function makeMockReq(
  overrides: Partial<{
    headers: Record<string, string>;
    method: string;
    url: string;
  }> = {},
): IncomingMessage {
  const emitter = new EventEmitter() as IncomingMessage;
  emitter.headers = overrides.headers ?? {};
  emitter.method = overrides.method ?? 'POST';
  emitter.url = overrides.url ?? '/slack/events';
  (emitter as unknown as Record<string, unknown>).destroy = () => {};
  return emitter;
}

// ─────────────────────────────────────────────────────────────
// Shared receiver — HTTP body-limit guard
// ─────────────────────────────────────────────────────────────

describe('SlackAppReceiver — HTTP mode body-limit guard', () => {
  function makeHttpReceiver() {
    return new SlackAppReceiver(
      { botToken: 'xoxb-fake', mode: 'http', signingSecret: 'test-secret' },
      () => {},
      noopLogger as never,
    );
  }

  it('exposes an httpHandler in HTTP mode', () => {
    expect(typeof makeHttpReceiver().httpHandler).toBe('function');
  });

  it('rejects requests with Content-Length > 1 MB', () => {
    const receiver = makeHttpReceiver();
    const req = makeMockReq({ headers: { 'content-length': String(1024 * 1024 + 1) } });
    const state = { statusCode: 0, body: '' };
    const res = {
      writeHead: (code: number) => {
        state.statusCode = code;
      },
      end: (data: string) => {
        state.body = data;
      },
    } as unknown as ServerResponse;

    receiver.httpHandler?.(req, res);

    expect(state.statusCode).toBe(413);
    expect(state.body).toContain('Too Large');
  });

  it('does not reject requests with Content-Length exactly 1 MB', () => {
    const receiver = makeHttpReceiver();
    const req = makeMockReq({ headers: { 'content-length': String(1024 * 1024) } });
    let rejected = false;
    const res = {
      writeHead: (code: number) => {
        if (code === 413) rejected = true;
      },
      end: noop,
    } as unknown as ServerResponse;

    receiver.httpHandler?.(req, res);

    expect(rejected).toBe(false);
  });

  it('has no httpHandler in Socket Mode — there is no request to guard', () => {
    const receiver = new SlackAppReceiver(
      { botToken: 'xoxb-fake', appToken: 'xapp-fake', mode: 'socket' },
      () => {},
      noopLogger as never,
    );
    expect(receiver.httpHandler).toBeUndefined();
  });
});
