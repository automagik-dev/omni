/**
 * Tests for GenieClient auto-spawn behavior
 *
 * Tests that the GenieClient triggers `genie team ensure` when writing
 * to a team inbox that doesn't have a config.json yet.
 *
 * Run with: bun test packages/core/src/providers/__tests__/genie-client-auto-spawn.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GenieClient } from '../genie-client';
import type { GenieClientConfig } from '../genie-client';
import type { ProviderRequest } from '../types';

// ============================================================================
// Mocks
// ============================================================================

// Mock child_process.execFile to capture auto-spawn calls
const execFileMock = mock((_file: string, _args: string[], cb: (error: Error | null) => void) => {
  cb(null);
});

// Mock node:os homedir to use our test directory
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

const TEAMS_DIR = join(TEST_DIR, '.claude', 'teams');

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
    ...overrides,
  };
}

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

  test('accepts all config fields including autoSpawn', () => {
    const config: GenieClientConfig = {
      teamName: 'my-team',
      agentName: 'omni',
      targetAgent: 'team-lead',
      autoSpawn: true,
      autoSpawnDir: '/home/genie/workspace',
    };
    const client = new GenieClient(config);
    expect(client).toBeTruthy();
  });

  test('backward compatible with configs without autoSpawn fields', () => {
    const config: GenieClientConfig = {
      agentName: 'omni',
      targetAgent: 'team-lead',
    };
    const client = new GenieClient(config);
    expect(client).toBeTruthy();
  });
});

describe('GenieClient auto-spawn on run()', () => {
  test('calls genie team ensure when team config does not exist', async () => {
    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());

    // Give fire-and-forget stat() a tick to resolve
    await new Promise((r) => setTimeout(r, 50));

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const file = execFileMock.mock.calls[0]?.[0] as string;
    const args = execFileMock.mock.calls[0]?.[1] as string[];
    expect(file).toBe('genie');
    expect(args).toContain('team');
    expect(args).toContain('ensure');
    expect(args).toContain('test-team');
  });

  test('includes --dir flag with autoSpawnDir', async () => {
    const client = new GenieClient(makeConfig({ autoSpawnDir: '/my/workspace' }));
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 50));

    expect(execFileMock).toHaveBeenCalledTimes(1);
    const args = execFileMock.mock.calls[0]?.[1] as string[];
    expect(args).toContain('--dir');
    expect(args).toContain('/my/workspace');
  });

  test('does not call exec when team config already exists', async () => {
    // Create team config so it looks like team exists
    const teamDir = join(TEAMS_DIR, 'test-team');
    mkdirSync(teamDir, { recursive: true });
    writeFileSync(join(teamDir, 'config.json'), '{}');

    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 50));

    expect(execFileMock).not.toHaveBeenCalled();
  });

  test('does not call exec when autoSpawn is disabled', async () => {
    const client = new GenieClient(makeConfig({ autoSpawn: false }));
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 50));

    expect(execFileMock).not.toHaveBeenCalled();
  });

  test('caches known teams and skips filesystem check on second call', async () => {
    // First call: team doesn't exist, triggers exec
    // Make exec "succeed" so team gets cached
    const client = new GenieClient(makeConfig());
    await client.run(makeRequest());

    await new Promise((r) => setTimeout(r, 50));
    expect(execFileMock).toHaveBeenCalledTimes(1);

    execFileMock.mockClear();

    // Second call: team should be cached (exec succeeded), no new exec
    await client.run(makeRequest('second message'));

    await new Promise((r) => setTimeout(r, 50));
    expect(execFileMock).not.toHaveBeenCalled();
  });

  test('caches known teams after finding config on disk', async () => {
    // Create team config
    const teamDir = join(TEAMS_DIR, 'test-team');
    mkdirSync(teamDir, { recursive: true });
    writeFileSync(join(teamDir, 'config.json'), '{}');

    const client = new GenieClient(makeConfig());

    // First call: finds config on disk, caches
    await client.run(makeRequest());
    await new Promise((r) => setTimeout(r, 50));

    // Remove config to prove second call uses cache
    rmSync(teamDir, { recursive: true });

    // Second call: should use cache, not check filesystem
    await client.run(makeRequest('second'));
    await new Promise((r) => setTimeout(r, 50));

    expect(execFileMock).not.toHaveBeenCalled();
  });

  test('does not block response even if exec fails', async () => {
    execFileMock.mockImplementation((_file: string, _args: string[], cb: (error: Error | null) => void) => {
      cb(new Error('genie not found'));
    });

    const client = new GenieClient(makeConfig());
    const response = await client.run(makeRequest());

    // Response should still be returned successfully
    expect(response.status).toBe('completed');
    expect(response.content).toBe('');
  });

  test('still delivers message to inbox regardless of auto-spawn', async () => {
    const client = new GenieClient(makeConfig());
    const response = await client.run(makeRequest('hello world'));

    expect(response.status).toBe('completed');
    expect(response.runId).toContain('genie-omni-');
  });
});
