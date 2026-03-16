/**
 * Providers Genie E2E Tests
 *
 * Tests genie provider CLI support (issue #203) and setup wizard (issue #204).
 * Runs against mock API server — no live API required.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'bun';
import { MOCK_API_KEY, startMockApi, stopMockApi } from './mock-api';

const CLI_PATH = join(import.meta.dir, '../index.ts');
const TEST_CONFIG_DIR = join(tmpdir(), `.omni-genie-test-${Date.now()}`);

let MOCK_URL = '';

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const proc = spawn({
    cmd: ['bun', CLI_PATH, ...args],
    env: {
      ...process.env,
      HOME: TEST_CONFIG_DIR,
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

function assertSuccess(result: CliResult, context: string): void {
  if (result.exitCode !== 0) {
    throw new Error(`${context} failed (exit ${result.exitCode})\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
  }
}

/**
 * Parse multi-line JSON output from CLI.
 * The CLI in JSON mode outputs multiple pretty-printed JSON objects.
 * Split on lines starting with '{' and try to parse each block.
 */
function parseJsonLines(stdout: string): unknown[] {
  const blocks = stdout.split(/\n(?=\{)/);
  const results: unknown[] = [];
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      results.push(JSON.parse(trimmed));
    } catch {
      /* skip incomplete blocks */
    }
  }
  return results;
}

/** Extract provider data from CLI JSON output (from success or data output) */
function extractProviderData(stdout: string): Record<string, unknown> {
  const objects = parseJsonLines(stdout);
  // Look for success response with data, or raw provider object with id
  for (const obj of objects) {
    const o = obj as Record<string, unknown>;
    if (o.data && typeof o.data === 'object' && (o.data as Record<string, unknown>).id) {
      return o.data as Record<string, unknown>;
    }
    if (o.id && o.schema) {
      return o;
    }
  }
  throw new Error(`No provider data found in output: ${stdout}`);
}

