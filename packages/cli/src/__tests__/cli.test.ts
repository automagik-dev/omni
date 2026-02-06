/**
 * CLI Integration Tests
 *
 * These tests verify the CLI works correctly against a running API.
 * The CLI is spawned as a subprocess to test real-world usage.
 *
 * Basic tests run without API:
 *   bun test
 *
 * Full integration tests require:
 *   1. API running at http://localhost:8881 (or API_URL env var)
 *   2. Valid API key (set API_KEY env var)
 *
 * Run full integration tests:
 *   API_KEY=your-key RUN_INTEGRATION_TESTS=1 bun test
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';

const CLI_PATH = join(import.meta.dir, '../../bin/omni');
const API_URL = process.env.API_URL || 'http://localhost:8882';
const API_KEY = process.env.OMNI_API_KEY || process.env.API_KEY || 'test-key';

// Temp config dir for tests
const TEST_CONFIG_DIR = join(tmpdir(), `.omni-test-${Date.now()}`);

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
      expect(result.stdout).toContain('CLI for Omni v2');
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

// Integration tests that require a running API
// Skip if RUN_INTEGRATION_TESTS is not set, OR if API_KEY is the default test-key
const shouldRunIntegration = process.env.RUN_INTEGRATION_TESTS && API_KEY !== 'test-key';

describe.skipIf(!shouldRunIntegration)('CLI Integration Tests', () => {
  beforeAll(async () => {
    if (!shouldRunIntegration) return;

    // Create test config directory
    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
    const omniDir = join(TEST_CONFIG_DIR, '.omni');
    if (!existsSync(omniDir)) {
      mkdirSync(omniDir, { recursive: true });
    }

    // Pre-configure with API URL and key
    const config = {
      apiUrl: API_URL,
      apiKey: API_KEY,
      format: 'human',
    };
    writeFileSync(join(omniDir, 'config.json'), JSON.stringify(config, null, 2));
  });

  afterAll(() => {
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  describe('auth', () => {
    test('auth login validates key', async () => {
      const result = await runCli(['auth', 'login', '--api-key', API_KEY, '--api-url', API_URL]);

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
      for (const event of events) {
        expect(event.type).toBe('message.received');
      }
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
  });

  describe('chats', () => {
    test('chats list returns chats', async () => {
      const result = await runCli(['chats', 'list', '--limit', '5'], { OMNI_FORMAT: 'json' });

      assertSuccess(result, 'chats list');
      const chats = JSON.parse(result.stdout);
      expect(Array.isArray(chats)).toBe(true);
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

  describe('send (error cases)', () => {
    test('send without instance fails gracefully', async () => {
      // First unset default instance
      await runCli(['config', 'unset', 'defaultInstance']);

      const result = await runCli(['send', '--to', '+1234567890', '--text', 'test']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No instance');
    });

    test('send without recipient fails gracefully', async () => {
      const result = await runCli(['send', '--instance', 'fake-id', '--text', 'test']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--to');
    });

    test('send without message type fails gracefully', async () => {
      const result = await runCli(['send', '--instance', 'fake-id', '--to', '+1234567890']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No message type');
    });
  });
});
