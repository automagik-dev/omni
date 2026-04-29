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
mock.module('../client.js', () => ({
  getClient: () => ({
    chats: {
      getMessages: mockGetMessages,
    },
  }),
}));

// Import after mocks are set up
const { resolveMessageId } = await import('../resolve.js');

describe('resolveMessageId', () => {
  beforeEach(() => {
    mockError.mockClear();
    mockGetMessages.mockClear();
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
