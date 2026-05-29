import { describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { WASocket } from 'baileys';
import { setupAllEventHandlers } from '../handlers/all-events';
import { WhatsAppPlugin } from '../plugin';

function createMockSocket() {
  const ev = new EventEmitter();
  return { ev } as unknown as WASocket & { ev: EventEmitter };
}

function createMockPlugin() {
  return {
    id: 'whatsapp-baileys',
    handleCallReceived: mock(() => undefined),
    handlePresenceUpdate: mock(() => undefined),
    handleChatsUpsert: mock(() => undefined),
    handleChatsUpdate: mock(() => undefined),
    handleChatsDelete: mock(() => undefined),
    handleContactsUpsert: mock(() => undefined),
    handleContactsUpdate: mock(() => undefined),
    handleGroupsUpsert: mock(() => undefined),
    handleGroupsUpdate: mock(() => undefined),
    handleGroupParticipantsUpdate: mock(() => undefined),
    handleGroupJoinRequest: mock(() => undefined),
    handleMessageReceiptUpdate: mock(() => undefined),
    handleMediaUpdate: mock(() => undefined),
    handleHistorySync: mock(() => undefined),
    handleBlocklistSet: mock(() => undefined),
    handleBlocklistUpdate: mock(() => undefined),
    handleLabelEdit: mock(() => undefined),
    handleLabelAssociation: mock(() => undefined),
    storeLidMapping: mock(() => undefined),
    handleMessagingHistoryStatus: mock(() => undefined),
    handleMessageCappingUpdate: mock(() => undefined),
    handleSettingsUpdate: mock(() => undefined),
    handleChatLockUpdate: mock(() => undefined),
    handleGroupMemberTagUpdate: mock(() => undefined),
  };
}

function createPluginWithEventBus() {
  const publishGeneric = mock(async (_event: string, _payload: unknown, _meta: unknown) => undefined);
  const plugin = new WhatsAppPlugin();
  (plugin as unknown as { eventBus: unknown }).eventBus = { publishGeneric };
  (plugin as unknown as { logger: unknown }).logger = { info: mock(), debug: mock(), warn: mock(), error: mock() };
  return { plugin, publishGeneric };
}

describe('setupAllEventHandlers missing Baileys events', () => {
  const instanceId = 'test-instance';

  test('delegates messaging-history.status', () => {
    const sock = createMockSocket();
    const plugin = createMockPlugin();
    setupAllEventHandlers(sock as WASocket, plugin as never, instanceId);

    const payload = { syncType: 1, status: 'complete', explicit: true };
    sock.ev.emit('messaging-history.status', payload);

    expect(plugin.handleMessagingHistoryStatus).toHaveBeenCalledTimes(1);
    expect(plugin.handleMessagingHistoryStatus).toHaveBeenCalledWith(instanceId, payload);
  });

  test('delegates message-capping.update', () => {
    const sock = createMockSocket();
    const plugin = createMockPlugin();
    setupAllEventHandlers(sock as WASocket, plugin as never, instanceId);

    const payload = { reason: 'cap', limit: 100 };
    sock.ev.emit('message-capping.update', payload);

    expect(plugin.handleMessageCappingUpdate).toHaveBeenCalledTimes(1);
    expect(plugin.handleMessageCappingUpdate).toHaveBeenCalledWith(instanceId, payload);
  });

  test('delegates settings.update', () => {
    const sock = createMockSocket();
    const plugin = createMockPlugin();
    setupAllEventHandlers(sock as WASocket, plugin as never, instanceId);

    const payload = { setting: 'locale', value: 'pt-BR' };
    sock.ev.emit('settings.update', payload);

    expect(plugin.handleSettingsUpdate).toHaveBeenCalledTimes(1);
    expect(plugin.handleSettingsUpdate).toHaveBeenCalledWith(instanceId, payload);
  });

  test('delegates chats.lock', () => {
    const sock = createMockSocket();
    const plugin = createMockPlugin();
    setupAllEventHandlers(sock as WASocket, plugin as never, instanceId);

    const payload = { id: '5511999999999@s.whatsapp.net', locked: true };
    sock.ev.emit('chats.lock', payload);

    expect(plugin.handleChatLockUpdate).toHaveBeenCalledTimes(1);
    expect(plugin.handleChatLockUpdate).toHaveBeenCalledWith(instanceId, payload);
  });

  test('delegates group.member-tag.update', () => {
    const sock = createMockSocket();
    const plugin = createMockPlugin();
    setupAllEventHandlers(sock as WASocket, plugin as never, instanceId);

    const payload = {
      groupId: '120363000000000000@g.us',
      participant: '5511999999999@s.whatsapp.net',
      participantAlt: '123@lid',
      label: 'admin',
      messageTimestamp: 1710000000,
    };
    sock.ev.emit('group.member-tag.update', payload);

    expect(plugin.handleGroupMemberTagUpdate).toHaveBeenCalledTimes(1);
    expect(plugin.handleGroupMemberTagUpdate).toHaveBeenCalledWith(instanceId, payload);
  });

  test('registers every read-only Baileys event selected for coverage', () => {
    const sock = createMockSocket();
    const plugin = createMockPlugin();
    setupAllEventHandlers(sock as WASocket, plugin as never, instanceId);

    const expectedEvents = [
      'messaging-history.status',
      'message-capping.update',
      'settings.update',
      'chats.lock',
      'group.member-tag.update',
    ];

    for (const event of expectedEvents) {
      expect(sock.ev.listenerCount(event)).toBeGreaterThan(0);
    }
  });
});

describe('WhatsAppPlugin read-only Baileys event publishing', () => {
  const instanceId = 'test-instance';

  test('publishes messaging-history.status as custom event', () => {
    const { plugin, publishGeneric } = createPluginWithEventBus();

    plugin.handleMessagingHistoryStatus(instanceId, { syncType: 1, status: 'complete', explicit: true });

    expect(publishGeneric).toHaveBeenCalledTimes(1);
    expect(publishGeneric.mock.calls[0]?.[0]).toBe('custom.whatsapp.messaging-history-status');
    expect(publishGeneric.mock.calls[0]?.[1]).toMatchObject({
      instanceId,
      syncType: 1,
      status: 'complete',
      explicit: true,
    });
    expect(publishGeneric.mock.calls[0]?.[1]).toHaveProperty('timestamp');
    expect(publishGeneric.mock.calls[0]?.[2]).toMatchObject({
      instanceId,
      channelType: plugin.id,
      source: `channel:${plugin.id}`,
    });
  });

  test('publishes message-capping.update as custom event', () => {
    const { plugin, publishGeneric } = createPluginWithEventBus();
    const info = { reason: 'cap', limit: 100 };

    plugin.handleMessageCappingUpdate(instanceId, info);

    expect(publishGeneric).toHaveBeenCalledTimes(1);
    expect(publishGeneric.mock.calls[0]?.[0]).toBe('custom.whatsapp.message-capping-updated');
    expect(publishGeneric.mock.calls[0]?.[1]).toMatchObject({ instanceId, info });
    expect(publishGeneric.mock.calls[0]?.[2]).toMatchObject({
      instanceId,
      channelType: plugin.id,
      source: `channel:${plugin.id}`,
    });
  });

  test('publishes settings.update as custom event', () => {
    const { plugin, publishGeneric } = createPluginWithEventBus();

    plugin.handleSettingsUpdate(instanceId, { setting: 'locale', value: 'pt-BR' });

    expect(publishGeneric).toHaveBeenCalledTimes(1);
    expect(publishGeneric.mock.calls[0]?.[0]).toBe('custom.whatsapp.settings-updated');
    expect(publishGeneric.mock.calls[0]?.[1]).toMatchObject({ instanceId, setting: 'locale', value: 'pt-BR' });
    expect(publishGeneric.mock.calls[0]?.[2]).toMatchObject({
      instanceId,
      channelType: plugin.id,
      source: `channel:${plugin.id}`,
    });
  });

  test('publishes chats.lock as custom event', () => {
    const { plugin, publishGeneric } = createPluginWithEventBus();

    plugin.handleChatLockUpdate(instanceId, { id: '5511999999999@s.whatsapp.net', locked: true });

    expect(publishGeneric).toHaveBeenCalledTimes(1);
    expect(publishGeneric.mock.calls[0]?.[0]).toBe('custom.whatsapp.chat-lock-updated');
    expect(publishGeneric.mock.calls[0]?.[1]).toMatchObject({
      instanceId,
      chatId: '5511999999999@s.whatsapp.net',
      locked: true,
    });
    expect(publishGeneric.mock.calls[0]?.[2]).toMatchObject({
      instanceId,
      channelType: plugin.id,
      source: `channel:${plugin.id}`,
    });
  });

  test('publishes group.member-tag.update as custom event', () => {
    const { plugin, publishGeneric } = createPluginWithEventBus();

    plugin.handleGroupMemberTagUpdate(instanceId, {
      groupId: '120363000000000000@g.us',
      participant: '5511999999999@s.whatsapp.net',
      participantAlt: '123@lid',
      label: 'admin',
      messageTimestamp: 1710000000,
    });

    expect(publishGeneric).toHaveBeenCalledTimes(1);
    expect(publishGeneric.mock.calls[0]?.[0]).toBe('custom.whatsapp.group-member-tag-updated');
    expect(publishGeneric.mock.calls[0]?.[1]).toMatchObject({
      instanceId,
      groupId: '120363000000000000@g.us',
      participant: '5511999999999@s.whatsapp.net',
      participantAlt: '123@lid',
      label: 'admin',
      messageTimestamp: 1710000000,
    });
    expect(publishGeneric.mock.calls[0]?.[2]).toMatchObject({
      instanceId,
      channelType: plugin.id,
      source: `channel:${plugin.id}`,
    });
  });
});
