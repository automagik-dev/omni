import { afterEach, describe, expect, mock, test } from 'bun:test';
import { runStartupAgentKeyRepair } from '../../agent-key-repair-state';
import { __test__ } from '../agent-dispatcher';

const INSTANCE = 'instance-b';
const OTHER_INSTANCE = 'instance-a';
const TENANT = 'tenant-b';
type Dispatch = typeof __test__.dispatchViaTurnBasedProvider;
type DispatchServices = Parameters<Dispatch>[0];
type Key = { id: string; instanceIds: string[] | null };

function harness(keys: Record<string, Key>, tenantId: string | null = TENANT) {
  const lookup = mock(async (names: string[]) => names.flatMap((name) => (keys[name] ? [keys[name]] : [])));
  const legacyLookup = mock(async (name: string) => keys[name] ?? null);
  const open = mock(async (_options: Parameters<DispatchServices['turns']['open']>[0]) => ({ id: 'turn-b' }));
  const update = mock(async (_id: string, _patch: Parameters<DispatchServices['apiKeys']['update']>[1]) => undefined);
  const triggerProvider = mock(async (_trigger: Parameters<Dispatch>[3]) => undefined);
  const services = {
    apiKeys: { findAgentKeysByNames: lookup, findAgentKeyByName: legacyLookup, update },
    turns: { open },
    chats: { findByExternalIdSmart: async () => ({ id: 'chat-b' }) },
    messages: { getByExternalId: async () => ({ id: 'message-b' }) },
  } as unknown as Parameters<Dispatch>[0];
  const db = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ id: 'agent-b', name: 'support' }] }) }) }),
  } as unknown as Parameters<Dispatch>[7];
  const trigger: Parameters<Dispatch>[3] = {
    traceId: 'trace-b',
    type: 'dm',
    event: {
      id: 'event-b',
      type: 'message.received',
      payload: { text: 'hello' },
      metadata: { correlationId: 'trace-b' },
      timestamp: 1,
    },
    source: {
      channelType: 'whatsapp-baileys',
      instanceId: INSTANCE,
      chatId: 'external-chat-b',
      messageId: 'external-message-b',
    },
    sender: { platformUserId: 'sender-b' },
    content: { text: 'hello' },
    sessionId: 'session-b',
    env: { GENIE_TMUX_SESSION: 'existing' },
  };
  const run = () =>
    __test__.dispatchViaTurnBasedProvider(
      services,
      { id: INSTANCE, tenantId, agentId: 'agent-b', channel: 'whatsapp-baileys' } as Parameters<Dispatch>[1],
      { id: 'provider-b', schema: 'genie', trigger: triggerProvider } as unknown as Parameters<Dispatch>[2],
      trigger,
      [{ payload: { externalId: 'external-message-b' }, metadata: {} }] as Parameters<Dispatch>[4],
      'external-chat-b',
      'trace-b',
      db,
    );
  return { run, lookup, legacyLookup, open, update, triggerProvider, trigger };
}

afterEach(async () => {
  await runStartupAgentKeyRepair(async () => {});
});

