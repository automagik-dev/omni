/**
 * CLI Integration Tests
 *
 * These tests verify the CLI works correctly against a mock API server.
 * The CLI is spawned as a subprocess to test real-world usage.
 *
 * All tests run automatically — no env vars required.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'bun';
import {
  MOCK_API_KEY,
  type MockApiHandle,
  clearRecordedRequests,
  getRecordedRequests,
  startMockApi,
  startMockApiInstance,
  stopMockApi,
} from './mock-api';

/**
 * Pre-suite guard (#413): fail fast if a prior test run leaked a PM2 god
 * daemon attached to a `.omni-test` PM2_HOME. Leaving these around pollutes
 * the host and can confuse a subsequent suite that rebinds the same PM2
 * socket path.
 */
function assertNoLeakedTestDaemons(): void {
  const ps = spawnSync({ cmd: ['ps', '-eo', 'pid,args'], stdout: 'pipe', stderr: 'pipe' });
  if (ps.exitCode !== 0) return; // non-fatal — if ps is unavailable, skip the guard
  const output = new TextDecoder().decode(ps.stdout);
  // Anchored to args start to avoid matching processes that merely mention
  // the string (e.g. this source file itself, grep commands, transcripts).
  const pattern = /^PM2\s+[^:]*:\s*God Daemon\s+\([^)]*\.omni-test[^)]*\)/;
  const leaked: string[] = [];
  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const pidMatch = trimmed.match(/^\d+\s+(.*)$/);
    const args = pidMatch?.[1] ?? '';
    if (!pattern.test(args)) continue;
    leaked.push(trimmed);
  }
  if (leaked.length > 0) {
    const pids = leaked
      .map((l) => l.match(/^(\d+)\s/)?.[1])
      .filter((p): p is string => p !== undefined)
      .join(' ');
    const hint = pids ? `  # or: kill ${pids}\n` : '';
    throw new Error(
      `Pre-suite leak guard (#413): ${leaked.length} stale PM2 god daemon(s) detected:\n${leaked.join('\n')}\n\nKill them before re-running this suite:\n  make kill-stale-test-daemons\n${hint}`,
    );
  }
}

// Use source entry point directly — avoids stale dist/index.js issues
const CLI_PATH = join(import.meta.dir, '../index.ts');

// Temp config dir for tests
const TEST_CONFIG_DIR = join(tmpdir(), `.omni-test-${Date.now()}`);
// Explicit PM2_HOME under the test config dir. Without this, pm2 derives its
// home from `HOME/.pm2`, and any CLI command that talks to pm2 (e.g. `omni
// status` → `pm2 jlist`) will fork a god daemon there. The teardown then
// rm-rf's TEST_CONFIG_DIR but the daemon survives, leaving an orphan attached
// to a deleted PM2_HOME (issue #413).
const TEST_PM2_HOME = join(TEST_CONFIG_DIR, '.pm2');

/**
 * Stop the test-mode PM2 god daemon (if any) before its home gets removed.
 * Synchronous so it can run from non-async afterAll hooks.
 */
function killTestPm2Daemon(): void {
  if (!existsSync(TEST_PM2_HOME)) return;
  spawnSync({
    cmd: ['pm2', 'kill'],
    env: { ...process.env, HOME: TEST_CONFIG_DIR, PM2_HOME: TEST_PM2_HOME },
    stdout: 'ignore',
    stderr: 'ignore',
  });
}

/** Mock API URL — set in beforeAll */
let MOCK_URL = '';

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run the CLI with given arguments
 */
