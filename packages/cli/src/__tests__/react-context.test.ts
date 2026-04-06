/**
 * React Context Resolution Tests
 *
 * Verifies that `omni react` correctly resolves instance/chat from env vars,
 * and that the context resolution function merges layers per-field instead
 * of treating them as mutually exclusive.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';
import { MOCK_API_KEY, startMockApi, stopMockApi } from './mock-api';

// ── Unit-test mocks ──

const mockError = mock((msg: string): never => {
  throw new Error(msg);
});
const mockSuccess = mock();

mock.module('../output.js', () => ({
  error: mockError,
  success: mockSuccess,
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
  disableColors: mock(),
  areColorsEnabled: () => true,
  setMaxCellWidth: mock(),
  getCurrentFormat: () => 'human',
  flushStdout: () => Promise.resolve(),
}));

type MockedContextResponse = {
  instanceId: string | null;
  chatId: string | null;
  messageId: string | null;
};
const mockContextGet = mock(
  (): Promise<MockedContextResponse> => Promise.resolve({ instanceId: null, chatId: null, messageId: null }),
);
const mockSendReaction = mock(() => Promise.resolve({ messageId: 'sent-reaction-id' }));

mock.module('../client.js', () => ({
  getClient: () => ({
    context: { get: mockContextGet },
    messages: { sendReaction: mockSendReaction },
  }),
}));

// Note: do NOT mock '../config.js' here. The real loadConfig() handles missing
// ~/.omni/config.json gracefully (returns DEFAULT_CONFIG via try/catch). A partial
// mock would pollute other test files (e.g. config.test.ts) that import named
// exports like DEFAULT_SERVER_CONFIG — bun's mock.module is process-wide.

const { resolveContext } = await import('../context.js');

/** Remove an env var without triggering lint */
function clearEnv(key: string): void {
  delete process.env[key]; // eslint-disable-line
}

function withCleanEnv() {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.OMNI_INSTANCE = process.env.OMNI_INSTANCE;
    saved.OMNI_CHAT = process.env.OMNI_CHAT;
    saved.OMNI_MESSAGE = process.env.OMNI_MESSAGE;
    clearEnv('OMNI_INSTANCE');
    clearEnv('OMNI_CHAT');
    clearEnv('OMNI_MESSAGE');
    mockError.mockClear();
    mockSuccess.mockClear();
    mockContextGet.mockClear();
    mockSendReaction.mockClear();
    mockContextGet.mockImplementation(() => Promise.resolve({ instanceId: null, chatId: null, messageId: null }));
  });

  afterEach(() => {
    for (const key of ['OMNI_INSTANCE', 'OMNI_CHAT', 'OMNI_MESSAGE']) {
      if (saved[key] !== undefined) process.env[key] = saved[key];
      else clearEnv(key);
    }
  });
}

// ── Unit tests: resolveContext per-field cascade ──