describe('dispatch rejects widened keys even if startup repair fails', () => {
  for (const instanceIds of [null, [], [OTHER_INSTANCE]]) {
    test(`refuses foreign bare fallback ${JSON.stringify(instanceIds)} after qualified key revocation`, async () => {
      // Active lookup no longer sees the revoked qualified row. The remaining
      // bare key can belong to another tenant, despite having the same name.
      const h = harness({ 'agent:support': { id: 'foreign-key', instanceIds } });
      expect(await h.run()).toBe(false);
      expect(h.lookup.mock.calls.flatMap(([names]) => names)).toEqual([`agent:${TENANT}:support`, 'agent:support']);
      expect(h.open).not.toHaveBeenCalled();
      expect(h.update).not.toHaveBeenCalled();
      expect(h.triggerProvider).not.toHaveBeenCalled();
    });
  }

  test('duplicate system names do not hide a key that explicitly grants this instance', async () => {
    const h = harness({});
    h.lookup.mockImplementation(async () => [
      { id: 'foreign-key', instanceIds: [OTHER_INSTANCE] },
      { id: 'own-key', instanceIds: [INSTANCE] },
    ]);
    expect(await h.run()).toBe(true);
    expect(h.open.mock.calls[0]?.[0].apiKeyId).toBe('own-key');
  });

  for (const instanceIds of [[OTHER_INSTANCE], [INSTANCE]]) {
    test(`C7 no-tenant dispatch preserves the legacy name lookup and payload (${JSON.stringify(instanceIds)})`, async () => {
      const h = harness({ 'agent:support': { id: 'legacy-key', instanceIds } }, null);
      const original = structuredClone(h.trigger);
      expect(await h.run()).toBe(true);
      expect(h.lookup).not.toHaveBeenCalled();
      expect(h.legacyLookup.mock.calls).toEqual([['agent:support']]);
      expect(Buffer.from(h.legacyLookup.mock.calls[0]![0])).toEqual(Buffer.from('agent:support'));
      expect(h.open.mock.calls).toEqual([
        [
          {
            instanceId: INSTANCE,
            chatId: 'external-chat-b',
            messageId: 'external-message-b',
            agentId: 'agent-b',
            apiKeyId: 'legacy-key',
          },
        ],
      ]);
      expect(h.update.mock.calls).toEqual([
        [
          'legacy-key',
          {
            contextInstanceId: INSTANCE,
            contextChatId: 'chat-b',
            contextMessageId: 'message-b',
          },
        ],
      ]);
      const expected = {
        ...original,
        env: {
          GENIE_TMUX_SESSION: 'existing',
          OMNI_INSTANCE: INSTANCE,
          OMNI_CHAT: 'external-chat-b',
          OMNI_MESSAGE: 'external-message-b',
          OMNI_TURN_ID: 'turn-b',
        },
      };
      expect(h.triggerProvider.mock.calls).toEqual([[expected]]);
      expect(JSON.stringify(h.trigger)).toBe(JSON.stringify(expected));
    });
  }

  for (const tenantId of [null, TENANT]) {
    for (const instanceIds of [null, []]) {
      test(`failed pre-revoke repair never permits widened dispatch (${tenantId ?? 'legacy'}, ${JSON.stringify(instanceIds)})`, async () => {
        const repair = mock(async () => {
          throw new Error('revoke transaction rolled back');
        });
        await runStartupAgentKeyRepair(repair, { reportFailure: () => {} });
        const h = harness({ 'agent:support': { id: 'still-active-wide-key', instanceIds } }, tenantId);
        expect(await h.run()).toBe(false);
        expect(repair).toHaveBeenCalledTimes(1);
        expect(h.open).not.toHaveBeenCalled();
        expect(h.update).not.toHaveBeenCalled();
        expect(h.triggerProvider).not.toHaveBeenCalled();
      });
    }
  }

  test('rejects a qualified candidate without an explicit instance grant too', async () => {
    const h = harness({ [`agent:${TENANT}:support`]: { id: 'wide-key', instanceIds: null } });
    expect(await h.run()).toBe(false);
    expect(h.open).not.toHaveBeenCalled();
    expect(h.update).not.toHaveBeenCalled();
  });

  for (const tenantId of [null, TENANT]) {
    test(`legacy I2 bare key with this instance still dispatches (${tenantId ?? 'legacy'})`, async () => {
      const h = harness({ 'agent:support': { id: 'legacy-key', instanceIds: [INSTANCE] } }, tenantId);
      expect(await h.run()).toBe(true);
      expect(h.open.mock.calls[0]).toEqual([
        {
          instanceId: INSTANCE,
          chatId: 'external-chat-b',
          messageId: 'external-message-b',
          agentId: 'agent-b',
          apiKeyId: 'legacy-key',
        },
      ]);
      expect(h.update.mock.calls[0]).toEqual([
        'legacy-key',
        {
          contextInstanceId: INSTANCE,
          contextChatId: 'chat-b',
          contextMessageId: 'message-b',
        },
      ]);
      expect(h.triggerProvider).toHaveBeenCalledTimes(1);
      expect(h.trigger.env?.OMNI_TURN_ID).toBe('turn-b');
    });
  }
});
