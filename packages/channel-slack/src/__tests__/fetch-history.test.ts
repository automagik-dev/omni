/**
 * Slack fetch-history + per_thread integration tests
 *
 * Tests:
 * - extractMessageMeta correctly surfaces threadTs/isDm/isThreadReply
 * - buildRawPayload includes threadId only for non-DM thread messages
 * - SlackPlugin exposes fetchHistory, react, unreact
 */

import { describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { PluginContext } from '@omni/channel-sdk';
import type { WebClient } from '@slack/web-api';
import { extractMessageMeta } from '../handlers/messages';
import { SlackPlugin } from '../plugin';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

describe('extractMessageMeta — thread context', () => {
  it('returns threadTs for thread reply messages', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567890.001000',
      thread_ts: '1234567890.000000',
      user: 'U001',
      channel_type: 'channel',
    });
    expect(meta.threadTs).toBe('1234567890.000000');
    expect(meta.isThreadReply).toBe(true);
    expect(meta.isDm).toBe(false);
  });

  it('returns isDm true for DM messages', () => {
    const meta = extractMessageMeta({
      channel: 'D001',
      ts: '1234567890.001000',
      user: 'U001',
      channel_type: 'im',
    });
    expect(meta.isDm).toBe(true);
    expect(meta.isThreadReply).toBe(false);
  });

  it('isThreadReply false when thread_ts equals ts (thread root)', () => {
    const ts = '1234567890.000000';
    const meta = extractMessageMeta({
      channel: 'C123',
      ts,
      thread_ts: ts,
      user: 'U001',
      channel_type: 'channel',
    });
    expect(meta.isThreadReply).toBe(false);
  });

  it('threadTs undefined for non-thread messages', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567890.000000',
      user: 'U001',
    });
    expect(meta.threadTs).toBeUndefined();
    expect(meta.isThreadReply).toBe(false);
  });
});

describe('SlackPlugin — fetchHistory + react/unreact surface', () => {
  it('exposes fetchHistory method', () => {
    const plugin = new SlackPlugin();
    expect(typeof plugin.fetchHistory).toBe('function');
  });

  it('exposes react method', () => {
    const plugin = new SlackPlugin();
    expect(typeof plugin.react).toBe('function');
  });

  it('exposes unreact method', () => {
    const plugin = new SlackPlugin();
    expect(typeof plugin.unreact).toBe('function');
  });

  it('downloads a thread file with the person token when the instance has no bot', async () => {
    const plugin = new SlackPlugin();
    await plugin.initialize({
      eventBus: { publish: async () => {}, subscribe: () => {} },
      storage: {},
      logger: noopLogger,
      config: {},
      db: {},
    } as unknown as PluginContext);
    // A one-click user-mode attachment: the person's client, and no bot token at all.
    const userClient = {
      token: 'xoxp-ana',
      conversations: {
        replies: async () => ({
          messages: [
            {
              user: 'U_OTHER',
              ts: '1700000000.000200',
              text: 'see attached',
              files: [{ mimetype: 'image/png', url_private_download: 'https://files.slack.com/download/photo.png' }],
            },
          ],
          response_metadata: {},
        }),
      },
    } as unknown as WebClient;
    (plugin as unknown as { attachments: Map<string, unknown> }).attachments.set('inst-ana', {
      instanceId: 'inst-ana',
      teamId: 'T1',
      authMode: 'user',
      actingClient: userClient,
      userClient,
      actingUserId: 'U_ANA',
      config: {},
      attachedAt: 1,
    });

    const authorizations: (string | null)[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get('authorization'));
      return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': '4' },
      });
    }) as typeof fetch;
    try {
      const result = await plugin.fetchHistory('inst-ana', { channelId: 'C1', threadId: '1700000000.000100' });
      const localPath = result.messages[0]?.content.localPath;
      expect(localPath).toBeDefined();
      if (localPath) await rm(localPath, { force: true });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(authorizations).toEqual(['Bearer xoxp-ana']);
  });
});

describe('buildRawPayload — threadId field', () => {
  it('threadId is set for non-DM thread messages', () => {
    // Simulate what setupMessageHandlers builds via buildRawPayload
    // We replicate the logic to confirm the contract
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567890.001000',
      thread_ts: '1234567890.000000',
      user: 'U001',
      channel_type: 'channel',
    });

    // This mirrors buildRawPayload logic from messages.ts
    const rawPayload = {
      ts: meta.ts,
      threadTs: meta.threadTs,
      threadId: !meta.isDm && meta.threadTs ? meta.threadTs : undefined,
      isDm: meta.isDm,
    };

    expect(rawPayload.threadId).toBe('1234567890.000000');
  });

  it('threadId is undefined for DM thread messages', () => {
    const meta = extractMessageMeta({
      channel: 'D001',
      ts: '1234567890.001000',
      thread_ts: '1234567890.000000',
      user: 'U001',
      channel_type: 'im',
    });

    const rawPayload = {
      threadId: !meta.isDm && meta.threadTs ? meta.threadTs : undefined,
      isDm: meta.isDm,
    };

    expect(rawPayload.threadId).toBeUndefined();
  });

  it('threadId is undefined for non-thread channel messages', () => {
    const meta = extractMessageMeta({
      channel: 'C123',
      ts: '1234567890.000000',
      user: 'U001',
      channel_type: 'channel',
    });

    const rawPayload = {
      threadId: !meta.isDm && meta.threadTs ? meta.threadTs : undefined,
    };

    expect(rawPayload.threadId).toBeUndefined();
  });
});
