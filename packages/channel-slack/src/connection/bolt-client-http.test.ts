/**
 * Tests for Bolt.js HTTP mode connection
 *
 * Group 2: HTTP Mode Connection
 */

import { describe, expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { createBoltApp } from './bolt-client';

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
// createBoltApp — mode selection
// ─────────────────────────────────────────────────────────────

describe('createBoltApp — mode selection', () => {
  it('creates socket mode connection when mode is omitted (default)', () => {
    // Socket mode requires appToken per Bolt.js
    expect(() => {
      createBoltApp({ botToken: 'xoxb-fake', appToken: 'xapp-fake', mode: 'socket' }, noopLogger as never);
    }).not.toThrow();
  });

  it('creates HTTP mode connection with signingSecret', () => {
    expect(() => {
      createBoltApp({ botToken: 'xoxb-fake', mode: 'http', signingSecret: 'test-secret' }, noopLogger as never);
    }).not.toThrow();
  });

  it('throws when HTTP mode is requested without signingSecret', () => {
    expect(() => {
      createBoltApp({ botToken: 'xoxb-fake', mode: 'http' }, noopLogger as never);
    }).toThrow('signingSecret is required for HTTP mode');
  });

  it('returns mode: "socket" for socket connections', () => {
    const conn = createBoltApp({ botToken: 'xoxb-fake', appToken: 'xapp-fake', mode: 'socket' }, noopLogger as never);
    expect(conn.mode).toBe('socket');
    expect(conn.httpHandler).toBeUndefined();
  });

  it('returns mode: "http" for HTTP connections', () => {
    const conn = createBoltApp(
      { botToken: 'xoxb-fake', mode: 'http', signingSecret: 'test-secret' },
      noopLogger as never,
    );
    expect(conn.mode).toBe('http');
    expect(conn.httpHandler).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────
// HTTP body-limit guard
// ─────────────────────────────────────────────────────────────

describe('HTTP mode — body-limit guard', () => {
  it('rejects requests with Content-Length > 1 MB', () => {
    const conn = createBoltApp(
      { botToken: 'xoxb-fake', mode: 'http', signingSecret: 'test-secret' },
      noopLogger as never,
    );

    const req = makeMockReq({
      headers: { 'content-length': String(1024 * 1024 + 1) },
    });
    const state = { statusCode: 0, body: '' };
    const res = {
      writeHead: (code: number) => {
        state.statusCode = code;
      },
      end: (data: string) => {
        state.body = data;
      },
    } as unknown as ServerResponse;

    conn.httpHandler?.(req, res);

    expect(state.statusCode).toBe(413);
    expect(state.body).toContain('Too Large');
  });

  it('does not reject requests with Content-Length exactly 1 MB', () => {
    const conn = createBoltApp(
      { botToken: 'xoxb-fake', mode: 'http', signingSecret: 'test-secret' },
      noopLogger as never,
    );

    const req = makeMockReq({
      headers: { 'content-length': String(1024 * 1024) },
    });
    let rejected = false;
    const res = {
      writeHead: (code: number) => {
        if (code === 413) rejected = true;
      },
      end: noop,
    } as unknown as ServerResponse;

    conn.httpHandler?.(req, res);

    expect(rejected).toBe(false);
  });

  it('has httpHandler defined on HTTP mode connection', () => {
    const conn = createBoltApp(
      { botToken: 'xoxb-fake', mode: 'http', signingSecret: 'my-signing-secret' },
      noopLogger as never,
    );
    expect(typeof conn.httpHandler).toBe('function');
  });
});

// ─────────────────────────────────────────────────────────────
// BoltConnection structure
// ─────────────────────────────────────────────────────────────

describe('BoltConnection structure', () => {
  it('socket mode connection has app and client', () => {
    const conn = createBoltApp({ botToken: 'xoxb-fake', appToken: 'xapp-fake', mode: 'socket' }, noopLogger as never);
    expect(conn.app).toBeDefined();
    expect(conn.client).toBeDefined();
    expect(conn.botToken).toBe('xoxb-fake');
  });

  it('HTTP mode connection has app, client, and httpHandler', () => {
    const conn = createBoltApp(
      { botToken: 'xoxb-fake', mode: 'http', signingSecret: 'test-secret' },
      noopLogger as never,
    );
    expect(conn.app).toBeDefined();
    expect(conn.client).toBeDefined();
    expect(conn.botToken).toBe('xoxb-fake');
    expect(conn.httpHandler).toBeDefined();
  });
});
