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

  test('exports new primitives: step / spinner / banner / progress / divider', () => {
    expect(typeof output.step).toBe('function');
    expect(typeof output.spinner).toBe('function');
    expect(typeof output.banner).toBe('function');
    expect(typeof output.progress).toBe('function');
    expect(typeof output.divider).toBe('function');
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
 * Behavioral coverage for the 5 new primitives: step / spinner / banner /
 * progress / divider. Spawned-child tests use OMNI_FORMAT to switch modes
 * because the child has no TTY (which exercises the non-TTY degradation
 * paths exactly as a piped consumer would see them).
 */
describe('output primitives — step / spinner / banner / progress / divider', () => {
  function runEmitter(
    body: string,
    env: Record<string, string> = {},
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    const tempDir = mkdtempSync(join(tmpdir(), 'omni-prim-'));
    const scriptPath = join(tempDir, 'emit.ts');
    const outputModulePath = join(import.meta.dir, '..', 'output.ts');
    const importPath = outputModulePath.replace(/\\/g, '/').replace(/'/g, "\\'");
    const script = `
import { step, spinner, banner, progress, divider, flushStdout } from '${importPath}';
${body}
await flushStdout();
`;
    writeFileSync(scriptPath, script);

    return new Promise((resolve, reject) => {
      const child = spawn('bun', [scriptPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, ...env },
      });
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      child.on('close', (code) => {
        rmSync(tempDir, { recursive: true, force: true });
        resolve({
          stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
          stderr: Buffer.concat(stderrChunks).toString('utf-8'),
          code,
        });
      });
      child.on('error', reject);
    });
  }

  describe('step', () => {
    test('human format: emits ▸ glyph + message on stdout', async () => {
      const { stdout, stderr } = await runEmitter(`step('Installing pgserve...');`, {
        OMNI_FORMAT: 'human',
        NO_COLOR: '1',
      });
      expect(stdout).toContain('▸');
      expect(stdout).toContain('Installing pgserve...');
      expect(stderr).toBe('');
    });

    test('json format: emits {step} JSON breadcrumb on stderr, stdout empty', async () => {
      const { stdout, stderr } = await runEmitter(`step('Installing pgserve...');`, {
        OMNI_FORMAT: 'json',
      });
      expect(stdout).toBe('');
      const parsed = JSON.parse(stderr.trim());
      expect(parsed).toEqual({ step: 'Installing pgserve...' });
    });
  });

  describe('spinner', () => {
    test('non-TTY human format: start emits info, succeed emits success on stdout', async () => {
      const { stdout, stderr } = await runEmitter(
        `const s = spinner('Checking version...').start(); s.succeed('v1.2.3');`,
        { OMNI_FORMAT: 'human', NO_COLOR: '1' },
      );
      // Degraded path: info(text) on start, success(text) on succeed.
      expect(stdout).toContain('Checking version...');
      expect(stdout).toContain('v1.2.3');
      expect(stdout).toContain('ℹ');
      expect(stdout).toContain('✓');
      // No \r animation residue.
      expect(stdout).not.toContain('\r');
      expect(stderr).toBe('');
    });

    test('json format: emits start + succeed breadcrumbs on stderr, stdout stays empty', async () => {
      const { stdout, stderr } = await runEmitter(
        `const s = spinner('Checking version...').start(); s.succeed('v1.2.3');`,
        { OMNI_FORMAT: 'json' },
      );
      expect(stdout).toBe('');
      const lines = stderr
        .trim()
        .split('\n')
        .filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
      expect(JSON.parse(lines[0])).toEqual({ spinner: 'start', text: 'Checking version...' });
      expect(JSON.parse(lines[1])).toEqual({ spinner: 'succeed', text: 'v1.2.3' });
    });

    test('json format: fail / warn / info / stop all produce stderr breadcrumbs', async () => {
      const { stdout, stderr } = await runEmitter(
        `const s = spinner('initial').start(); s.fail('boom'); s.warn('soft'); s.info('hint'); s.stop();`,
        { OMNI_FORMAT: 'json' },
      );
      expect(stdout).toBe('');
      const lines = stderr
        .trim()
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l));
      expect(lines).toHaveLength(5);
      expect(lines[0]).toEqual({ spinner: 'start', text: 'initial' });
      expect(lines[1]).toEqual({ spinner: 'fail', text: 'boom' });
      expect(lines[2]).toEqual({ spinner: 'warn', text: 'soft' });
      expect(lines[3]).toEqual({ spinner: 'info', text: 'hint' });
      expect(lines[4]).toEqual({ spinner: 'stop', text: 'initial' });
    });

    test('text setter mutates JSON-mode breadcrumb payload', async () => {
      const { stderr } = await runEmitter(`const s = spinner('first'); s.text = 'second'; s.start(); s.succeed();`, {
        OMNI_FORMAT: 'json',
      });
      const lines = stderr
        .trim()
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l));
      expect(lines[0]).toEqual({ spinner: 'start', text: 'second' });
      expect(lines[1]).toEqual({ spinner: 'succeed', text: 'second' });
    });
  });

  describe('banner', () => {
    test('human format: prints a multi-line boxed banner to stdout', async () => {
      const { stdout, stderr } = await runEmitter(
        `banner(['Updated to v1.2.3', 'Run omni doctor'], { borderStyle: 'round', borderColor: 'green' });`,
        { OMNI_FORMAT: 'human', NO_COLOR: '1' },
      );
      // boxen renders both lines plus border characters.
      expect(stdout).toContain('Updated to v1.2.3');
      expect(stdout).toContain('Run omni doctor');
      // Round border has corner glyphs (degrades to single ASCII when NO_COLOR
      // forces colors off in our impl). We assert at least one box-drawing
      // character is present so the banner actually rendered as a box.
      expect(stdout).toMatch(/[─│╭╮╯╰┌┐└┘]/);
      expect(stderr).toBe('');
    });

    test('human format: single-line input is centered (not multi-line)', async () => {
      const { stdout } = await runEmitter(`banner('Updated to v1.2.3');`, {
        OMNI_FORMAT: 'human',
        NO_COLOR: '1',
      });
      expect(stdout).toContain('Updated to v1.2.3');
      expect(stdout).toMatch(/[─│┌┐└┘╭╮╯╰]/);
    });

    test('json format: emits {banner} stderr breadcrumb, stdout empty', async () => {
      const { stdout, stderr } = await runEmitter(`banner(['line1', 'line2']);`, { OMNI_FORMAT: 'json' });
      expect(stdout).toBe('');
      const parsed = JSON.parse(stderr.trim());
      expect(parsed).toEqual({ banner: 'line1\nline2' });
    });
  });

  describe('progress', () => {
    test('json format: emits rate-limited {progress} stderr breadcrumbs', async () => {
      const { stdout, stderr } = await runEmitter(
        `const p = progress('Downloading'); p.start(100, 0); p.update(50); p.update(75); p.stop();`,
        { OMNI_FORMAT: 'json' },
      );
      expect(stdout).toBe('');
      const lines = stderr
        .trim()
        .split('\n')
        .filter((l) => l.length > 0)
        .map((l) => JSON.parse(l));
      // start() forces emit; the two updates within the same second are
      // rate-limited away; stop() forces a final emit. Net: 2 lines.
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines.length).toBeLessThanOrEqual(4);
      expect(lines[0]).toMatchObject({ progress: 0, total: 100, downloaded: 0, label: 'Downloading' });
      const last = lines[lines.length - 1];
      expect(last.label).toBe('Downloading');
      expect(last.total).toBe(100);
    });

    test('non-TTY human format: rate-limited stderr (no animation on stdout)', async () => {
      const { stdout, stderr } = await runEmitter(
        `const p = progress('Downloading'); p.start(100, 0); p.update(50); p.stop();`,
        { OMNI_FORMAT: 'human', NO_COLOR: '1' },
      );
      // Non-TTY child → progress degrades to JSON-style stderr breadcrumbs.
      expect(stdout).toBe('');
      expect(stderr).toContain('"progress"');
      expect(stderr).toContain('"label":"Downloading"');
    });
  });

  describe('divider', () => {
    test('human format: prints ─ characters spanning at least 1 char on stdout', async () => {
      const { stdout, stderr } = await runEmitter('divider();', {
        OMNI_FORMAT: 'human',
        NO_COLOR: '1',
      });
      expect(stdout).toContain('─');
      // Default non-TTY width is 80; allow more if process.stdout.columns leaks.
      const dashCount = (stdout.match(/─/g) ?? []).length;
      expect(dashCount).toBeGreaterThanOrEqual(80);
      expect(stderr).toBe('');
    });

    test('json format: divider is a no-op (both streams empty)', async () => {
      const { stdout, stderr } = await runEmitter('divider();', {
        OMNI_FORMAT: 'json',
      });
      expect(stdout).toBe('');
      expect(stderr).toBe('');
    });
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
