/**
 * sidecar-cleanup tests
 *
 * Covers the pure parsing and formatting helpers — no spawning, no pm2.
 * The impure detection/stopping functions are intentionally NOT tested
 * here because mocking `Bun.spawn` against the real CLI runtime is more
 * brittle than it's worth; the parsers are the load-bearing logic.
 */

import { describe, expect, test } from 'bun:test';
import {
  type CleanupResult,
  cleanupSucceeded,
  formatCleanupSummary,
  parsePm2SidecarMatches,
  parseRawSidecarMatches,
} from '../sidecar-cleanup.js';

describe('parsePm2SidecarMatches', () => {
  test('returns [] for empty input', () => {
    expect(parsePm2SidecarMatches('')).toEqual([]);
    expect(parsePm2SidecarMatches('  \n  ')).toEqual([]);
    expect(parsePm2SidecarMatches('[]')).toEqual([]);
  });

  test('returns [] for malformed JSON', () => {
    expect(parsePm2SidecarMatches('not-json')).toEqual([]);
    expect(parsePm2SidecarMatches('{')).toEqual([]);
  });

  test('returns [] when nothing matches', () => {
    const raw = JSON.stringify([
      { name: 'omni-api', pm_id: 0, pm2_env: { pm_exec_path: '/opt/omni/api.js' } },
      { name: 'omni-nats', pm_id: 1, pm2_env: { pm_exec_path: '/opt/nats/nats.js' } },
    ]);
    expect(parsePm2SidecarMatches(raw)).toEqual([]);
  });

  test('matches by name when name contains nats-reply-sidecar', () => {
    const raw = JSON.stringify([
      {
        name: 'nats-reply-sidecar',
        pm_id: 5,
        pm2_env: { pm_exec_path: '/opt/omni/nats-reply-sidecar.mjs' },
      },
    ]);
    const matches = parsePm2SidecarMatches(raw);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      name: 'nats-reply-sidecar',
      pmId: 5,
      scriptPath: '/opt/omni/nats-reply-sidecar.mjs',
      matchedBy: 'name',
    });
  });

  test('matches by script path when name does NOT contain the hint', () => {
    const raw = JSON.stringify([
      {
        name: 'my-bot-sidecar',
        pm_id: 7,
        pm2_env: { pm_exec_path: '/home/op/bots/nats-reply-sidecar.mjs' },
      },
    ]);
    const matches = parsePm2SidecarMatches(raw);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      name: 'my-bot-sidecar',
      pmId: 7,
      scriptPath: '/home/op/bots/nats-reply-sidecar.mjs',
      matchedBy: 'script-path',
    });
  });

  test('matches multiple sidecars', () => {
    const raw = JSON.stringify([
      { name: 'nats-reply-sidecar', pm_id: 1, pm2_env: { pm_exec_path: '/a/nats-reply-sidecar.mjs' } },
      { name: 'omni-api', pm_id: 2, pm2_env: { pm_exec_path: '/b/api.js' } },
      { name: 'second-sidecar', pm_id: 3, pm2_env: { pm_exec_path: '/c/nats-reply-sidecar.mjs' } },
    ]);
    const matches = parsePm2SidecarMatches(raw);
    expect(matches).toHaveLength(2);
    expect(matches.map((m) => m.pmId)).toEqual([1, 3]);
  });

  test('handles missing fields gracefully', () => {
    const raw = JSON.stringify([
      {}, // entirely missing
      { name: 'nats-reply-sidecar' }, // no pm_id, no pm2_env
      { pm2_env: { pm_exec_path: '/x/nats-reply-sidecar.mjs' } }, // no name
    ]);
    const matches = parsePm2SidecarMatches(raw);
    expect(matches).toHaveLength(2);
    expect(matches[0]?.name).toBe('nats-reply-sidecar');
    expect(matches[0]?.pmId).toBeNull();
    expect(matches[0]?.scriptPath).toBe('');
    expect(matches[1]?.name).toBe('');
    expect(matches[1]?.matchedBy).toBe('script-path');
  });

  test('returns [] when JSON is not an array', () => {
    expect(parsePm2SidecarMatches('{"name":"nats-reply-sidecar"}')).toEqual([]);
    expect(parsePm2SidecarMatches('"string"')).toEqual([]);
    expect(parsePm2SidecarMatches('null')).toEqual([]);
  });

  test('does NOT match a script path that merely contains the basename mid-string', () => {
    // Defensive: a path like /opt/nats-reply-sidecar.mjs.bak should NOT match
    const raw = JSON.stringify([
      {
        name: 'unrelated',
        pm_id: 9,
        pm2_env: { pm_exec_path: '/opt/nats-reply-sidecar.mjs.bak' },
      },
    ]);
    expect(parsePm2SidecarMatches(raw)).toEqual([]);
  });
});

