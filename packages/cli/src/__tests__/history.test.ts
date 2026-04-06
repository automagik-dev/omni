/**
 * Tests for the history command
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

// ---- Mock data ----

const MOCK_MESSAGES = [
  {
    id: 'uuid-1',
    chatId: 'chat-001',
    externalId: 'ext-msg-001',
    source: 'realtime',
    messageType: 'text',
    textContent: 'Hello, how are you?',
    platformTimestamp: '2026-04-05T10:00:00.000Z',
    isFromMe: false,
    senderDisplayName: 'Alice',
    senderPlatformUserId: '+5511999999999',
    transcription: null,
    mediaLocalPath: null,
    mediaUrl: null,
    createdAt: '2026-04-05T10:00:01.000Z',
    updatedAt: '2026-04-05T10:00:01.000Z',
  },
  {
    id: 'uuid-2',
    chatId: 'chat-001',
    externalId: 'ext-msg-002',
    source: 'realtime',
    messageType: 'text',
    textContent: "I'm fine, thanks!",
    platformTimestamp: '2026-04-05T10:01:00.000Z',
    isFromMe: true,
    senderDisplayName: null,
    senderPlatformUserId: null,
    transcription: null,
    mediaLocalPath: null,
    mediaUrl: null,
    createdAt: '2026-04-05T10:01:01.000Z',
    updatedAt: '2026-04-05T10:01:01.000Z',
  },
  {
    id: 'uuid-3',
    chatId: 'chat-001',
    externalId: 'ext-msg-003',
    source: 'realtime',
    messageType: 'audio',
    textContent: null,
    platformTimestamp: '2026-04-05T10:02:00.000Z',
    isFromMe: false,
    senderDisplayName: 'Alice',
    senderPlatformUserId: '+5511999999999',
    transcription: 'Can you send me the report?',
    mediaLocalPath: '/data/media/inst-1/2026-04/ext-msg-003.ogg',
    mediaUrl: null,
    createdAt: '2026-04-05T10:02:01.000Z',
    updatedAt: '2026-04-05T10:02:01.000Z',
  },
  {
    id: 'uuid-4',
    chatId: 'chat-001',
    externalId: 'ext-msg-004',
    source: 'realtime',
    messageType: 'image',
    textContent: null,
    platformTimestamp: '2026-04-05T10:03:00.000Z',
    isFromMe: false,
    senderDisplayName: 'Bob',
    senderPlatformUserId: '+5511888888888',
    transcription: null,
    mediaLocalPath: null,
    mediaUrl: 'https://media.example.com/img-004.jpg',
    createdAt: '2026-04-05T10:03:01.000Z',
    updatedAt: '2026-04-05T10:03:01.000Z',
  },
];

// ---- Mocks ----

const mockGetMessages = mock(() => Promise.resolve(MOCK_MESSAGES));

// Mock client module
mock.module('../client.js', () => ({
  getClient: () => ({
    chats: {
      getMessages: mockGetMessages,
    },
  }),
}));

// Mock config module (needed by output.js)
mock.module('../config.js', () => ({
  getOutputFormat: () => 'human',
  loadConfig: () => ({}),
  setRuntimeFormat: () => {},
}));

// Mock context module
let mockContext = {
  instanceId: 'inst-001',
  chatId: 'chat-001',
  messageId: null,
  source: 'env' as const,
};

mock.module('../context.js', () => ({
  resolveContext: () => Promise.resolve(mockContext),
}));

// Capture console output
let consoleOutput: string[] = [];
let consoleErrorOutput: string[] = [];
const originalLog = console.log;
const originalError = console.error;

// Import after mocks
const { createHistoryCommand } = await import('../commands/history.js');

describe('history command', () => {
  beforeEach(() => {
    consoleOutput = [];
    consoleErrorOutput = [];
    console.log = (...args: unknown[]) => {
      consoleOutput.push(args.map(String).join(' '));
    };
    console.error = (...args: unknown[]) => {
      consoleErrorOutput.push(args.map(String).join(' '));
    };
    mockGetMessages.mockClear();
    mockContext = {
      instanceId: 'inst-001',
      chatId: 'chat-001',
      messageId: null,
      source: 'env' as const,
    };
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
  });

  test('fetches messages with default limit of 10', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    expect(mockGetMessages).toHaveBeenCalledTimes(1);
    expect(mockGetMessages).toHaveBeenCalledWith('chat-001', {
      limit: 10,
      before: undefined,
    });
  });

  test('respects --limit option', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history', '--limit', '20']);

    expect(mockGetMessages).toHaveBeenCalledWith('chat-001', {
      limit: 20,
      before: undefined,
    });
  });

  test('respects --before option for pagination', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history', '--before', 'ext-msg-003']);

    expect(mockGetMessages).toHaveBeenCalledWith('chat-001', {
      limit: 10,
      before: 'ext-msg-003',
    });
  });

  test('outputs table rows for human format', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    // Table output includes header + separator + data rows
    const allOutput = consoleOutput.join('\n');
    expect(allOutput).toContain('ID');
    expect(allOutput).toContain('TIME');
    expect(allOutput).toContain('SENDER');
    expect(allOutput).toContain('TYPE');
    expect(allOutput).toContain('CONTENT');
    // Check data is present
    expect(allOutput).toContain('ext-msg-001');
    expect(allOutput).toContain('Alice');
    expect(allOutput).toContain('text');
  });

  test('shows "me" for isFromMe messages without senderDisplayName', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    const allOutput = consoleOutput.join('\n');
    expect(allOutput).toContain('me');
  });

  test('shows transcription for audio messages', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    const allOutput = consoleOutput.join('\n');
    expect(allOutput).toContain('transcription');
  });

  test('shows media path for media messages in full mode', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history', '--full']);

    const allOutput = consoleOutput.join('\n');
    // In full mode, no truncation — file path visible
    expect(allOutput).toContain('[file]');
    expect(allOutput).toContain('/data/media/inst-1/2026-04/ext-msg-003.ogg');
  });

  test('shows media URL when no local path', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history', '--full']);

    const allOutput = consoleOutput.join('\n');
    expect(allOutput).toContain('[media]');
    expect(allOutput).toContain('https://media.example.com/img-004.jpg');
  });

  test('handles empty message list', async () => {
    mockGetMessages.mockImplementationOnce(() => Promise.resolve([]));

    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    const allOutput = consoleOutput.join('\n');
    expect(allOutput).toContain('No messages found');
  });

  test('handles API errors gracefully', async () => {
    mockGetMessages.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

    const cmd = createHistoryCommand();

    // output.error calls process.exit, so we need to catch
    const exitMock = mock(() => {});
    const origExit = process.exit;
    process.exit = exitMock as unknown as typeof process.exit;

    try {
      await cmd.parseAsync(['node', 'history']);
    } catch {
      // expected
    }

    const errOutput = consoleErrorOutput.join('\n');
    expect(errOutput).toContain('Failed to fetch history');
    expect(errOutput).toContain('Network error');

    process.exit = origExit;
  });

  test('errors when no instance in context', async () => {
    mockContext = {
      instanceId: null as unknown as string,
      chatId: 'chat-001',
      messageId: null,
      source: 'none' as const,
    };

    const cmd = createHistoryCommand();
    const exitMock = mock(() => {});
    const origExit = process.exit;
    process.exit = exitMock as unknown as typeof process.exit;

    try {
      await cmd.parseAsync(['node', 'history']);
    } catch {
      // expected
    }

    const errOutput = consoleErrorOutput.join('\n');
    expect(errOutput).toContain('No instance in context');

    process.exit = origExit;
  });

  test('errors when no chat in context', async () => {
    mockContext = {
      instanceId: 'inst-001',
      chatId: null as unknown as string,
      messageId: null,
      source: 'env' as const,
    };

    const cmd = createHistoryCommand();
    const exitMock = mock(() => {});
    const origExit = process.exit;
    process.exit = exitMock as unknown as typeof process.exit;

    try {
      await cmd.parseAsync(['node', 'history']);
    } catch {
      // expected
    }

    const errOutput = consoleErrorOutput.join('\n');
    expect(errOutput).toContain('No chat in context');

    process.exit = origExit;
  });
});
