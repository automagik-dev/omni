/**
 * resolveMessageId Unit Tests
 *
 * Tests for message ID resolution including:
 * - Full UUID pass-through
 * - External ID (hex string) pass-through with chat context
 * - UUID prefix resolution with chat context
 * - Error on hex prefix without chat context
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';

// Mock output.error to throw instead of process.exit
const mockError = mock((msg: string) => {
  throw new Error(msg);
});
mock.module('../output.js', () => ({
  error: mockError,
  success: mock(),
  info: mock(),
  warn: mock(),
  table: mock(),
  json: mock(),
  raw: mock(),
  data: mock(),
  list: mock(),
  keyValue: mock(),
  header: mock(),
  dim: mock(),
  tip: (msg: string) => {
    // biome-ignore lint/suspicious/noConsole: matches real output.tip — writes to stderr via console.error
    console.error(msg);
  },
  disableColors: mock(),
  areColorsEnabled: () => true,
  setMaxCellWidth: mock(),
  getCurrentFormat: () => 'human',
  flushStdout: () => Promise.resolve(),
}));

// Mock getClient
const mockGetMessages = mock();
const mockListChats = mock();
const mockGetChat = mock();
mock.module('../client.js', () => ({
  getClient: () => ({
    chats: {
      get: mockGetChat,
      getMessages: mockGetMessages,
      list: mockListChats,
    },
  }),
}));

// Import after mocks are set up
const { resolveChatId, resolveMessageId, resolveRecipient } = await import('../resolve.js');

describe('resolveMessageId', () => {
  beforeEach(() => {
    mockError.mockClear();
    mockGetMessages.mockClear();
    mockListChats.mockClear();
  });

  test('full UUID passes through without API call', async () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const result = await resolveMessageId(uuid);
    expect(result).toBe(uuid);
    expect(mockGetMessages).not.toHaveBeenCalled();
  });

  test('full UUID passes through even with chat context', async () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const result = await resolveMessageId(uuid, 'some-chat-id');
    expect(result).toBe(uuid);
    expect(mockGetMessages).not.toHaveBeenCalled();
  });

  test('external hex ID passes through with chat context when no UUID match', async () => {
    const externalId = '3EB0A1B2C3D4E5F6';
    mockGetMessages.mockResolvedValue([
      { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      { id: 'ffffffff-1111-2222-3333-444444444444' },
    ]);

    const result = await resolveMessageId(externalId, '120363001234567890@g.us');
    expect(result).toBe(externalId);
  });

  test('short external hex ID passes through with chat context when no UUID match', async () => {
    const externalId = 'DEADBEEF';
    mockGetMessages.mockResolvedValue([{ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }]);

    const result = await resolveMessageId(externalId, '120363001234567890@g.us');
    expect(result).toBe(externalId);
  });

  test('external hex ID passes through when getMessages fails', async () => {
    const externalId = '3EB0A1B2C3D4E5F6';
    mockGetMessages.mockRejectedValue(new Error('Chat not found'));

    const result = await resolveMessageId(externalId, '120363001234567890@g.us');
    expect(result).toBe(externalId);
  });

  test('UUID prefix resolves to full UUID with chat context', async () => {
    const fullUuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    mockGetMessages.mockResolvedValue([{ id: fullUuid }, { id: 'ffffffff-1111-2222-3333-444444444444' }]);

    const result = await resolveMessageId('a1b2c3', 'some-chat-id');
    expect(result).toBe(fullUuid);
  });

  test('ambiguous UUID prefix errors with chat context', async () => {
    mockGetMessages.mockResolvedValue([
      { id: 'aabbccdd-1111-2222-3333-444444444444' },
      { id: 'aabbccee-5555-6666-7777-888888888888' },
    ]);

    await expect(resolveMessageId('aabbcc', 'some-chat-id')).rejects.toThrow('Ambiguous ID prefix');
  });

  test('hex string without chat context errors', async () => {
    await expect(resolveMessageId('3EB0A1B2C3D4E5F6')).rejects.toThrow('Cannot resolve message ID prefix');
  });

  test('non-hex non-UUID string without chat context errors', async () => {
    await expect(resolveMessageId('not-a-valid-id')).rejects.toThrow('Invalid message ID');
  });

  test('non-hex non-UUID string with chat context errors', async () => {
    await expect(resolveMessageId('not-a-valid-id!', 'some-chat-id')).rejects.toThrow('No message found matching');
  });
});

describe('resolveChatId', () => {
  beforeEach(() => {
    mockError.mockClear();
    mockListChats.mockClear();
    mockGetChat.mockClear();
  });

  test('validates full UUID chat belongs to provided instance', async () => {
    const chatId = '11111111-1111-4111-8111-111111111111';
    mockGetChat.mockResolvedValue({ id: chatId, instanceId: 'instance-b', name: 'Example Contact' });

    const result = await resolveChatId(chatId, 'instance-b');

    expect(result).toBe(chatId);
    expect(mockGetChat).toHaveBeenCalledWith(chatId);
    expect(mockListChats).not.toHaveBeenCalled();
  });

  test('rejects full UUID chat from a different instance', async () => {
    const chatId = '11111111-1111-4111-8111-111111111111';
    mockGetChat.mockResolvedValue({ id: chatId, instanceId: 'instance-a', name: 'Example Contact' });

    await expect(resolveChatId(chatId, 'instance-b')).rejects.toThrow(
      `Chat ${chatId.slice(0, 8)} belongs to instance instance-a, not instance-b`,
    );
    expect(mockListChats).not.toHaveBeenCalled();
  });

  test('rejects full UUID chat when API returns null', async () => {
    const chatId = '11111111-1111-4111-8111-111111111111';
    mockGetChat.mockResolvedValue(null);

    await expect(resolveChatId(chatId, 'instance-b')).rejects.toThrow(`No chat found matching "${chatId}"`);
    expect(mockListChats).not.toHaveBeenCalled();
  });

  test('scopes chat lookup by instance when provided', async () => {
    mockListChats.mockResolvedValue({
      items: [{ id: '22222222-2222-2222-2222-222222222222', name: 'Example Contact' }],
    });

    const result = await resolveChatId('example contact', 'instance-b');

    expect(result).toBe('22222222-2222-2222-2222-222222222222');
    expect(mockListChats).toHaveBeenCalledWith({ limit: 100, instanceId: 'instance-b' });
  });
});

describe('resolveChatId external id (#1119)', () => {
  beforeEach(() => mockListChats.mockReset());

  test('resolves a WhatsApp JID to the chat uuid', async () => {
    const jid = '120363001234567890@g.us';
    mockListChats.mockResolvedValue({
      items: [
        { id: '33333333-3333-4333-8333-333333333333', name: 'Group', externalId: jid },
        { id: '44444444-4444-4444-8444-444444444444', name: 'Other', externalId: `9${jid}` },
      ],
    });
    expect(await resolveChatId(jid)).toBe('33333333-3333-4333-8333-333333333333');
    expect(mockListChats).toHaveBeenCalledWith({ limit: 100, instanceId: undefined, search: jid });
  });

  test('resolves a Slack conversation id to the chat uuid', async () => {
    const slackId = 'D05J8JA79QA';
    mockListChats.mockResolvedValue({
      items: [
        { id: '55555555-5555-4555-8555-555555555555', name: 'Felipe', externalId: slackId },
        { id: '66666666-6666-4666-8666-666666666666', name: 'Other', externalId: 'C05J8JA79QA' },
      ],
    });
    expect(await resolveChatId(slackId)).toBe('55555555-5555-4555-8555-555555555555');
    expect(mockListChats).toHaveBeenCalledWith({ limit: 100, instanceId: undefined, search: slackId });
  });

  test('an unknown Slack conversation id still ends at the no-chat error', async () => {
    mockListChats.mockResolvedValue({ items: [] });
    await expect(resolveChatId('D0NOTHERE99')).rejects.toThrow('No chat found matching "D0NOTHERE99"');
    // External-id lookup, then the name/prefix search — the fall-through is intact.
    expect(mockListChats).toHaveBeenCalledTimes(2);
  });
});

describe('resolveRecipient', () => {
  beforeEach(() => mockListChats.mockReset());

  test('passes a Slack conversation id through untouched', async () => {
    expect(await resolveRecipient('D05J8JA79QA')).toBe('D05J8JA79QA');
    expect(await resolveRecipient('C05J8EZQ1S7', 'instance-b')).toBe('C05J8EZQ1S7');
    expect(mockListChats).not.toHaveBeenCalled();
  });

  test('keeps the uuid, phone and JID pass-throughs', async () => {
    const uuid = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(await resolveRecipient(uuid)).toBe(uuid);
    expect(await resolveRecipient('+5511999999999')).toBe('+5511999999999');
    expect(await resolveRecipient('5511999999999@s.whatsapp.net')).toBe('5511999999999@s.whatsapp.net');
    expect(mockListChats).not.toHaveBeenCalled();
  });

  test('a non-platform name still goes through the chat search', async () => {
    mockListChats.mockResolvedValue({ items: [{ id: '77777777-7777-4777-8777-777777777777', name: 'Felipe' }] });
    expect(await resolveRecipient('felipe')).toBe('77777777-7777-4777-8777-777777777777');
    expect(mockListChats).toHaveBeenCalledWith({ limit: 100, instanceId: undefined });
  });
});