async function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const proc = spawn({
    cmd: ['bun', CLI_PATH, ...args],
    env: {
      ...process.env,
      HOME: TEST_CONFIG_DIR, // Use test config dir
      PM2_HOME: TEST_PM2_HOME, // Isolate pm2 daemon from the host (issue #413)
      ...env,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  return { stdout, stderr, exitCode };
}

/**
 * Run CLI and parse JSON output
 */
async function runCliJson<T>(args: string[], env: Record<string, string> = {}): Promise<T> {
  const result = await runCli(args, { OMNI_FORMAT: 'json', ...env });
  if (result.exitCode !== 0) {
    throw new Error(`CLI failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as T;
}

/**
 * Assert CLI result is successful, with helpful error message
 */
function assertSuccess(result: CliResult, context: string): void {
  if (result.exitCode !== 0) {
    throw new Error(
      `${context} failed with exit code ${result.exitCode}\n` +
        `stdout: ${result.stdout}\n` +
        `stderr: ${result.stderr}`,
    );
  }
}

describe('CLI Basic Tests', () => {
  beforeAll(() => {
    // Fail fast if a prior run left a god daemon around (#413). Runs before
    // any other setup so the error surfaces cleanly at suite startup.
    assertNoLeakedTestDaemons();
    // Create test config directory
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
    // Create .omni subdirectory
    const omniDir = join(TEST_CONFIG_DIR, '.omni');
    if (!existsSync(omniDir)) {
      mkdirSync(omniDir, { recursive: true });
    }
  });

  afterAll(() => {
    // Stop the test-mode pm2 god daemon BEFORE removing its home, otherwise
    // the daemon survives and re-parents to init with a deleted PM2_HOME.
    killTestPm2Daemon();
    // Cleanup test config directory
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe('--help', () => {
    test('shows help for main command', async () => {
      const result = await runCli(['--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('omni');
      expect(result.stdout).toContain('CLI for Omni');
      expect(result.stdout).toContain('auth');
      expect(result.stdout).toContain('config');
      expect(result.stdout).toContain('instances');
    });

    test('shows help for auth command', async () => {
      const result = await runCli(['auth', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('login');
      expect(result.stdout).toContain('status');
      expect(result.stdout).toContain('logout');
    });

    test('shows help for instances command', async () => {
      const result = await runCli(['instances', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('list');
      expect(result.stdout).toContain('create');
      expect(result.stdout).toContain('delete');
      expect(result.stdout).toContain('connect');
    });

    test('shows help for send command', async () => {
      const result = await runCli(['send', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--instance');
      expect(result.stdout).toContain('--to');
      expect(result.stdout).toContain('--text');
      expect(result.stdout).toContain('--media');
    });
  });

  describe('--version', () => {
    test('shows version number', async () => {
      const result = await runCli(['--version']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });
  });

  describe('config', () => {
    test('config list shows all keys', async () => {
      const result = await runCli(['config', 'list']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('apiUrl');
      expect(result.stdout).toContain('apiKey');
      expect(result.stdout).toContain('defaultInstance');
      expect(result.stdout).toContain('format');
    });

    test('config set and get work', async () => {
      // Set value
      const setResult = await runCli(['config', 'set', 'apiUrl', 'http://test:9999']);
      expect(setResult.exitCode).toBe(0);

      // Get value
      const getResult = await runCli(['config', 'get', 'apiUrl']);
      expect(getResult.exitCode).toBe(0);
      expect(getResult.stdout).toContain('http://test:9999');

      // Unset value to restore
      const unsetResult = await runCli(['config', 'unset', 'apiUrl']);
      expect(unsetResult.exitCode).toBe(0);
    });

    test('config set format validates values', async () => {
      // Invalid format should fail
      const result = await runCli(['config', 'set', 'format', 'invalid']);
      expect(result.exitCode).not.toBe(0);
    });

    test('config set format accepts valid values', async () => {
      const result = await runCli(['config', 'set', 'format', 'json']);
      expect(result.exitCode).toBe(0);

      // Reset to human
      await runCli(['config', 'set', 'format', 'human']);
    });

    test('config get unknown key fails', async () => {
      const result = await runCli(['config', 'get', 'unknownKey']);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('completions', () => {
    test('completions shows available shells', async () => {
      const result = await runCli(['completions']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('bash');
      expect(result.stdout).toContain('zsh');
      expect(result.stdout).toContain('fish');
    });

    test('completions bash outputs bash completions', async () => {
      const result = await runCli(['completions', 'bash']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('_omni_completions');
      expect(result.stdout).toContain('complete -F');
    });

    test('completions zsh outputs zsh completions', async () => {
      const result = await runCli(['completions', 'zsh']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('#compdef omni');
      expect(result.stdout).toContain('_omni');
    });

    test('completions fish outputs fish completions', async () => {
      const result = await runCli(['completions', 'fish']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('complete -c omni');
    });

    test('completions unknown shell fails', async () => {
      const result = await runCli(['completions', 'powershell']);
      expect(result.exitCode).not.toBe(0);
    });
  });

  describe('output format', () => {
    test('JSON format via env var', async () => {
      const result = await runCli(['config', 'list'], { OMNI_FORMAT: 'json' });

      expect(result.exitCode).toBe(0);
      // Should be valid JSON
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed)).toBe(true);
    });

    test('human format is default', async () => {
      const result = await runCli(['config', 'list']);

      expect(result.exitCode).toBe(0);
      // Human format has headers with dashes
      expect(result.stdout).toContain('---');
    });
  });

  describe('auth without key', () => {
    test('auth status fails when not logged in', async () => {
      const result = await runCli(['auth', 'status']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Not logged in');
    });

    test('auth logout works even when not logged in', async () => {
      const result = await runCli(['auth', 'logout']);

      expect(result.exitCode).toBe(0);
    });
  });
});

// ── Integration tests using mock API server ──
describe('CLI Integration Tests', () => {
  beforeAll(async () => {
    // Start mock API server
    const mock = await startMockApi();
    MOCK_URL = mock.url;

    // Create test config directory
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
    const omniDir = join(TEST_CONFIG_DIR, '.omni');
    if (!existsSync(omniDir)) {
      mkdirSync(omniDir, { recursive: true });
    }

    // Pre-configure with mock API URL and key
    const config = {
      apiUrl: MOCK_URL,
      apiKey: MOCK_API_KEY,
      format: 'human',
    };
    writeFileSync(join(omniDir, 'config.json'), JSON.stringify(config, null, 2));
  });

  afterAll(() => {
    stopMockApi();
    // Stop the test-mode pm2 god daemon BEFORE removing its home (issue #413).
    killTestPm2Daemon();
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe('auth', () => {
    test('auth login validates key', async () => {
      const result = await runCli(['auth', 'login', '--api-key', MOCK_API_KEY, '--api-url', MOCK_URL]);

      assertSuccess(result, 'auth login');
      expect(result.stdout).toContain('Logged in');
    });

    test('auth status shows authenticated', async () => {
      const result = await runCli(['auth', 'status']);

      assertSuccess(result, 'auth status');
      expect(result.stdout).toContain('authenticated');
    });
  });

  describe('status', () => {
    test('status shows API health', async () => {
      const result = await runCli(['status']);

      assertSuccess(result, 'status');
      expect(result.stdout).toContain('apiStatus');
      expect(result.stdout).toContain('healthy');
    });

    test('status in JSON format', async () => {
      const result = await runCliJson<{
        apiStatus: string;
        apiVersion: string;
        authenticated: boolean;
      }>(['status']);

      expect(result.apiStatus).toBe('healthy');
      expect(result.apiVersion).toBeDefined();
      expect(typeof result.authenticated).toBe('boolean');
    });
  });

  describe('instances', () => {
    let testInstanceId: string | null = null;

    test('instances list returns array', async () => {
      const result = await runCli(['instances', 'list'], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'instances list');
      const instances = JSON.parse(result.stdout);
      expect(Array.isArray(instances)).toBe(true);
    });

    test('instances create creates new instance', async () => {
      const name = `test-cli-${Date.now()}`;
      const result = await runCli(['instances', 'create', '--name', name, '--channel', 'whatsapp-baileys'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'instances create');
      const parsed = JSON.parse(result.stdout);
      expect(parsed.data?.id || parsed.id).toBeDefined();
      testInstanceId = parsed.data?.id || parsed.id;
    });

    test('instances get returns instance details', async () => {
      if (!testInstanceId) {
        return;
      }

      const result = await runCli(['instances', 'get', testInstanceId], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'instances get');
      const instance = JSON.parse(result.stdout);
      expect(instance.id).toBe(testInstanceId);
    });

    test('instances status returns connection status', async () => {
      if (!testInstanceId) {
        return;
      }

      const result = await runCli(['instances', 'status', testInstanceId], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'instances status');
      const status = JSON.parse(result.stdout);
      expect(status.instanceId).toBe(testInstanceId);
    });

    test('instances update --gupshup-handoff-options forwards the parsed JSON object', async () => {
      if (!testInstanceId) return;

      const handoffOptions = {
        defaultFields: { queue: 'SALES' },
        fieldsByPhonePrefix: [{ prefixes: ['5511', '5521'], fields: { queue: 'SALES-SOUTHEAST' } }],
        customerFields: [
          { apiKey: 'Queue', from: 'queue' },
          { apiKey: 'Handled By', value: 'assistant' },
        ],
      };
      const result = await runCli(
        ['instances', 'update', testInstanceId, '--gupshup-handoff-options', JSON.stringify(handoffOptions)],
        { OMNI_FORMAT: 'json' },
      );

      assertSuccess(result, 'instances update --gupshup-handoff-options');
      // The body the CLI built carries the object, not the raw string...
      const parsed = JSON.parse(result.stdout);
      expect(parsed.data.gupshupHandoffOptions).toEqual(handoffOptions);

      // ...and that is what reached the API's PATCH /instances/:id.
      const stored = await fetch(`${MOCK_URL}/api/v2/instances/${testInstanceId}`, {
        headers: { 'x-api-key': MOCK_API_KEY },
      });
      const instance = (await stored.json()) as { data: { gupshupHandoffOptions?: unknown } };
      expect(instance.data.gupshupHandoffOptions).toEqual(handoffOptions);
    });

    test('instances update --gupshup-handoff-options null clears the field', async () => {
      if (!testInstanceId) return;

      const result = await runCli(['instances', 'update', testInstanceId, '--gupshup-handoff-options', 'null'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'instances update --gupshup-handoff-options null');
      const parsed = JSON.parse(result.stdout);
      expect(parsed.data).toHaveProperty('gupshupHandoffOptions', null);

      const stored = await fetch(`${MOCK_URL}/api/v2/instances/${testInstanceId}`, {
        headers: { 'x-api-key': MOCK_API_KEY },
      });
      const instance = (await stored.json()) as { data: { gupshupHandoffOptions?: unknown } };
      expect(instance.data).toHaveProperty('gupshupHandoffOptions', null);
    });

    test('instances delete removes instance', async () => {
      if (!testInstanceId) {
        return;
      }

      const result = await runCli(['instances', 'delete', testInstanceId]);

      assertSuccess(result, 'instances delete');
      testInstanceId = null;
    });
  });

  describe('events', () => {
    test('events list returns events', async () => {
      const result = await runCli(['events', 'list', '--limit', '5'], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'events list');
      const events = JSON.parse(result.stdout);
      expect(Array.isArray(events)).toBe(true);
    });

    test('events list filters by type', async () => {
      const result = await runCli(['events', 'list', '--type', 'message.received', '--limit', '5'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'events list --type');
      const events = JSON.parse(result.stdout) as Array<{ type: string }>;
      // Mock returns empty array, so just verify it succeeds
      expect(Array.isArray(events)).toBe(true);
    });

    test('events list filters by since', async () => {
      const result = await runCli(['events', 'list', '--since', '24h', '--limit', '5'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'events list --since');
      const events = JSON.parse(result.stdout);
      expect(Array.isArray(events)).toBe(true);
    });

    test('events search works', async () => {
      const result = await runCli(['events', 'search', 'test', '--limit', '5'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'events search');
      const events = JSON.parse(result.stdout);
      expect(Array.isArray(events)).toBe(true);
    });

    test('events get returns full event payload as JSON', async () => {
      const seedEventId = '00000000-0000-0000-0000-0000000000e1';
      const result = await runCli(['events', 'get', seedEventId], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'events get');
      const event = JSON.parse(result.stdout) as {
        id: string;
        eventType: string;
        instanceId: string;
        direction: string;
        textContent: string | null;
      };
      expect(event.id).toBe(seedEventId);
      expect(event.eventType).toBe('message.received');
      expect(event.direction).toBe('inbound');
      expect(typeof event.instanceId).toBe('string');
    });

    test('events get respects --json flag', async () => {
      const seedEventId = '00000000-0000-0000-0000-0000000000e1';
      const result = await runCli(['events', 'get', seedEventId, '--json']);

      assertSuccess(result, 'events get --json');
      const event = JSON.parse(result.stdout) as { id: string };
      expect(event.id).toBe(seedEventId);
    });

    test('events get <missing-id> exits non-zero with not-found message', async () => {
      const missingId = '00000000-0000-0000-0000-00000000dead';
      const result = await runCli(['events', 'get', missingId]);

      expect(result.exitCode).not.toBe(0);
      const output = `${result.stdout}${result.stderr}`;
      expect(output.toLowerCase()).toContain('not found');
    });

    test('events stream emits NDJSON for seeded events then shuts down on SIGTERM', async () => {
      const { seedStreamEvent, clearStreamedEvents } = await import('./mock-api');
      clearStreamedEvents();

      const ev1 = seedStreamEvent({ eventType: 'message.received', textContent: 'stream one' });
      const ev2 = seedStreamEvent({
        eventType: 'message.sent',
        direction: 'outbound',
        textContent: 'stream two',
      });

      // --since 1h ensures the cursor starts before the seed rows; --poll-ms 200
      // keeps the loop tight so the test completes quickly.
      const proc = spawn({
        cmd: ['bun', CLI_PATH, 'events', 'stream', '--since', '1h', '--poll-ms', '200', '--ndjson'],
        env: { ...process.env, HOME: TEST_CONFIG_DIR, PM2_HOME: TEST_PM2_HOME },
        stdout: 'pipe',
        stderr: 'pipe',
      });

      // Collect up to two NDJSON lines, then terminate.
      const reader = proc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const lines: string[] = [];
      const start = Date.now();
      while (lines.length < 2 && Date.now() - start < 5000) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n');
        buffer = parts.pop() ?? '';
        for (const part of parts) {
          if (part.trim()) lines.push(part.trim());
        }
      }
      proc.kill('SIGTERM');
      await proc.exited;

      expect(lines.length).toBeGreaterThanOrEqual(2);
      const parsed = lines.slice(0, 2).map((l) => JSON.parse(l) as { id: string; eventType: string });
      const ids = parsed.map((p) => p.id);
      expect(ids).toContain(ev1.id);
      expect(ids).toContain(ev2.id);
    });
  });

  describe('chats', () => {
    test('chats list returns chats', async () => {
      const result = await runCli(['chats', 'list', '--limit', '5'], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'chats list');
      const chats = JSON.parse(result.stdout);
      expect(Array.isArray(chats)).toBe(true);
    });
  });

  describe('agents', () => {
    let testAgentId: string | null = null;

    test('agents create seeds an agent via direct API call', async () => {
      // Seed via raw fetch so we don't depend on the CLI's JSON output shape
      // (agents create currently emits success+data, which is two JSON blocks).
      const resp = await fetch(`${MOCK_URL}/api/v2/agents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': MOCK_API_KEY,
        },
        body: JSON.stringify({
          name: `test-agent-${Date.now()}`,
          provider: 'claude',
          model: 'claude-sonnet-4-6',
          agentType: 'assistant',
        }),
      });
      expect(resp.ok).toBe(true);
      const body = (await resp.json()) as { data: { id: string; model: string } };
      expect(body.data.id).toBeDefined();
      expect(body.data.model).toBe('claude-sonnet-4-6');
      testAgentId = body.data.id;
    });

    test('agents create exposes --provider-agent-id, --config-path, --metadata (#372)', async () => {
      // Locate the JSON data block from the two-block output (success + data).
      // We parse the tail JSON object, which is the agent payload.
      const result = await runCli(
        [
          'agents',
          'create',
          '--name',
          `agno-seller-${Date.now()}`,
          '--provider',
          'agno',
          '--provider-agent-id',
          'eugenia-seller',
          '--config-path',
          '/tmp/eugenia.yaml',
          '--metadata',
          JSON.stringify({ team: 'sales', tier: 'premium' }),
        ],
        { OMNI_FORMAT: 'json' },
      );
      assertSuccess(result, 'agents create with new flags');

      const blocks = result.stdout
        .split(/\n(?=\{)/)
        .map((s) => s.trim())
        .filter(Boolean);
      const last = blocks[blocks.length - 1] ?? '';
      const parsed = JSON.parse(last);
      const agent = parsed.data ?? parsed;

      expect(agent.configPath).toBe('/tmp/eugenia.yaml');
      expect(agent.metadata).toEqual({
        team: 'sales',
        tier: 'premium',
        providerAgentId: 'eugenia-seller',
      });

      // Cleanup
      if (agent.id) {
        await fetch(`${MOCK_URL}/api/v2/agents/${agent.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': MOCK_API_KEY },
        });
      }
    });

    test('agents create rejects invalid JSON in --metadata', async () => {
      const result = await runCli([
        'agents',
        'create',
        '--name',
        'bad-meta',
        '--provider',
        'agno',
        '--metadata',
        'not-json',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--metadata is not valid JSON');
    });

    test('agents create rejects non-object JSON in --metadata', async () => {
      const result = await runCli([
        'agents',
        'create',
        '--name',
        'bad-meta-array',
        '--provider',
        'agno',
        '--metadata',
        '[1,2,3]',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--metadata must be a JSON object');
    });

    test('agents create --provider-agent-id overrides providerAgentId in --metadata', async () => {
      const result = await runCli(
        [
          'agents',
          'create',
          '--name',
          `override-${Date.now()}`,
          '--provider',
          'agno',
          '--metadata',
          JSON.stringify({ providerAgentId: 'from-metadata', keep: true }),
          '--provider-agent-id',
          'from-flag',
        ],
        { OMNI_FORMAT: 'json' },
      );
      assertSuccess(result, 'agents create flag overrides metadata');

      const blocks = result.stdout
        .split(/\n(?=\{)/)
        .map((s) => s.trim())
        .filter(Boolean);
      const parsed = JSON.parse(blocks[blocks.length - 1] ?? '{}');
      const agent = parsed.data ?? parsed;

      expect(agent.metadata).toEqual({ providerAgentId: 'from-flag', keep: true });

      if (agent.id) {
        await fetch(`${MOCK_URL}/api/v2/agents/${agent.id}`, {
          method: 'DELETE',
          headers: { 'x-api-key': MOCK_API_KEY },
        });
      }
    });

    test('agents update patches model and preserves UUID', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'update', testAgentId, '--model', 'claude-opus-4-6'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'agents update --model');
      const parsed = JSON.parse(result.stdout);
      const agent = parsed.data ?? parsed;
      expect(agent.id).toBe(testAgentId);
      expect(agent.model).toBe('claude-opus-4-6');
    });

    test('agents update patches multiple fields atomically', async () => {
      if (!testAgentId) return;

      const result = await runCli(
        ['agents', 'update', testAgentId, '--name', 'renamed-agent', '--model', 'claude-sonnet-4-6'],
        { OMNI_FORMAT: 'json' },
      );

      assertSuccess(result, 'agents update --name --model');
      const parsed = JSON.parse(result.stdout);
      const agent = parsed.data ?? parsed;
      expect(agent.name).toBe('renamed-agent');
      expect(agent.model).toBe('claude-sonnet-4-6');
    });

    test('agents update with --inactive flag deactivates the agent', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'update', testAgentId, '--inactive'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'agents update --inactive');
      const parsed = JSON.parse(result.stdout);
      const agent = parsed.data ?? parsed;
      expect(agent.isActive).toBe(false);
    });

    test('agents update with no field flags fails before hitting the API', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'update', testAgentId]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No fields to update');
    });

    test('agents update with invalid provider fails with validation error', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'update', testAgentId, '--provider', 'invalid-provider']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Invalid provider');
    });

    test('agents update rejects combining --active and --inactive', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'update', testAgentId, '--active', '--inactive']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--active');
    });

    test('agents update --help renders', async () => {
      const result = await runCli(['agents', 'update', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--name');
      expect(result.stdout).toContain('--model');
      expect(result.stdout).toContain('--provider');
      expect(result.stdout).toContain('--active');
      expect(result.stdout).toContain('--inactive');
      expect(result.stdout).toContain('--provider-agent-id');
      expect(result.stdout).toContain('--config-path');
      expect(result.stdout).toContain('--metadata');
    });

    test('agents update rejects invalid JSON in --metadata (#372)', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'update', testAgentId, '--metadata', 'not-json']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--metadata is not valid JSON');
    });

    test('agents update rejects non-object JSON in --metadata (#372)', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'update', testAgentId, '--metadata', '[1,2,3]']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--metadata must be a JSON object');
    });

    test('agents update --config-path sets configPath (#372)', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'update', testAgentId, '--config-path', '/tmp/agent-config.yaml'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'agents update --config-path');
      const parsed = JSON.parse(result.stdout);
      const agent = parsed.data ?? parsed;
      expect(agent.configPath).toBe('/tmp/agent-config.yaml');
    });

    test('agents update --metadata merges into existing metadata (#372)', async () => {
      if (!testAgentId) return;

      // Seed existing metadata via raw PATCH so we can verify the merge behavior
      const seed = await fetch(`${MOCK_URL}/api/v2/agents/${testAgentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-api-key': MOCK_API_KEY },
        body: JSON.stringify({ metadata: { keepMe: 'original', tier: 'standard' } }),
      });
      expect(seed.ok).toBe(true);

      const result = await runCli(
        ['agents', 'update', testAgentId, '--metadata', JSON.stringify({ tier: 'premium', added: true })],
        { OMNI_FORMAT: 'json' },
      );

      assertSuccess(result, 'agents update --metadata merge');
      const parsed = JSON.parse(result.stdout);
      const agent = parsed.data ?? parsed;
      expect(agent.metadata).toEqual({
        keepMe: 'original', // preserved
        tier: 'premium', // overwritten
        added: true, // added
      });
    });

    test('agents update --provider-agent-id wins over --metadata providerAgentId (#372)', async () => {
      if (!testAgentId) return;

      // Reset metadata to a known state
      await fetch(`${MOCK_URL}/api/v2/agents/${testAgentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-api-key': MOCK_API_KEY },
        body: JSON.stringify({ metadata: { keep: 'yes' } }),
      });

      const result = await runCli(
        [
          'agents',
          'update',
          testAgentId,
          '--metadata',
          JSON.stringify({ providerAgentId: 'from-metadata' }),
          '--provider-agent-id',
          'from-flag',
        ],
        { OMNI_FORMAT: 'json' },
      );

      assertSuccess(result, 'agents update provider-agent-id precedence');
      const parsed = JSON.parse(result.stdout);
      const agent = parsed.data ?? parsed;
      expect(agent.metadata).toEqual({
        keep: 'yes', // preserved from existing
        providerAgentId: 'from-flag', // flag wins
      });
    });

    test('agents update --provider-agent-id only preserves existing metadata (#372)', async () => {
      if (!testAgentId) return;

      // Seed with keys we must not clobber
      await fetch(`${MOCK_URL}/api/v2/agents/${testAgentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'x-api-key': MOCK_API_KEY },
        body: JSON.stringify({ metadata: { team: 'sales', region: 'BR' } }),
      });

      const result = await runCli(['agents', 'update', testAgentId, '--provider-agent-id', 'eugenia-seller'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'agents update --provider-agent-id only');
      const parsed = JSON.parse(result.stdout);
      const agent = parsed.data ?? parsed;
      expect(agent.metadata).toEqual({
        team: 'sales',
        region: 'BR',
        providerAgentId: 'eugenia-seller',
      });
    });

    test('agents delete removes agent', async () => {
      if (!testAgentId) return;

      const result = await runCli(['agents', 'delete', testAgentId]);
      assertSuccess(result, 'agents delete');
      testAgentId = null;
    });
  });

  describe('persons', () => {
    test('persons search works', async () => {
      const result = await runCli(['persons', 'search', 'test'], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'persons search');
      const persons = JSON.parse(result.stdout);
      expect(Array.isArray(persons)).toBe(true);
    });
  });

  describe('settings', () => {
    test('settings list returns settings', async () => {
      const result = await runCli(['settings', 'list'], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'settings list');
      const settings = JSON.parse(result.stdout);
      expect(Array.isArray(settings)).toBe(true);
    });
  });

  describe('logs', () => {
    test('logs --json emits raw LogEntry[] with data fields preserved', async () => {
      const result = await runCli(['logs', 'error', '--json']);

      assertSuccess(result, 'logs error --json');
      const entries = JSON.parse(result.stdout) as Array<{
        time: number;
        level: string;
        module: string;
        msg: string;
        data?: Record<string, unknown>;
      }>;
      expect(Array.isArray(entries)).toBe(true);
      expect(entries.length).toBeGreaterThan(0);
      // All entries should be error level (filtered by arg)
      const errorEntry = entries.find((e) => e.level === 'error');
      expect(errorEntry).toBeDefined();
      expect(errorEntry?.data).toBeDefined();
      // Rich context must survive JSON serialization end-to-end
      expect(errorEntry?.data?.agentId).toBe('00000000-0000-0000-0000-0000000000a1');
      expect(errorEntry?.data?.chatId).toBe('00000000-0000-0000-0000-0000000000c1');
      expect(typeof errorEntry?.data?.stack).toBe('string');
      expect(errorEntry?.data?.stack as string).toContain('at authenticate');
    });

    test('logs --json emits valid parseable JSON with no summary line', async () => {
      const result = await runCli(['logs', '--json']);

      assertSuccess(result, 'logs --json');
      // stdout should be a single JSON array, nothing else
      const parsed = JSON.parse(result.stdout);
      expect(Array.isArray(parsed)).toBe(true);
      // Summary line from default mode must NOT appear
      expect(result.stdout).not.toContain('Showing ');
      expect(result.stdout).not.toContain('buffer:');
    });

    test('logs --verbose shows multi-line entries with stack traces', async () => {
      const result = await runCli(['logs', 'error', '--verbose']);

      assertSuccess(result, 'logs error --verbose');
      // Multi-line body: module, msg, and each data key on its own line
      expect(result.stdout).toContain('whatsapp:auth');
      expect(result.stdout).toContain('Failed to authenticate session');
      expect(result.stdout).toContain('agentId:');
      expect(result.stdout).toContain('chatId:');
      expect(result.stdout).toContain('at authenticate');
    });

    test('logs (default mode) renders truncated table unchanged', async () => {
      const result = await runCli(['logs']);

      assertSuccess(result, 'logs');
      // Default mode still emits the summary line
      expect(result.stdout).toContain('Showing ');
      expect(result.stdout).toContain('buffer:');
    });

    test('logs --help renders with --json and --verbose flags documented', async () => {
      const result = await runCli(['logs', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--json');
      expect(result.stdout).toContain('--verbose');
    });
  });

  describe('send (error cases)', () => {
    test('send without instance fails gracefully', async () => {
      // First unset default instance
      await runCli(['config', 'unset', 'defaultInstance']);

      const result = await runCli(['send', '--to', '+1234567890', '--text', 'test']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No instance');
    });

    test('send without recipient fails gracefully', async () => {
      const result = await runCli(['send', '--instance', '00000000-0000-0000-0000-000000000099', '--text', 'test']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--to');
    });

    test('send without message type fails gracefully', async () => {
      const result = await runCli([
        'send',
        '--instance',
        '00000000-0000-0000-0000-000000000099',
        '--to',
        '+1234567890',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No message type');
    });
  });
});

// ── Multi-server registry tests (wish: multi-server-management, Group 2) ──
//
// Fully isolated from the suites above: its own HOME (so its own
// `~/.omni/config.json` AND `~/.omni/keys/`) and its own two mock servers, so
// the trust-handshake tests can bind a keypair without leaking signing headers
// into the single-server suites.
//
// The tests inside are ordered as a narrative — `add` seeds the entries that
// the later `use` / `remove` / handshake cases operate on.
describe('CLI Multi-Server Tests', () => {
  let MS_HOME = '';
  let serverA: MockApiHandle;
  let serverB: MockApiHandle;

  /** Run the CLI against the multi-server HOME. */
  async function ms(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
    const proc = spawn({
      cmd: ['bun', CLI_PATH, ...args],
      env: { ...process.env, HOME: MS_HOME, PM2_HOME: join(MS_HOME, '.pm2'), ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;
    return { stdout, stderr, exitCode };
  }

  async function msJson<T>(args: string[]): Promise<T> {
    const result = await ms([...args, '--json']);
    if (result.exitCode !== 0) {
      throw new Error(`CLI failed (${result.exitCode}): ${result.stderr || result.stdout}`);
    }
    return JSON.parse(result.stdout) as T;
  }

  interface ServerRow {
    name: string;
    url: string;
    apiKey: string;
    active: boolean;
  }

  function hostJson(): {
    pubkey: string;
    hostId: string;
    boundServers?: Array<{ url: string; hostId: string }>;
  } {
    return JSON.parse(readFileSync(join(MS_HOME, '.omni', 'keys', 'host.json'), 'utf-8'));
  }

  beforeAll(() => {
    MS_HOME = mkdtempSync(join(tmpdir(), '.omni-multiserver-'));
    mkdirSync(join(MS_HOME, '.omni'), { recursive: true });
    serverA = startMockApiInstance();
    serverB = startMockApiInstance();

    writeFileSync(
      join(MS_HOME, '.omni', 'config.json'),
      JSON.stringify(
        {
          apiUrl: serverA.url,
          apiKey: MOCK_API_KEY,
          format: 'human',
          servers: {
            active: 'default',
            list: { default: { url: serverA.url, apiKey: MOCK_API_KEY } },
          },
        },
        null,
        2,
      ),
    );
  });

  afterAll(() => {
    serverA?.close();
    serverB?.close();
    if (MS_HOME && existsSync(MS_HOME)) {
      rmSync(MS_HOME, { recursive: true, force: true });
    }
  });

  describe('server add', () => {
    test('add verifies the target and persists it', async () => {
      const result = await ms(['server', 'add', 'prod', serverB.url, '--api-key', MOCK_API_KEY]);

      assertSuccess(result, 'server add prod');
      const rows = await msJson<ServerRow[]>(['server', 'list']);
      const prod = rows.find((r) => r.name === 'prod');
      expect(prod).toBeDefined();
      expect(prod?.url).toBe(serverB.url);
      // Added, not activated — `--use` / `server use` is the explicit switch.
      expect(prod?.active).toBe(false);
    });

    test('add aborts with an unreachable error when the URL does not answer', async () => {
      const result = await ms(['server', 'add', 'dead', 'http://127.0.0.1:1', '--api-key', MOCK_API_KEY]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('unreachable');
      const rows = await msJson<ServerRow[]>(['server', 'list']);
      expect(rows.find((r) => r.name === 'dead')).toBeUndefined();
    });

    test('add aborts with an unauthorized error when the key is rejected', async () => {
      const result = await ms(['server', 'add', 'badkey', serverA.url, '--api-key', 'not-a-real-key']);

      expect(result.exitCode).not.toBe(0);
      // Distinct from the unreachable path — the server answered, the key did not.
      expect(result.stderr).toContain('unauthorized');
      expect(result.stderr).not.toContain('unreachable');
      const rows = await msJson<ServerRow[]>(['server', 'list']);
      expect(rows.find((r) => r.name === 'badkey')).toBeUndefined();
    });

    test('add stores the trimmed name so lookups can reach it', async () => {
      const result = await ms(['server', 'add', '  padded  ', serverB.url, '--api-key', MOCK_API_KEY]);
      assertSuccess(result, 'server add "  padded  "');

      const rows = await msJson<ServerRow[]>(['server', 'list']);
      expect(rows.find((r) => r.name === 'padded')).toBeDefined();
      expect(rows.find((r) => r.name === '  padded  ')).toBeUndefined();

      assertSuccess(await ms(['server', 'current', '--server', 'padded']), 'target the trimmed entry');
      await ms(['server', 'remove', 'padded']);
    });

    test('add --skip-verify persists without probing', async () => {
      const result = await ms(['server', 'add', 'offline', 'http://127.0.0.1:1', '--skip-verify']);

      assertSuccess(result, 'server add --skip-verify');
      const rows = await msJson<ServerRow[]>(['server', 'list']);
      expect(rows.find((r) => r.name === 'offline')?.url).toBe('http://127.0.0.1:1');

      await ms(['server', 'remove', 'offline']);
    });
  });

  describe('server list masking', () => {
    test('list masks API keys in human and JSON output', async () => {
      const human = await ms(['server', 'list']);
      assertSuccess(human, 'server list');
      expect(human.stdout).not.toContain(MOCK_API_KEY);

      const rows = await msJson<ServerRow[]>(['server', 'list']);
      for (const row of rows) {
        expect(row.apiKey).not.toBe(MOCK_API_KEY);
      }
      expect(rows.find((r) => r.name === 'default')?.apiKey).toBe(`${MOCK_API_KEY.slice(0, 12)}...`);
    });

    test('list --reveal prints full API keys', async () => {
      const rows = await msJson<ServerRow[]>(['server', 'list', '--reveal']);
      expect(rows.find((r) => r.name === 'default')?.apiKey).toBe(MOCK_API_KEY);
    });
  });

  describe('--server flag', () => {
    test('one-shot --server targets an entry without persisting it', async () => {
      const overridden = await msJson<{ name: string; active: string; overridden: boolean }>([
        'server',
        'current',
        '--server',
        'prod',
      ]);
      expect(overridden.name).toBe('prod');
      expect(overridden.active).toBe('default');
      expect(overridden.overridden).toBe(true);

      // The very next invocation is back on the persisted active entry.
      const after = await msJson<{ name: string; active: string; overridden: boolean }>(['server', 'current']);
      expect(after.name).toBe('default');
      expect(after.active).toBe('default');
      expect(after.overridden).toBe(false);
    });

    test('--server=<name> form works too', async () => {
      const current = await msJson<{ name: string }>(['server', 'current', '--server=prod']);
      expect(current.name).toBe('prod');
    });

    test('--server routes the request to that server', async () => {
      clearRecordedRequests();
      const result = await ms(['instances', 'list', '--server', 'prod']);

      assertSuccess(result, 'instances list --server prod');
      const origins = getRecordedRequests().map((r) => r.origin);
      expect(origins).toContain(serverB.url);
      expect(origins).not.toContain(serverA.url);
    });

    test('unknown --server exits non-zero listing known entries', async () => {
      const result = await ms(['--server', 'nope', 'server', 'list']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Unknown server 'nope'");
      expect(result.stderr).toContain('default');
      expect(result.stderr).toContain('prod');
    });

    test('--server without a value exits non-zero', async () => {
      const result = await ms(['server', 'list', '--server']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--server requires a server name');
    });

    test('repeating --server exits non-zero instead of corrupting argv', async () => {
      const result = await ms(['instances', 'list', '--server', 'prod', '--server', 'default']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('duplicate --server flag');
    });

    test('--server with a flag-like value exits non-zero', async () => {
      const result = await ms(['server', 'list', '--server', '--json']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--server requires a server name');
    });
  });

  describe('server use / remove / current', () => {
    test('use switches the persisted active entry', async () => {
      const result = await ms(['server', 'use', 'prod']);
      assertSuccess(result, 'server use prod');

      const current = await msJson<{ name: string; active: string }>(['server', 'current']);
      expect(current.name).toBe('prod');
      expect(current.active).toBe('prod');

      await ms(['server', 'use', 'default']);
    });

    test('use with an unknown name exits non-zero listing known entries', async () => {
      const result = await ms(['server', 'use', 'ghost']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("Unknown server 'ghost'");
      expect(result.stderr).toContain('default');
    });

    test('remove refuses to drop the active entry without --force', async () => {
      const result = await ms(['server', 'remove', 'default']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('active server');
      const rows = await msJson<ServerRow[]>(['server', 'list']);
      expect(rows.find((r) => r.name === 'default')).toBeDefined();
    });

    test('remove --force drops the active entry and falls back to another', async () => {
      await ms(['server', 'add', 'scratch', serverB.url, '--api-key', MOCK_API_KEY, '--use']);
      expect((await msJson<{ active: string }>(['server', 'current'])).active).toBe('scratch');

      const refused = await ms(['server', 'remove', 'scratch']);
      expect(refused.exitCode).not.toBe(0);

      const forced = await ms(['server', 'remove', 'scratch', '--force']);
      assertSuccess(forced, 'server remove --force');

      const current = await msJson<{ active: string }>(['server', 'current']);
      expect(current.active).toBe('default');
      const rows = await msJson<ServerRow[]>(['server', 'list']);
      expect(rows.find((r) => r.name === 'scratch')).toBeUndefined();
    });
  });

  describe('auth scoping', () => {
    test('a keyless entry errors with the --server-scoped login hint', async () => {
      await ms(['server', 'add', 'keyless', serverB.url]);

      const result = await ms(['instances', 'list', '--server', 'keyless']);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('keyless');
      expect(result.stderr).toContain('omni auth login --server keyless');
    });

    test('auth login --server writes the key into that entry only', async () => {
      const result = await ms(['auth', 'login', '--server', 'keyless', '--api-key', MOCK_API_KEY]);
      assertSuccess(result, 'auth login --server keyless');

      const rows = await msJson<ServerRow[]>(['server', 'list', '--reveal']);
      expect(rows.find((r) => r.name === 'keyless')?.apiKey).toBe(MOCK_API_KEY);
      // Untargeted entries keep whatever they had.
      expect(rows.find((r) => r.name === 'default')?.apiKey).toBe(MOCK_API_KEY);
      expect(rows.find((r) => r.name === 'keyless')?.url).toBe(serverB.url);
    });

    test('auth logout --server clears only that entry key', async () => {
      const result = await ms(['auth', 'logout', '--server', 'keyless']);
      assertSuccess(result, 'auth logout --server keyless');

      const rows = await msJson<ServerRow[]>(['server', 'list', '--reveal']);
      expect(rows.find((r) => r.name === 'keyless')?.apiKey).toBe('-');
      expect(rows.find((r) => r.name === 'default')?.apiKey).toBe(MOCK_API_KEY);
      expect(rows.find((r) => r.name === 'prod')?.apiKey).toBe(MOCK_API_KEY);
    });

    test('auth status names the targeted server', async () => {
      const result = await ms(['auth', 'status']);
      assertSuccess(result, 'auth status');
      expect(result.stdout).toContain('authenticated');
      expect(result.stdout).toContain('default');
    });
  });

  describe('trust handshake server binding', () => {
    test('handshake binds the targeted server only', async () => {
      const result = await ms(['trust', 'handshake']);
      assertSuccess(result, 'trust handshake');

      const meta = hostJson();
      expect(meta.boundServers).toEqual([{ url: serverA.url, hostId: meta.hostId }]);
    });

    test('requests to a non-bound server are sent unsigned and still succeed', async () => {
      clearRecordedRequests();
      const result = await ms(['instances', 'list', '--server', 'prod']);

      assertSuccess(result, 'instances list --server prod (unsigned)');
      const toB = getRecordedRequests().filter((r) => r.origin === serverB.url);
      expect(toB.length).toBeGreaterThan(0);
      expect(toB.every((r) => r.signed === false)).toBe(true);
    });

    test('requests to the bound server stay signed', async () => {
      clearRecordedRequests();
      const result = await ms(['instances', 'list']);

      assertSuccess(result, 'instances list (signed)');
      const toA = getRecordedRequests().filter((r) => r.origin === serverA.url);
      expect(toA.length).toBeGreaterThan(0);
      expect(toA.every((r) => r.signed === true)).toBe(true);
      expect(toA[0].hostId).toBe(hostJson().hostId);
    });

    test('re-handshaking against another server binds it without rotating', async () => {
      const before = hostJson();

      const result = await ms(['trust', 'handshake', '--server', 'prod']);
      assertSuccess(result, 'trust handshake --server prod');
      expect(result.stdout).toContain('no rotation');

      const after = hostJson();
      expect(after.pubkey).toBe(before.pubkey);
      // The top-level id belongs to the FIRST server (A) and must survive
      // binding B: stamping B's id here made every later request to A carry an
      // id A never issued → 401 unknown host.
      expect(after.hostId).toBe(before.hostId);

      const bindings = after.boundServers ?? [];
      expect(bindings.map((b) => b.url)).toEqual([serverA.url, serverB.url]);
      // Each server issues its own row, so the ids differ.
      const idForA = bindings[0].hostId;
      const idForB = bindings[1].hostId;
      expect(idForA).toBe(before.hostId);
      expect(idForB).not.toBe(idForA);

      // Both servers now sign — binding B did not unbind A — and each request
      // carries the id THAT server issued.
      clearRecordedRequests();
      assertSuccess(await ms(['instances', 'list', '--server', 'prod']), 'signed against prod');
      assertSuccess(await ms(['instances', 'list']), 'signed against default');
      const recorded = getRecordedRequests().filter((r) => r.path === '/api/v2/instances');
      expect(recorded.length).toBeGreaterThanOrEqual(2);
      expect(recorded.every((r) => r.signed === true)).toBe(true);

      const toA = recorded.filter((r) => r.origin === serverA.url);
      const toB = recorded.filter((r) => r.origin === serverB.url);
      expect(toA.length).toBeGreaterThan(0);
      expect(toB.length).toBeGreaterThan(0);
      expect(toA.every((r) => r.hostId === idForA)).toBe(true);
      expect(toB.every((r) => r.hostId === idForB)).toBe(true);
    });

    test('an already-bound handshake reports the bound servers', async () => {
      const result = await ms(['trust', 'handshake']);

      assertSuccess(result, 'trust handshake (already bound)');
      expect(result.stdout).toContain('Already handshook');
      expect(result.stdout).toContain(serverA.url);
      expect(result.stdout).toContain(serverB.url);
      expect(result.stdout).toContain('UNSIGNED');
    });
  });
});