describe('resolveContext — per-field cascade', () => {
  withCleanEnv();

  test('env vars resolve instance and chat when no flags are passed', async () => {
    process.env.OMNI_INSTANCE = 'env-instance-id';
    process.env.OMNI_CHAT = 'env-chat-id';
    const ctx = await resolveContext();
    expect(ctx.instanceId).toBe('env-instance-id');
    expect(ctx.chatId).toBe('env-chat-id');
    expect(ctx.source).toBe('env');
  });

  test('env vars still resolve when only message flag is passed (the original bug)', async () => {
    process.env.OMNI_INSTANCE = 'env-instance-id';
    process.env.OMNI_CHAT = 'env-chat-id';
    const ctx = await resolveContext({ message: 'some-message-id' });
    expect(ctx.instanceId).toBe('env-instance-id');
    expect(ctx.chatId).toBe('env-chat-id');
    expect(ctx.messageId).toBe('some-message-id');
    expect(ctx.source).toBe('flags');
  });

  test('flags override env vars per-field', async () => {
    process.env.OMNI_INSTANCE = 'env-instance-id';
    process.env.OMNI_CHAT = 'env-chat-id';
    const ctx = await resolveContext({ chat: 'flag-chat-id' });
    expect(ctx.instanceId).toBe('env-instance-id');
    expect(ctx.chatId).toBe('flag-chat-id');
  });

  test('PG context fills gaps when no flags or env vars', async () => {
    mockContextGet.mockImplementation(() =>
      Promise.resolve({ instanceId: 'api-instance-id', chatId: 'api-chat-id', messageId: 'api-message-id' }),
    );
    const ctx = await resolveContext();
    expect(ctx.instanceId).toBe('api-instance-id');
    expect(ctx.chatId).toBe('api-chat-id');
    expect(ctx.messageId).toBe('api-message-id');
    expect(ctx.source).toBe('api');
  });

  test('env vars take priority over PG context', async () => {
    process.env.OMNI_INSTANCE = 'env-instance-id';
    process.env.OMNI_CHAT = 'env-chat-id';
    mockContextGet.mockImplementation(() =>
      Promise.resolve({ instanceId: 'api-instance-id', chatId: 'api-chat-id', messageId: 'api-message-id' }),
    );
    const ctx = await resolveContext();
    expect(ctx.instanceId).toBe('env-instance-id');
    expect(ctx.chatId).toBe('env-chat-id');
    expect(ctx.messageId).toBe('api-message-id');
    expect(ctx.source).toBe('env');
  });

  test('returns none when no context is available', async () => {
    const ctx = await resolveContext();
    expect(ctx.instanceId).toBeNull();
    expect(ctx.chatId).toBeNull();
    expect(ctx.messageId).toBeNull();
    expect(ctx.source).toBe('none');
  });
});

// ── Integration tests: react command with env vars ──

const CLI_PATH = join(import.meta.dir, '../index.ts');
const TEST_CONFIG_DIR = join(tmpdir(), `.omni-react-test-${Date.now()}`);
let MOCK_URL = '';

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const proc = spawn({
    cmd: ['bun', CLI_PATH, ...args],
    env: { ...process.env, HOME: TEST_CONFIG_DIR, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

describe('react command — integration with env vars', () => {
  beforeAll(async () => {
    const mockApi = await startMockApi();
    MOCK_URL = mockApi.url;
    if (!existsSync(TEST_CONFIG_DIR)) mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    const omniDir = join(TEST_CONFIG_DIR, '.omni');
    if (!existsSync(omniDir)) mkdirSync(omniDir, { recursive: true });
    const config = { apiUrl: MOCK_URL, apiKey: MOCK_API_KEY, format: 'human' };
    writeFileSync(join(omniDir, 'config.json'), JSON.stringify(config, null, 2));
  });

  afterAll(() => {
    stopMockApi();
    if (existsSync(TEST_CONFIG_DIR)) rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
  });

  test('react fails with "No instance" when NO context is available', async () => {
    const result = await runCli(['react', '👍', '--message', 'test-msg-id']);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('No instance');
  });

  test('react resolves instance/chat from env vars with --message flag (the bug fix)', async () => {
    const result = await runCli(['react', '👍', '--message', 'test-msg-id'], {
      OMNI_INSTANCE: '00000000-0000-0000-0000-000000000001',
      OMNI_CHAT: '5511999999999@s.whatsapp.net',
    });
    // Should NOT fail with a context error — context resolved from env vars
    if (result.exitCode !== 0) {
      expect(result.stderr).not.toContain('No instance');
      expect(result.stderr).not.toContain('No chat');
    }
  });

  test('react works with ONLY env vars (no CLI flags, no stored context)', async () => {
    const result = await runCli(['react', '👍'], {
      OMNI_INSTANCE: '00000000-0000-0000-0000-000000000001',
      OMNI_CHAT: '5511999999999@s.whatsapp.net',
      OMNI_MESSAGE: 'test-trigger-msg-id',
    });
    if (result.exitCode !== 0) {
      expect(result.stderr).not.toContain('No instance');
      expect(result.stderr).not.toContain('No chat');
      expect(result.stderr).not.toContain('No message');
    }
  });

  test('say also works with env vars (regression check)', async () => {
    const result = await runCli(['say', 'hello world'], {
      OMNI_INSTANCE: '00000000-0000-0000-0000-000000000001',
      OMNI_CHAT: '5511999999999@s.whatsapp.net',
    });
    if (result.exitCode !== 0) {
      expect(result.stderr).not.toContain('No instance');
      expect(result.stderr).not.toContain('No chat');
    }
  });
});
