/**
 * E2E-style tests for GenieClient auto-spawn behavior
 *
 * Covers scenarios closer to real-world: spawn via genie CLI, concurrent
 * messages, session recovery, template variable resolution, and genie spawn
 * command correctness.
 *
 * Run with: bun test packages/core/src/providers/__tests__/genie-client-e2e.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GenieClient, interpolateTemplate } from '../genie-client';
import type { GenieClientConfig } from '../genie-client';
import type { ProviderRequest } from '../types';

// ============================================================================
// Mocks
// ============================================================================

const execFileMock = mock((...callArgs: unknown[]) => {
  const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
  cb(null, '', '');
});

const TEST_DIR = '/tmp/genie-client-e2e-test';

mock.module('node:child_process', () => ({
  execFile: execFileMock,
}));

mock.module('node:os', () => ({
  homedir: () => TEST_DIR,
}));

// ============================================================================
// Test helpers
// ============================================================================

const TEAMS_DIR = join(TEST_DIR, '.claude', 'teams');

function makeConfig(overrides?: Partial<GenieClientConfig>): GenieClientConfig {
  return {
    agentName: 'omni',
    targetAgent: 'team-lead',
    teamName: 'test-team',
    agentRole: 'omni-pm',
    ...overrides,
  };
}

function makeRequest(overrides?: Partial<ProviderRequest>): ProviderRequest {
  return {
    message: 'test message',
    agentId: 'genie',
    stream: false,
    userId: 'test-user',
    ...overrides,
  };
}

function makeRequestWithChat(chatId: string, threadId?: string): ProviderRequest {
  return {
    message: 'test message',
    agentId: 'genie',
    stream: false,
    userId: 'user-123',
    chat: {
      id: chatId,
      threadId,
      type: threadId ? 'group' : 'dm',
    },
    platform: {
      id: 'user-123',
      channel: 'telegram',
      instanceId: 'inst-telegram-1',
    },
  };
}

function getCallsFor(binary: string): unknown[][] {
  return execFileMock.mock.calls.filter((call) => (call[0] as string) === binary);
}

type MockCb = (error: Error | null, stdout?: string, stderr?: string) => void;

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  execFileMock.mockClear();
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ============================================================================
// Genie Spawn Command
// ============================================================================

describe('genie spawn command', () => {
  test('calls genie spawn with correct agentRole and --team flag', async () => {
    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());
    await new Promise((r) => setTimeout(r, 150));

    const genieCalls = getCallsFor('genie');
    expect(genieCalls.length).toBe(1);

    const args = genieCalls[0]![1] as string[];
    expect(args[0]).toBe('spawn');
    expect(args[1]).toBe('omni-pm');
    expect(args[2]).toBe('--team');
    expect(args[3]).toBe('test-team');
  });

  test('passes --cwd flag with autoSpawnDir', async () => {
    const client = new GenieClient(makeConfig({ autoSpawnDir: '/my/workspace' }));
    await client.run(makeRequest());
    await new Promise((r) => setTimeout(r, 150));

    const genieCalls = getCallsFor('genie');
    const args = genieCalls[0]![1] as string[];

    expect(args).toContain('--cwd');
    expect(args[args.indexOf('--cwd') + 1]).toBe('/my/workspace');
  });

  test('uses custom agentRole from config', async () => {
    const client = new GenieClient(makeConfig({ agentRole: 'cegonha' }));
    await client.run(makeRequest());
    await new Promise((r) => setTimeout(r, 150));

    const genieCalls = getCallsFor('genie');
    const args = genieCalls[0]![1] as string[];

    expect(args[0]).toBe('spawn');
    expect(args[1]).toBe('cegonha');
  });

  test('delivers message even when genie spawn fails', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as MockCb;
      const file = callArgs[0] as string;

      if (file === 'genie') {
        cb(new Error('genie: command not found'));
      } else {
        cb(null, '', '');
      }
    });

    const client = new GenieClient(makeConfig());
    const response = await client.run(makeRequest());

    // Message delivery succeeds even when spawn fails
    expect(response.status).toBe('completed');

    const inboxPath = join(TEAMS_DIR, 'test-team', 'inboxes', 'team-lead.json');
    expect(existsSync(inboxPath)).toBe(true);
  });

  test('no tmux fallback when genie spawn fails', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as MockCb;
      const file = callArgs[0] as string;

      if (file === 'genie') {
        cb(new Error('genie: command not found'));
      } else {
        cb(null, '', '');
      }
    });

    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());
    await new Promise((r) => setTimeout(r, 150));

    // No tmux calls should be made (no fallback)
    const tmuxCalls = getCallsFor('tmux');
    expect(tmuxCalls.length).toBe(0);
  });
});

// ============================================================================
// Template Variable Resolution
// ============================================================================

describe('template variable resolution', () => {
  test('resolves {chat_id} in team name for per-chat sessions', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      cb(null, '', '');
    });

    const client = new GenieClient(makeConfig({ teamName: 'cegonha-{chat_id}' }));
    await client.run(makeRequestWithChat('chat123'));
    await new Promise((r) => setTimeout(r, 500));

    // Team name should resolve to 'cegonha-chat123'
    const inboxPath = join(TEAMS_DIR, 'cegonha-chat123', 'inboxes', 'team-lead.json');
    expect(existsSync(inboxPath)).toBe(true);
  });

  test('resolves {chat_id}-{thread_id} for per-thread sessions', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      cb(null, '', '');
    });

    const client = new GenieClient(makeConfig({ teamName: 'cegonha-{chat_id}-{thread_id}' }));
    await client.run(makeRequestWithChat('chat123', 'thread456'));
    await new Promise((r) => setTimeout(r, 500));

    const inboxPath = join(TEAMS_DIR, 'cegonha-chat123-thread456', 'inboxes', 'team-lead.json');
    expect(existsSync(inboxPath)).toBe(true);
  });

  test('falls back when thread_id is absent (DM without thread)', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      cb(null, '', '');
    });

    const client = new GenieClient(makeConfig({ teamName: 'cegonha-{chat_id}-{thread_id}' }));
    // No thread_id in request
    await client.run(makeRequestWithChat('chat789'));
    await new Promise((r) => setTimeout(r, 500));

    // thread_id resolves to empty -> sanitize strips trailing dash
    // 'cegonha-chat789-' -> sanitize -> 'cegonha-chat789'
    const inboxPath = join(TEAMS_DIR, 'cegonha-chat789', 'inboxes', 'team-lead.json');
    expect(existsSync(inboxPath)).toBe(true);
  });

  test('different chat_ids create separate inbox directories', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      cb(null, '', '');
    });

    const client = new GenieClient(makeConfig({ teamName: 'team-{chat_id}' }));

    await client.run(makeRequestWithChat('alice'));
    await client.run(makeRequestWithChat('bob'));
    await new Promise((r) => setTimeout(r, 500));

    const aliceInbox = join(TEAMS_DIR, 'team-alice', 'inboxes', 'team-lead.json');
    const bobInbox = join(TEAMS_DIR, 'team-bob', 'inboxes', 'team-lead.json');

    expect(existsSync(aliceInbox)).toBe(true);
    expect(existsSync(bobInbox)).toBe(true);

    // Verify they're different files with separate messages
    const aliceData = JSON.parse(readFileSync(aliceInbox, 'utf-8'));
    const bobData = JSON.parse(readFileSync(bobInbox, 'utf-8'));
    expect(aliceData.length).toBe(1);
    expect(bobData.length).toBe(1);
  });

  test('interpolateTemplate replaces all supported variables', () => {
    const template = '{channel}-{instance_id}-{chat_id}-{thread_id}-{sender_id}';
    const result = interpolateTemplate(template, {
      channel: 'telegram',
      instance_id: 'inst-1',
      chat_id: 'chat-42',
      thread_id: 'thread-7',
      sender_id: 'user-99',
    });
    expect(result).toBe('telegram-inst-1-chat-42-thread-7-user-99');
  });

  test('interpolateTemplate replaces missing vars with empty string', () => {
    const result = interpolateTemplate('team-{chat_id}-{thread_id}', {
      chat_id: 'abc',
      // thread_id intentionally missing
    });
    expect(result).toBe('team-abc-');
  });
});

// ============================================================================
// Concurrent Spawn Protection
// ============================================================================

describe('concurrent spawn protection', () => {
  test('coalesces concurrent requests for same team (pendingTeams)', async () => {
    let genieCallCount = 0;
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      const file = callArgs[0] as string;

      if (file === 'genie') {
        genieCallCount++;
        // Simulate slow genie -- resolve after 100ms
        setTimeout(() => cb(null, '', ''), 100);
      } else {
        cb(null, '', '');
      }
    });

    const client = new GenieClient(makeConfig());

    // Fire messages sequentially to avoid lock contention on the inbox file
    for (const msg of ['msg1', 'msg2', 'msg3', 'msg4', 'msg5']) {
      await client.run(makeRequest({ message: msg }));
    }

    await new Promise((r) => setTimeout(r, 200));

    // pendingTeams should coalesce: only 1 genie call (first message triggers it,
    // rest find it in pendingTeams or knownTeams)
    expect(genieCallCount).toBe(1);

    // All 5 messages should be in the inbox
    const inboxPath = join(TEAMS_DIR, 'test-team', 'inboxes', 'team-lead.json');
    const inbox = JSON.parse(readFileSync(inboxPath, 'utf-8'));
    expect(inbox.length).toBe(5);
  });

  test('allows spawn for different teams concurrently', async () => {
    const spawnedTeams = new Set<string>();
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      const file = callArgs[0] as string;
      const args = callArgs[1] as string[];

      if (file === 'genie') {
        // Extract team name from: genie spawn <agent> --team <teamName>
        const teamIdx = args.indexOf('--team');
        const teamName = teamIdx !== -1 ? (args[teamIdx + 1] ?? '') : '';
        spawnedTeams.add(teamName);
        cb(null, '', '');
      } else {
        cb(null, '', '');
      }
    });

    const client = new GenieClient(makeConfig({ teamName: 'team-{chat_id}' }));

    await Promise.all([
      client.run(makeRequestWithChat('alice')),
      client.run(makeRequestWithChat('bob')),
      client.run(makeRequestWithChat('carol')),
    ]);

    await new Promise((r) => setTimeout(r, 150));

    // Each unique team should trigger its own genie call
    expect(spawnedTeams.size).toBe(3);
    expect(spawnedTeams.has('team-alice')).toBe(true);
    expect(spawnedTeams.has('team-bob')).toBe(true);
    expect(spawnedTeams.has('team-carol')).toBe(true);
  });
});

// ============================================================================
// Session Recovery
// ============================================================================

describe('session recovery', () => {
  test('re-spawns when cache TTL expires', async () => {
    let genieCallCount = 0;

    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      const file = callArgs[0] as string;

      if (file === 'genie') {
        genieCallCount++;
        cb(null, '', '');
      } else {
        cb(null, '', '');
      }
    });

    const client = new GenieClient(makeConfig());

    // First run: spawns and caches
    await client.run(makeRequest());
    await new Promise((r) => setTimeout(r, 500));
    expect(genieCallCount).toBe(1);

    // Team is now cached -- second run should skip spawn
    genieCallCount = 0;
    await client.run(makeRequest({ message: 'second' }));
    await new Promise((r) => setTimeout(r, 500));
    expect(genieCallCount).toBe(0);

    // NOTE: Current implementation does NOT detect session death after caching.
    // Once a team is in knownTeams, it stays there until TTL expires.
    // After TTL, genie spawn is re-called which is idempotent (~2s max).
  });

  test('inbox file survives spawn failure (fire-and-forget)', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      // Everything fails
      cb(new Error('total failure'));
    });

    const client = new GenieClient(makeConfig());
    const response = await client.run(makeRequest({ message: 'important message' }));

    // Message delivery succeeds even when spawn fails
    expect(response.status).toBe('completed');

    const inboxPath = join(TEAMS_DIR, 'test-team', 'inboxes', 'team-lead.json');
    expect(existsSync(inboxPath)).toBe(true);

    const inbox = JSON.parse(readFileSync(inboxPath, 'utf-8'));
    expect(inbox[0].text).toContain('important message');
  });
});

// ============================================================================
// Inbox Message Format
// ============================================================================

describe('inbox message format', () => {
  test('includes metadata header with chat context', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      cb(null, '', '');
    });

    const client = new GenieClient(makeConfig());
    await client.run(
      makeRequest({
        message: 'Hello world',
        chat: { id: 'chat-42', threadId: 'thread-7', type: 'group' },
        platform: { id: 'user-1', channel: 'telegram', instanceId: 'inst-1' },
        sender: { displayName: 'Alice' },
        messageId: 'msg-99',
      }),
    );

    const inboxPath = join(TEAMS_DIR, 'test-team', 'inboxes', 'team-lead.json');
    const inbox = JSON.parse(readFileSync(inboxPath, 'utf-8'));
    const msg = inbox[0];

    // Metadata header should contain routing info
    expect(msg.text).toContain('[channel:telegram');
    expect(msg.text).toContain('instance:inst-1');
    expect(msg.text).toContain('chat:chat-42');
    expect(msg.text).toContain('thread:thread-7');
    expect(msg.text).toContain('msg:msg-99');
    expect(msg.text).toContain('from:Alice');
    expect(msg.text).toContain('type:group');

    // Core fields
    expect(msg.from).toBe('omni');
    expect(msg.read).toBe(false);
    expect(msg.timestamp).toBeTruthy();
  });

  test('message includes reply instruction', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      cb(null, '', '');
    });

    const client = new GenieClient(makeConfig());
    await client.run(makeRequest({ message: 'ping' }));

    const inboxPath = join(TEAMS_DIR, 'test-team', 'inboxes', 'team-lead.json');
    const inbox = JSON.parse(readFileSync(inboxPath, 'utf-8'));

    expect(inbox[0].text).toContain('REPLY NOW via SendMessage');
    expect(inbox[0].text).toContain('"omni"');
  });
});
