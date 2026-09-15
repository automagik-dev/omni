/**
 * Issue #1166 — oversized event payloads surface as 413, not an opaque 500.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_NATS_MAX_PAYLOAD, assertEventPayloadSize, toPayloadTooLargeError } from '@omni/core';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error';

function appThrowing(fn: () => void) {
  const app = new Hono();
  app.onError(errorHandler as never);
  app.post('/events/trigger', () => {
    fn();
    return new Response('unreachable');
  });
  return app;
}

describe('event payload size limit', () => {
  test('oversized payload returns 413 naming size and limit', async () => {
    const app = appThrowing(() => assertEventPayloadSize(4 * 1024 * 1024, DEFAULT_NATS_MAX_PAYLOAD));
    const res = await app.request('/events/trigger', { method: 'POST' });
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(body.error.message).toBe('event payload is 4.0 MB; maximum is 1 MB (NATS max_payload)');
  });

  test('payload at the limit passes', () => {
    expect(() => assertEventPayloadSize(DEFAULT_NATS_MAX_PAYLOAD, DEFAULT_NATS_MAX_PAYLOAD)).not.toThrow();
  });

  test('NatsError MAX_PAYLOAD_EXCEEDED maps to 413', async () => {
    const natsError = Object.assign(new Error('MAX_PAYLOAD_EXCEEDED'), { code: 'MAX_PAYLOAD_EXCEEDED' });
    const mapped = toPayloadTooLargeError(natsError, 1536 * 1024, DEFAULT_NATS_MAX_PAYLOAD);
    expect(mapped?.cause).toBe(natsError);
    const res = await appThrowing(() => {
      throw mapped;
    }).request('/events/trigger', { method: 'POST' });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: { message: string } }).error.message).toContain('1.5 MB');
  });

  test('other errors are not mapped', () => {
    expect(toPayloadTooLargeError(Object.assign(new Error('x'), { code: 'TIMEOUT' }), 1, 1)).toBeNull();
  });
});
