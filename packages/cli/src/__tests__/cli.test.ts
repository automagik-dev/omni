/**
 * CLI Integration Tests
 *
 * These tests verify the CLI works correctly against a mock API server.
 * The CLI is spawned as a subprocess to test real-world usage.
 *
 * All tests run automatically — no env vars required.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';
import { MOCK_API_KEY, startMockApi, stopMockApi } from './mock-api';

// Use source entry point directly — avoids stale dist/index.js issues
const CLI_PATH = join(import.meta.dir, '../index.ts');

// Temp config dir for tests
const TEST_CONFIG_DIR = join(tmpdir(), `.omni-test-${Date.now()}`);

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
