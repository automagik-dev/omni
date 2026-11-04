/**
 * Tests for Slack history downloads and the fetchHistory/react/unreact surface.
 */

import { describe, expect, it } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { PluginContext } from '@omni/channel-sdk';
import type { WebClient } from '@slack/web-api';
import { SlackPlugin } from '../plugin';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

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
