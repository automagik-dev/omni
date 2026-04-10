/**
 * Tests for the history command
 *
 * IMPORTANT — process-wide mock pollution
 * ----------------------------------------
 * Sibling test files (resolve.test.ts, react-context.test.ts) register a
 * `mock.module('../output.js', ...)` factory that stubs every output function
 * as a no-op. Because Bun's `mock.module` is process-wide and order-dependent,
 * if one of those files loads before this file on CI, history.js's
 * `import * as output from '../output.js'` resolves to the no-op stubs and the
 * action handler produces zero observable output. The previous version of this
 * file relied on `console.log` interception, which is bypassed entirely when
 * the output functions are stubbed at the module boundary.
 *
 * Fix: register our own complete `'../output.js'` mock here BEFORE the dynamic
 * import of `'../commands/history.js'`, with the same shape as resolve/react.
 * Test assertions inspect the mock spies directly instead of console buffers.
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

// `mockError` throws so process.exit isn't actually called and we can assert
// on the message via try/catch in the relevant tests.
const mockError = mock((msg: string): never => {
  throw new Error(msg);
});
const mockInfo = mock((_msg: string) => {});
const mockList = mock(<T>(_items: T[], _opts?: { rawData?: unknown[] }) => {});
const mockSetMaxCellWidth = mock((_width: number) => {});

mock.module('../output.js', () => ({
  error: mockError,
  success: mock(),
  info: mockInfo,
  warn: mock(),
  table: mock(),
  json: mock(),
  raw: mock(),
  data: mock(),
  list: mockList,
  keyValue: mock(),
  header: mock(),
  dim: mock(),
  disableColors: mock(),
  areColorsEnabled: () => true,
  setMaxCellWidth: mockSetMaxCellWidth,
  getCurrentFormat: () => 'human',
  flushStdout: () => Promise.resolve(),
}));

const mockGetMessages = mock(() => Promise.resolve(MOCK_MESSAGES));

mock.module('../client.js', () => ({
  getClient: () => ({
    chats: {
      getMessages: mockGetMessages,
    },
  }),
}));

// Import after mocks are set up
const { createHistoryCommand } = await import('../commands/history.js');

// Helper: clear an env var without lint complaints
function clearEnvKey(key: string): void {
  delete process.env[key];
}

describe('history command', () => {
  beforeEach(() => {
    mockGetMessages.mockClear();
    mockError.mockClear();
    mockInfo.mockClear();
    mockList.mockClear();
    mockSetMaxCellWidth.mockClear();
    mockGetMessages.mockImplementation(() => Promise.resolve(MOCK_MESSAGES));

    // Default context for most tests — real resolveContext reads these env vars.
    process.env.OMNI_INSTANCE = 'inst-001';
    process.env.OMNI_CHAT = 'chat-001';
    clearEnvKey('OMNI_MESSAGE');
  });

  afterEach(() => {
    clearEnvKey('OMNI_INSTANCE');
    clearEnvKey('OMNI_CHAT');
    clearEnvKey('OMNI_MESSAGE');
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

  test('passes formatted rows to output.list with raw messages', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    expect(mockList).toHaveBeenCalledTimes(1);
    const [rows, opts] = mockList.mock.calls[0] as [Array<Record<string, string>>, { rawData?: unknown[] }];

    // Each message becomes a row
    expect(rows).toHaveLength(4);
    const firstRow = rows[0];
    if (!firstRow) throw new Error('expected first row');
    // Headers come from row keys
    expect(Object.keys(firstRow)).toEqual(['ID', 'TIME', 'SENDER', 'TYPE', 'CONTENT']);
    // Data is intact
    expect(firstRow.ID).toBe('ext-msg-001');
    expect(firstRow.SENDER).toBe('Alice');
    expect(firstRow.TYPE).toBe('text');
    // rawData is passed through
    expect(opts.rawData).toEqual(MOCK_MESSAGES);
  });

  test('shows "me" for isFromMe messages without senderDisplayName', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    const [rows] = mockList.mock.calls[0] as [Array<Record<string, string>>];
    // ext-msg-002 is the isFromMe message with no displayName
    const meRow = rows.find((r) => r.ID === 'ext-msg-002');
    expect(meRow).toBeDefined();
    expect(meRow?.SENDER).toBe('me');
  });

  test('includes transcription in content for audio messages', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    const [rows] = mockList.mock.calls[0] as [Array<Record<string, string>>];
    const audioRow = rows.find((r) => r.ID === 'ext-msg-003');
    expect(audioRow).toBeDefined();
    expect(audioRow?.CONTENT).toContain('[transcription]');
    expect(audioRow?.CONTENT).toContain('Can you send me the report?');
  });

  test('includes media path for media messages in full mode', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history', '--full']);

    // setMaxCellWidth(0) is called in --full mode
    expect(mockSetMaxCellWidth).toHaveBeenCalledWith(0);

    const [rows] = mockList.mock.calls[0] as [Array<Record<string, string>>];
    const audioRow = rows.find((r) => r.ID === 'ext-msg-003');
    expect(audioRow?.CONTENT).toContain('[file]');
    expect(audioRow?.CONTENT).toContain('/data/media/inst-1/2026-04/ext-msg-003.ogg');
  });

  test('includes media URL when no local path', async () => {
    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history', '--full']);

    const [rows] = mockList.mock.calls[0] as [Array<Record<string, string>>];
    const imageRow = rows.find((r) => r.ID === 'ext-msg-004');
    expect(imageRow?.CONTENT).toContain('[media]');
    expect(imageRow?.CONTENT).toContain('https://media.example.com/img-004.jpg');
  });

  test('handles empty message list', async () => {
    mockGetMessages.mockImplementationOnce(() => Promise.resolve([]));

    const cmd = createHistoryCommand();
    await cmd.parseAsync(['node', 'history']);

    expect(mockInfo).toHaveBeenCalledTimes(1);
    expect(mockInfo).toHaveBeenCalledWith('No messages found.');
    expect(mockList).not.toHaveBeenCalled();
  });

  test('handles API errors gracefully', async () => {
    mockGetMessages.mockImplementationOnce(() => Promise.reject(new Error('Network error')));

    const cmd = createHistoryCommand();

    try {
      await cmd.parseAsync(['node', 'history']);
    } catch {
      // mockError throws — expected
    }

    expect(mockError).toHaveBeenCalledTimes(1);
    const msg = mockError.mock.calls[0]?.[0] as string;
    expect(msg).toContain('Failed to fetch history');
    expect(msg).toContain('Network error');
  });

  test('errors when no instance in context', async () => {
    clearEnvKey('OMNI_INSTANCE');
    const savedHome = process.env.HOME;
    process.env.HOME = '/tmp/.omni-test-no-config';

    const cmd = createHistoryCommand();
    try {
      await cmd.parseAsync(['node', 'history']);
    } catch {
      // mockError throws — expected
    }

    expect(mockError).toHaveBeenCalledTimes(1);
    const msg = mockError.mock.calls[0]?.[0] as string;
    expect(msg).toContain('No instance in context');
    if (savedHome) process.env.HOME = savedHome;
    else clearEnvKey('HOME');
  });

  test('errors when no chat in context', async () => {
    clearEnvKey('OMNI_CHAT');

    const cmd = createHistoryCommand();
    try {
      await cmd.parseAsync(['node', 'history']);
    } catch {
      // mockError throws — expected
    }

    expect(mockError).toHaveBeenCalledTimes(1);
    const msg = mockError.mock.calls[0]?.[0] as string;
    expect(msg).toContain('No chat in context');
  });
});
