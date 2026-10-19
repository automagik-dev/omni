/**
 * Issue #1278 — a plugin that does not implement an operation is a client-side
 * limit of the channel, not a server fault: CAPABILITY_NOT_SUPPORTED surfaces
 * as 400 (as the routes that answer it directly already do), not an opaque 500.
 */

import { describe, expect, test } from 'bun:test';
import { ERROR_CODES, OmniError } from '@omni/core';
import { Hono } from 'hono';
import { errorHandler } from '../middleware/error';

describe('CAPABILITY_NOT_SUPPORTED status', () => {
  test('a thrown CAPABILITY_NOT_SUPPORTED OmniError returns 400 with its code and message', async () => {
    const app = new Hono();
    app.onError(errorHandler as never);
    app.post('/chats/:id/read', () => {
      throw new OmniError({
        code: ERROR_CODES.CAPABILITY_NOT_SUPPORTED,
        message: 'Channel x plugin does not implement markAsRead or markChatAsRead',
        context: { channelType: 'x' },
        recoverable: false,
      });
    });

    const res = await app.request('/chats/c1/read', { method: 'POST' });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CAPABILITY_NOT_SUPPORTED');
    expect(body.error.message).toContain('does not implement markAsRead');
  });
});
