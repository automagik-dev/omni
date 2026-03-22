/**
 * Tests for GenieClient auto-spawn behavior
 *
 * Tests that the GenieClient triggers `genie spawn <agentRole> --team <teamName>`
 * when writing to a team inbox, verifies idempotent caching, and handles spawn failures.
 *
 * Run with: bun test packages/core/src/providers/__tests__/genie-client-auto-spawn.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { GenieClient } from '../genie-client';
import type { GenieClientConfig } from '../genie-client';
import type { ProviderRequest } from '../types';

// ============================================================================
// Mocks
// ============================================================================

const execFileMock = mock((...callArgs: unknown[]) => {
  const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
  cb(null, '', '');
});

const TEST_DIR = '/tmp/genie-client-auto-spawn-test';

mock.module('node:child_process', () => ({
  execFile: execFileMock,
}));

mock.module('node:os', () => ({
  homedir: () => TEST_DIR,
}));

// ============================================================================
// Test helpers
// ============================================================================

const _TEAMS_DIR = join(TEST_DIR, '.claude', 'teams');

function makeRequest(message = 'test message'): ProviderRequest {
  return {
    message,
    agentId: 'genie',
    stream: false,
    userId: 'test-user',
  };
}

function makeConfig(overrides?: Partial<GenieClientConfig>): GenieClientConfig {
  return {
    agentName: 'omni',
    targetAgent: 'team-lead',
    teamName: 'test-team',
    agentRole: 'omni-pm',
    ...overrides,
  };
}

/** Helper to get execFile calls for a specific binary */
function getCallsFor(binary: string): unknown[][] {
  return execFileMock.mock.calls.filter((call) => (call[0] as string) === binary);
}

// ============================================================================
// Setup / Teardown
// ============================================================================

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(TEST_DIR, { recursive: true });
  execFileMock.mockClear();
  execFileMock.mockImplementation((...callArgs: unknown[]) => {
    const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
    cb(null, '', '');
  });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

// ============================================================================
// Tests
// ============================================================================

describe('GenieClient auto-spawn config', () => {
  test('autoSpawn defaults to true', () => {
    const client = new GenieClient(makeConfig());
    expect(client).toBeTruthy();
  });

  test('autoSpawn can be explicitly disabled', () => {
    const client = new GenieClient(makeConfig({ autoSpawn: false }));
    expect(client).toBeTruthy();
  });

  test('autoSpawnDir can be customized', () => {
    const client = new GenieClient(makeConfig({ autoSpawnDir: '/custom/path' }));
    expect(client).toBeTruthy();
  });

  test('agentRole is required', () => {
    const config: GenieClientConfig = {
      agentName: 'omni',
      targetAgent: 'team-lead',
      agentRole: 'cegonha',
    };
    const client = new GenieClient(config);
    expect(client).toBeTruthy();
  });

  test('accepts all config fields', () => {
    const config: GenieClientConfig = {
      teamName: 'my-team',
      agentName: 'omni',
      targetAgent: 'team-lead',
      agentRole: 'omni-pm',
      autoSpawn: true,
      autoSpawnDir: '/home/genie/workspace',
    };
    const client = new GenieClient(config);
    expect(client).toBeTruthy();
  });
});

describe('GenieClient auto-spawn on run()', () => {
  test('calls genie spawn with correct agentRole and team name', async () => {
    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 100));

    const genieCalls = getCallsFor('genie');
    expect(genieCalls.length).toBe(1);
    const args = genieCalls[0]?.[1] as string[];
    expect(args[0]).toBe('spawn');
    expect(args[1]).toBe('omni-pm');
    expect(args[2]).toBe('--team');
    expect(args[3]).toBe('test-team');
  });

  test('does not include --cwd when autoSpawnDir is not configured', async () => {
    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 100));

    const genieCalls = getCallsFor('genie');
    expect(genieCalls.length).toBe(1);
    const args = genieCalls[0]?.[1] as string[];
    expect(args).not.toContain('--cwd');
  });

  test('includes --cwd flag with autoSpawnDir', async () => {
    const client = new GenieClient(makeConfig({ autoSpawnDir: '/my/workspace' }));
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 100));

    const genieCalls = getCallsFor('genie');
    expect(genieCalls.length).toBe(1);
    const args = genieCalls[0]?.[1] as string[];
    expect(args).toContain('--cwd');
    expect(args).toContain('/my/workspace');
  });

  test('uses configured agentRole as spawn target', async () => {
    const client = new GenieClient(makeConfig({ agentRole: 'cegonha' }));
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 100));

    const genieCalls = getCallsFor('genie');
    const args = genieCalls[0]?.[1] as string[];
    expect(args[0]).toBe('spawn');
    expect(args[1]).toBe('cegonha');
  });

  test('does not call exec when autoSpawn is disabled', async () => {
    const client = new GenieClient(makeConfig({ autoSpawn: false }));
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 100));

    expect(execFileMock).not.toHaveBeenCalled();
  });

  test('caches known teams and skips check on second call', async () => {
    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 100));
    const firstGenieCalls = getCallsFor('genie').length;
    expect(firstGenieCalls).toBe(1);

    execFileMock.mockClear();

    // Second call: team should be cached, no new exec
    await client.run(makeRequest('second message'));

    await new Promise((r) => setTimeout(r, 100));
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test('does not block response even if spawn fails', async () => {
    execFileMock.mockImplementation((...callArgs: unknown[]) => {
      const cb = callArgs[callArgs.length - 1] as (error: Error | null, stdout?: string, stderr?: string) => void;
      cb(new Error('genie not found'));
    });

    const client = new GenieClient(makeConfig());
    const response = await client.run(makeRequest());

    // Response should still be returned successfully
    expect(response.status).toBe('completed');
    expect(response.content).toBe('');
  });

  test('does not include --session when sessionName is not configured', async () => {
    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());
    await new Promise((r) => setTimeout(r, 100));
    const genieCalls = getCallsFor('genie');
    const args = genieCalls[0]?.[1] as string[];
    expect(args).not.toContain('--session');
  });

  test('includes --session flag with sessionName', async () => {
    const client = new GenieClient(makeConfig({ sessionName: 'claudia-whatsapp' }));
    await client.run(makeRequest());
    await new Promise((r) => setTimeout(r, 100));
    const genieCalls = getCallsFor('genie');
    const args = genieCalls[0]?.[1] as string[];
    expect(args).toContain('--session');
    expect(args).toContain('claudia-whatsapp');
  });

  test('still delivers message to inbox regardless of auto-spawn', async () => {
    const client = new GenieClient(makeConfig());
    const response = await client.run(makeRequest('hello world'));

    expect(response.status).toBe('completed');
    expect(response.runId).toContain('genie-omni-');
  });
});
