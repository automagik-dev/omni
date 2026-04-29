/**
 * Output Module Unit Tests
 *
 * Note: Most output functionality is best tested via CLI integration tests.
 * These tests verify the exported functions exist and have correct types.
 */

import { describe, expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { OutputFormat } from '../output.js';
import * as output from '../output.js';

describe('Output Module Exports', () => {
  test('exports color control functions', () => {
    expect(typeof output.disableColors).toBe('function');
    expect(typeof output.areColorsEnabled).toBe('function');
  });

  test('exports format function', () => {
    expect(typeof output.getCurrentFormat).toBe('function');
  });

  test('exports output functions', () => {
    expect(typeof output.success).toBe('function');
    expect(typeof output.error).toBe('function');
    expect(typeof output.warn).toBe('function');
    expect(typeof output.info).toBe('function');
    expect(typeof output.data).toBe('function');
    expect(typeof output.list).toBe('function');
    expect(typeof output.keyValue).toBe('function');
    expect(typeof output.header).toBe('function');
    expect(typeof output.dim).toBe('function');
    expect(typeof output.raw).toBe('function');
    expect(typeof output.tip).toBe('function');
  });

  test('exports flushStdout', () => {
    expect(typeof output.flushStdout).toBe('function');
  });
});

describe('areColorsEnabled', () => {
  test('returns a boolean', () => {
    const result = output.areColorsEnabled();
    expect(typeof result).toBe('boolean');
  });
});

describe('getCurrentFormat', () => {
  test('returns human or json', () => {
    const format = output.getCurrentFormat();
    expect(['human', 'json']).toContain(format);
  });

  test('return type is OutputFormat', () => {
    const format: OutputFormat = output.getCurrentFormat();
    expect(format).toBeDefined();
  });
});

describe('disableColors', () => {
  test('can be called without error', () => {
    expect(() => output.disableColors()).not.toThrow();
  });
});

describe('flushStdout', () => {
  test('returns a promise that resolves', async () => {
    const result = output.flushStdout();
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });

  test('resolves after pending writes', async () => {
    await expect(output.flushStdout()).resolves.toBeUndefined();
  });
});

/**
 * `tip` is the deprecation-nudge channel for the canonical-genie-omni-wiring
 * wish (Group 5). Unlike `info` / `warn`, it MUST go to stderr in every
 * format so CI scripts that grep stdout for command output remain stable.
 * These tests pin the contract: stderr-only, both human and JSON formats.
 */
describe('tip — always writes to stderr', () => {
  function spawnEmitter(format: 'human' | 'json'): Promise<{ stdout: string; stderr: string }> {
    const tempDir = mkdtempSync(join(tmpdir(), 'omni-tip-'));
    const scriptPath = join(tempDir, 'emit.ts');
    const outputModulePath = join(import.meta.dir, '..', 'output.ts');
    const importPath = outputModulePath.replace(/\\/g, '/').replace(/'/g, "\\'");
    const script = `
import { tip, flushStdout } from '${importPath}';
tip('canonical command is omni connect');
await flushStdout();
`;
    writeFileSync(scriptPath, script);

    return new Promise((resolve, reject) => {
      const child = spawn('bun', [scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, OMNI_FORMAT: format },
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('close', () => {
        rmSync(tempDir, { recursive: true, force: true });
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
        });
      });
      child.on('error', reject);
    });
  }

  test('human format: tip lands on stderr, stdout stays empty', async () => {
    const { stdout, stderr } = await spawnEmitter('human');
    expect(stdout).toBe('');
    expect(stderr).toContain('canonical command is omni connect');
  });

  test('json format: tip lands on stderr as JSON, stdout stays empty', async () => {
    const { stdout, stderr } = await spawnEmitter('json');
    expect(stdout).toBe('');
    // stderr must be valid JSON with a `tip` field — CI scripts that pipe
    // stdout into jq must remain unaffected by the nudge.
    const parsed = JSON.parse(stderr.trim());
    expect(parsed).toHaveProperty('tip', 'canonical command is omni connect');
  });
});

/**
 * Regression test for automagik-dev/omni#402.
 *
 * When stdout is piped to a slow consumer and the payload exceeds the 64KB
 * Linux kernel pipe buffer, the old flushStdout implementation let Bun exit
 * before the internal stream buffer drained, truncating output at exactly
 * 65537 bytes. This test spawns a child process that emits a >100KB JSON
 * payload via `output.list` and pipes it through a slow reader, asserting
 * the full payload survives the round-trip.
 */
describe('stdout pipe truncation (issue #402)', () => {
  test('emits >100KB JSON payload through slow pipe without truncation', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'omni-402-'));
    const scriptPath = join(tempDir, 'emit.ts');
    const outputPath = join(tempDir, 'out.json');

    try {
      const outputModulePath = join(import.meta.dir, '..', 'output.ts');
      // Normalize backslashes on Windows so they don't become escape sequences
      // when embedded in the single-quoted import literal below.
      const importPath = outputModulePath.replace(/\\/g, '/').replace(/'/g, "\\'");
      const script = `
import { list, flushStdout } from '${importPath}';

const items = Array.from({ length: 2000 }, (_, i) => ({
  id: 'msg-' + i,
  text: 'a long message body '.repeat(10),
  ts: new Date().toISOString(),
}));
list(items, { rawData: items });
await flushStdout();
`;
      writeFileSync(scriptPath, script);

      const bytes = await new Promise<number>((resolve, reject) => {
        const child = spawn('bun', [scriptPath], {
          stdio: ['ignore', 'pipe', 'inherit'],
          env: { ...process.env, OMNI_FORMAT: 'json' },
        });

        // Hold the reader idle for 100ms to let the kernel pipe buffer fill
        // (64KB on Linux) and force the child's write to return false. Then
        // drain normally. Without the fix, the child exits before its internal
        // buffer flushes and the payload truncates at exactly 65537 bytes.
        child.stdout.pause();

        const chunks: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        child.stdout.on('end', () => {
          const buf = Buffer.concat(chunks);
          writeFileSync(outputPath, buf);
          resolve(buf.byteLength);
        });
        child.on('error', reject);

        setTimeout(() => child.stdout.resume(), 100);
      });

      // Payload is deterministic: 2000 items × ~230 bytes JSON-pretty > 400KB
      expect(bytes).toBeGreaterThan(100_000);
      // Specifically assert we are NOT truncated at the 64KB pipe boundary.
      expect(bytes).not.toBe(65_537);
      expect(bytes).not.toBe(65_536);

      // And the payload parses as valid JSON with all items present.
      const parsed = JSON.parse(readFileSync(outputPath, 'utf8'));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2000);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);

  // Non-JSON (human) output is also subject to 64KB pipe truncation because
  // tables, key/value pairs, and info lines all end up on stdout. Prior to
  // this fix, `flushStdout` only awaited JSON/raw writes, so piping a large
  // human-formatted table to a slow reader lost trailing rows at 64KB.
  test('emits >100KB human-format table through slow pipe without truncation', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'omni-402-human-'));
    const scriptPath = join(tempDir, 'emit.ts');
    const outputPath = join(tempDir, 'out.txt');

    try {
      const outputModulePath = join(import.meta.dir, '..', 'output.ts');
      const importPath = outputModulePath.replace(/\\/g, '/').replace(/'/g, "\\'");
      const script = `
import { list, flushStdout } from '${importPath}';

const items = Array.from({ length: 2000 }, (_, i) => ({
  id: 'msg-' + i,
  text: 'a long message body '.repeat(10),
  ts: new Date().toISOString(),
}));
list(items);
await flushStdout();
`;
      writeFileSync(scriptPath, script);

      const bytes = await new Promise<number>((resolve, reject) => {
        const child = spawn('bun', [scriptPath], {
          stdio: ['ignore', 'pipe', 'inherit'],
          // Force human format + no colors so we count raw bytes deterministically.
          env: { ...process.env, OMNI_FORMAT: 'human', NO_COLOR: '1' },
        });

        // Same slow-reader scenario: pause, let the kernel pipe fill, then drain.
        child.stdout.pause();

        const chunks: Buffer[] = [];
        child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
        child.stdout.on('end', () => {
          const buf = Buffer.concat(chunks);
          writeFileSync(outputPath, buf);
          resolve(buf.byteLength);
        });
        child.on('error', reject);

        setTimeout(() => child.stdout.resume(), 100);
      });

      expect(bytes).toBeGreaterThan(100_000);
      expect(bytes).not.toBe(65_537);
      expect(bytes).not.toBe(65_536);

      // Ensure every row made it out — the last item is `msg-1999`.
      const text = readFileSync(outputPath, 'utf8');
      expect(text).toContain('msg-1999');
      // And the header row survived the slow pipe (it's the first emission).
      expect(text).toMatch(/^ID\s/);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 30_000);
});
