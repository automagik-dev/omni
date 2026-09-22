/**
 * #1162 — Slack channel chats resolve their name via conversations.info (cached) and refresh on channel_rename.
 */

import { describe, expect, it, mock } from 'bun:test';
import type { PluginContext } from '@omni/channel-sdk';
import { SlackPlugin } from '../plugin';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

type Internals = {
  /** The plugin keys outbound work on attachments now — one per connected instance. */
  attachments: Map<string, unknown>;
  buildEnrichedPayload(
    i: string,
    from: string,
    chatId: string,
    raw: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  handleChannelRename(i: string, event: unknown): void;
};

async function setup() {
  const plugin = new SlackPlugin();
  await plugin.initialize({
    eventBus: { publish: async () => {}, subscribe: () => {} },
    storage: {},
    logger: noopLogger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  const conversationsInfo = mock(async () => ({ ok: true, channel: { id: 'C1', name: 'khal-apps' } }));
  const usersInfo = mock(async () => ({ ok: true, user: { name: 'ana', profile: { display_name: 'Ana' } } }));
  const internals = plugin as unknown as Internals;
  internals.attachments.set('inst', {
    instanceId: 'inst',
    actingClient: { conversations: { info: conversationsInfo }, users: { info: usersInfo } },
  });
  return { internals, conversationsInfo };
}

describe('Slack channel name resolution (#1162)', () => {
  it('resolves the channel name on first sight and caches it per instance', async () => {
    const { internals, conversationsInfo } = await setup();
    const first = await internals.buildEnrichedPayload('inst', 'U1', 'C1', { isDm: false });
    const second = await internals.buildEnrichedPayload('inst', 'U2', 'C1', { isDm: false });
    expect(first.chatName).toBe('khal-apps');
    expect(second.chatName).toBe('khal-apps');
    expect(conversationsInfo).toHaveBeenCalledTimes(1);
    expect(conversationsInfo).toHaveBeenCalledWith({ channel: 'C1' });
  });

  it('keeps the DM counterpart name and skips conversations.info for DMs', async () => {
    const { internals, conversationsInfo } = await setup();
    const dm = await internals.buildEnrichedPayload('inst', 'U1', 'D1', { isDm: true });
    expect(dm.chatName).toBe('Ana');
    expect(conversationsInfo).not.toHaveBeenCalled();
  });

  it('channel_rename updates the cached name without another API call', async () => {
    const { internals, conversationsInfo } = await setup();
    await internals.buildEnrichedPayload('inst', 'U1', 'C1', { isDm: false });
    internals.handleChannelRename('inst', { type: 'channel_rename', channel: { id: 'C1', name: 'khal-apps-v2' } });
    const after = await internals.buildEnrichedPayload('inst', 'U1', 'C1', { isDm: false });
    expect(after.chatName).toBe('khal-apps-v2');
    expect(conversationsInfo).toHaveBeenCalledTimes(1);
  });
});