describe('Providers Genie E2E', () => {
  beforeAll(async () => {
    const mock = await startMockApi();
    MOCK_URL = mock.url;

    if (!existsSync(TEST_CONFIG_DIR)) {
      mkdirSync(TEST_CONFIG_DIR, { recursive: true });
    }
    const omniDir = join(TEST_CONFIG_DIR, '.omni');
    if (!existsSync(omniDir)) {
      mkdirSync(omniDir, { recursive: true });
    }

    writeFileSync(
      join(omniDir, 'config.json'),
      JSON.stringify({ apiUrl: MOCK_URL, apiKey: MOCK_API_KEY, format: 'human' }, null, 2),
    );
  });

  afterAll(() => {
    stopMockApi();
    if (existsSync(TEST_CONFIG_DIR)) {
      rmSync(TEST_CONFIG_DIR, { recursive: true, force: true });
    }
  });

  // ============================================================================
  // Issue #203 — CLI genie provider support
  // ============================================================================

  describe('providers create (genie)', () => {
    test('creates genie provider with all required flags', async () => {
      const result = await runCli(
        [
          'providers',
          'create',
          '--name',
          'test-genie',
          '--schema',
          'genie',
          '--base-url',
          'file:///home/genie/.claude/teams',
          '--agent-name',
          'omni',
          '--target-agent',
          'team-lead',
          '--team-name',
          'workspace-{chat_id}',
        ],
        { OMNI_FORMAT: 'json' },
      );

      assertSuccess(result, 'providers create genie');
      const provider = extractProviderData(result.stdout);
      expect(provider.id).toBeDefined();
      expect(provider.schema).toBe('genie');
      expect(provider.schemaConfig).toMatchObject({
        agentName: 'omni',
        targetAgent: 'team-lead',
        teamName: 'workspace-{chat_id}',
      });
    });

    test('creates genie provider with default team-name', async () => {
      const result = await runCli(
        [
          'providers',
          'create',
          '--name',
          'test-genie-default-team',
          '--schema',
          'genie',
          '--base-url',
          'file:///home/genie/.claude/teams',
          '--agent-name',
          'myagent',
          '--target-agent',
          'team-lead',
        ],
        { OMNI_FORMAT: 'json' },
      );

      assertSuccess(result, 'providers create genie default team');
      const provider = extractProviderData(result.stdout);
      const config = provider.schemaConfig as Record<string, unknown>;
      expect(config.teamName).toBe('omni-{chat_id}');
    });

    test('fails without --agent-name', async () => {
      const result = await runCli([
        'providers',
        'create',
        '--name',
        'bad-genie',
        '--schema',
        'genie',
        '--base-url',
        'file:///tmp',
        '--target-agent',
        'team-lead',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--agent-name');
    });

    test('fails without --target-agent', async () => {
      const result = await runCli([
        'providers',
        'create',
        '--name',
        'bad-genie-2',
        '--schema',
        'genie',
        '--base-url',
        'file:///tmp',
        '--agent-name',
        'omni',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--target-agent');
    });
  });

  // ============================================================================
  // Issue #203 — providers update with PATCH
  // ============================================================================

  describe('providers update', () => {
    let providerId: string;

    test('create provider for update tests', async () => {
      const result = await runCli(
        [
          'providers',
          'create',
          '--name',
          'update-test-genie',
          '--schema',
          'genie',
          '--base-url',
          'file:///home/genie/.claude/teams',
          '--agent-name',
          'omni',
          '--target-agent',
          'team-lead',
          '--team-name',
          'test-{chat_id}',
        ],
        { OMNI_FORMAT: 'json' },
      );

      assertSuccess(result, 'create provider for update');
      const provider = extractProviderData(result.stdout);
      providerId = provider.id as string;
      expect(providerId).toBeDefined();
    });

    test('updates provider team-name via individual flag', async () => {
      const result = await runCli(['providers', 'update', providerId, '--team-name', 'new-{chat_id}-{thread_id}'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'providers update --team-name');
      const provider = extractProviderData(result.stdout);
      const config = provider.schemaConfig as Record<string, unknown>;
      expect(config.teamName).toBe('new-{chat_id}-{thread_id}');
    });

    test('updates provider name', async () => {
      const result = await runCli(['providers', 'update', providerId, '--name', 'renamed-genie'], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'providers update --name');
      const provider = extractProviderData(result.stdout);
      expect(provider.name).toBe('renamed-genie');
    });

    test('updates provider via raw --schema-config JSON', async () => {
      const rawConfig = JSON.stringify({
        agentName: 'new-agent',
        targetAgent: 'new-target',
        teamName: 'raw-{sender_id}',
      });
      const result = await runCli(['providers', 'update', providerId, '--schema-config', rawConfig], {
        OMNI_FORMAT: 'json',
      });

      assertSuccess(result, 'providers update --schema-config');
      const provider = extractProviderData(result.stdout);
      const config = provider.schemaConfig as Record<string, unknown>;
      expect(config.agentName).toBe('new-agent');
      expect(config.targetAgent).toBe('new-target');
      expect(config.teamName).toBe('raw-{sender_id}');
    });

    test('update with no flags fails with clear error', async () => {
      const result = await runCli(['providers', 'update', providerId]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('No fields to update');
    });

    test('update with invalid --schema-config JSON fails', async () => {
      const result = await runCli(['providers', 'update', providerId, '--schema-config', 'not-json{{{']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('Invalid JSON');
    });
  });

  // ============================================================================
  // Issue #204 — Setup wizard
  // ============================================================================

  describe('providers setup genie', () => {
    test('non-interactive with all flags creates provider', async () => {
      const result = await runCli([
        'providers',
        'setup',
        'genie',
        '--non-interactive',
        '--agent-name',
        'wizard-agent',
        '--target-agent',
        'team-lead',
        '--team-name',
        'wizard-{chat_id}',
        '--name',
        'wizard-genie',
        '--base-url',
        'file:///home/genie/.claude/teams',
      ]);

      assertSuccess(result, 'providers setup genie non-interactive');
      const allOutput = result.stdout + result.stderr;
      expect(allOutput).toContain('Provider created');
      expect(allOutput).toContain('wizard-genie');
      expect(allOutput).toContain('wizard-agent');
      expect(allOutput).toContain('team-lead');
      expect(allOutput).toContain('wizard-{chat_id}');
    });

    test('non-interactive uses defaults for optional flags', async () => {
      const result = await runCli([
        'providers',
        'setup',
        'genie',
        '--non-interactive',
        '--agent-name',
        'default-test',
        '--target-agent',
        'team-lead',
      ]);

      assertSuccess(result, 'providers setup genie defaults');
      const allOutput = result.stdout + result.stderr;
      // Default name: genie-<agent-name>
      expect(allOutput).toContain('genie-default-test');
      // Default base URL
      expect(allOutput).toContain('file:///home/genie/.claude/teams');
      // Default team-name: <agent-name>-{chat_id}
      expect(allOutput).toContain('default-test-{chat_id}');
    });

    test('non-interactive without --agent-name fails with clear error', async () => {
      const result = await runCli(['providers', 'setup', 'genie', '--non-interactive', '--target-agent', 'team-lead']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--agent-name');
    });

    test('non-interactive without --target-agent fails with clear error', async () => {
      const result = await runCli(['providers', 'setup', 'genie', '--non-interactive', '--agent-name', 'test']);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('--target-agent');
    });

    test('non-interactive with invalid --instance-id fails', async () => {
      const result = await runCli([
        'providers',
        'setup',
        'genie',
        '--non-interactive',
        '--agent-name',
        'test',
        '--target-agent',
        'team-lead',
        '--instance-id',
        'not-a-uuid',
      ]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain('UUID');
    });

    test('health check runs after creation', async () => {
      const result = await runCli([
        'providers',
        'setup',
        'genie',
        '--non-interactive',
        '--agent-name',
        'health-test',
        '--target-agent',
        'team-lead',
      ]);

      assertSuccess(result, 'providers setup genie health');
      // Health check output (mock returns healthy)
      const allOutput = result.stdout + result.stderr;
      expect(allOutput).toContain('healthy');
    });

    test('shows next steps and how-it-works info', async () => {
      const result = await runCli([
        'providers',
        'setup',
        'genie',
        '--non-interactive',
        '--agent-name',
        'info-test',
        '--target-agent',
        'team-lead',
      ]);

      assertSuccess(result, 'providers setup genie info');
      const allOutput = result.stdout + result.stderr;
      expect(allOutput).toContain('How it works');
      expect(allOutput).toContain('inboxes');
      expect(allOutput).toContain('Next steps');
      expect(allOutput).toContain('omni providers test');
      expect(allOutput).toContain('omni providers update');
    });
  });

  // ============================================================================
  // Help output coverage
  // ============================================================================

  describe('help output', () => {
    test('providers create --help shows genie flags', async () => {
      const result = await runCli(['providers', 'create', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--agent-name');
      expect(result.stdout).toContain('--target-agent');
      expect(result.stdout).toContain('--team-name');
      expect(result.stdout).toContain('genie');
    });

    test('providers update --help shows genie flags', async () => {
      const result = await runCli(['providers', 'update', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--agent-name');
      expect(result.stdout).toContain('--target-agent');
      expect(result.stdout).toContain('--team-name');
      expect(result.stdout).toContain('--schema-config');
    });

    test('providers setup genie --help shows all options', async () => {
      const result = await runCli(['providers', 'setup', 'genie', '--help']);

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('--agent-name');
      expect(result.stdout).toContain('--target-agent');
      expect(result.stdout).toContain('--team-name');
      expect(result.stdout).toContain('--non-interactive');
      expect(result.stdout).toContain('--base-url');
      expect(result.stdout).toContain('--instance-id');
    });
  });
});