describe('parseRawSidecarMatches', () => {
  test('returns [] for empty input', () => {
    expect(parseRawSidecarMatches('')).toEqual([]);
    expect(parseRawSidecarMatches('\n\n')).toEqual([]);
  });

  test('parses a single pgrep -fa line', () => {
    const raw = '12345 node /opt/omni/nats-reply-sidecar.mjs';
    const matches = parseRawSidecarMatches(raw);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toEqual({
      pid: 12345,
      command: 'node /opt/omni/nats-reply-sidecar.mjs',
    });
  });

  test('parses multiple pgrep -fa lines', () => {
    const raw = ['111 node /a/nats-reply-sidecar.mjs', '222 bun /b/nats-reply-sidecar.mjs --foo'].join('\n');
    const matches = parseRawSidecarMatches(raw);
    expect(matches).toHaveLength(2);
    expect(matches[0]?.pid).toBe(111);
    expect(matches[1]?.pid).toBe(222);
  });

  test('skips lines without a parseable pid', () => {
    const raw = ['not a pid', 'foo bar /nats-reply-sidecar.mjs'].join('\n');
    expect(parseRawSidecarMatches(raw)).toEqual([]);
  });

  test('skips lines whose command does not contain the basename', () => {
    const raw = '99 node /opt/something-else.js';
    expect(parseRawSidecarMatches(raw)).toEqual([]);
  });

  test('skips lines with negative or zero pids', () => {
    const raw = ['-1 node /a/nats-reply-sidecar.mjs', '0 node /a/nats-reply-sidecar.mjs'].join('\n');
    expect(parseRawSidecarMatches(raw)).toEqual([]);
  });
});

describe('formatCleanupSummary', () => {
  function emptyResult(): CleanupResult {
    return {
      pm2Detected: [],
      rawDetected: [],
      pm2Stopped: [],
      pm2Failed: [],
      rawKilled: [],
      rawFailed: [],
    };
  }

  test('returns empty string when nothing was detected', () => {
    expect(formatCleanupSummary(emptyResult())).toBe('');
  });

  test('reports stopped pm2 sidecars with name + matched-by', () => {
    const result: CleanupResult = {
      ...emptyResult(),
      pm2Detected: [{ name: 'nats-reply-sidecar', pmId: 5, scriptPath: '/x.mjs', matchedBy: 'name' }],
      pm2Stopped: [{ name: 'nats-reply-sidecar', pmId: 5, scriptPath: '/x.mjs', matchedBy: 'name' }],
    };
    const summary = formatCleanupSummary(result);
    expect(summary).toContain('Found 1 legacy nats-reply-sidecar process');
    expect(summary).toContain('✓ pm2: stopped and deleted "nats-reply-sidecar" (matched by name)');
  });

  test('reports raw kills with pid', () => {
    const result: CleanupResult = {
      ...emptyResult(),
      rawDetected: [{ pid: 12345, command: 'node /x.mjs' }],
      rawKilled: [{ pid: 12345, command: 'node /x.mjs' }],
    };
    const summary = formatCleanupSummary(result);
    expect(summary).toContain('Found 1 legacy');
    expect(summary).toContain('✓ raw: SIGTERM sent to pid 12345');
  });

  test('reports failures with manual recovery hint', () => {
    const result: CleanupResult = {
      ...emptyResult(),
      pm2Detected: [{ name: 'sidecar-1', pmId: 5, scriptPath: '/x.mjs', matchedBy: 'name' }],
      pm2Failed: [{ name: 'sidecar-1', pmId: 5, scriptPath: '/x.mjs', matchedBy: 'name' }],
      rawDetected: [{ pid: 999, command: 'node /y.mjs' }],
      rawFailed: [{ pid: 999, command: 'node /y.mjs' }],
    };
    const summary = formatCleanupSummary(result);
    expect(summary).toContain('✗ pm2: failed to stop "sidecar-1"');
    expect(summary).toContain('pm2 stop sidecar-1 && pm2 delete sidecar-1');
    expect(summary).toContain('✗ raw: failed to signal pid 999');
    expect(summary).toContain('kill 999');
    expect(summary).toContain('docs/migration/nats-genie-sidecar-decommission.md');
  });

  test('falls back to pm_id label when name is empty', () => {
    const result: CleanupResult = {
      ...emptyResult(),
      pm2Detected: [{ name: '', pmId: 42, scriptPath: '/x.mjs', matchedBy: 'script-path' }],
      pm2Stopped: [{ name: '', pmId: 42, scriptPath: '/x.mjs', matchedBy: 'script-path' }],
    };
    const summary = formatCleanupSummary(result);
    expect(summary).toContain('"pm_id=42"');
  });

  test('counts pm2 + raw together in the headline', () => {
    const result: CleanupResult = {
      ...emptyResult(),
      pm2Detected: [{ name: 'a', pmId: 1, scriptPath: '/x.mjs', matchedBy: 'name' }],
      rawDetected: [{ pid: 100, command: 'node /y.mjs' }],
    };
    const summary = formatCleanupSummary(result);
    expect(summary).toContain('Found 2 legacy nats-reply-sidecar process(es)');
  });
});

describe('cleanupSucceeded', () => {
  test('true when nothing failed', () => {
    expect(
      cleanupSucceeded({
        pm2Detected: [],
        rawDetected: [],
        pm2Stopped: [],
        pm2Failed: [],
        rawKilled: [],
        rawFailed: [],
      }),
    ).toBe(true);
  });

  test('false when a pm2 stop failed', () => {
    expect(
      cleanupSucceeded({
        pm2Detected: [{ name: 'x', pmId: 1, scriptPath: '/x.mjs', matchedBy: 'name' }],
        rawDetected: [],
        pm2Stopped: [],
        pm2Failed: [{ name: 'x', pmId: 1, scriptPath: '/x.mjs', matchedBy: 'name' }],
        rawKilled: [],
        rawFailed: [],
      }),
    ).toBe(false);
  });

  test('false when a raw kill failed', () => {
    expect(
      cleanupSucceeded({
        pm2Detected: [],
        rawDetected: [{ pid: 1, command: 'node /x.mjs' }],
        pm2Stopped: [],
        pm2Failed: [],
        rawKilled: [],
        rawFailed: [{ pid: 1, command: 'node /x.mjs' }],
      }),
    ).toBe(false);
  });
});
