import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatPgGateFailure } from './pg-gate-report';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function temporaryDirectory(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'omni-pg-report-test-')));
  scratch.push(dir);
  return dir;
}
async function run(cmd: string[], env = process.env) {
  const child = Bun.spawn(cmd, { env, stdout: 'pipe', stderr: 'pipe' });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

test('names beforeAll, afterAll, load and test failures with their first errors', async () => {
  const dir = temporaryDirectory();
  const sources = {
    before: 'beforeAll(() => { throw new Error("beforeAll proof"); }); test("blocked", () => {});',
    after: 'afterAll(() => { throw new Error("afterAll proof"); }); test("passed", () => {});',
    load: 'throw new Error("load proof");',
    test: `test("ok", () => { console.error("Error: noise from a passing test"); });
      test("failed", () => { throw new Error("test proof"); });`,
    pass: 'test("passed", () => {});',
  };
  const suites = Object.entries(sources).map(([name, source]) => {
    const file = join(dir, `${name}.test.ts`);
    writeFileSync(file, `import { beforeAll, afterAll, test } from 'bun:test';\n${source}\n`);
    return file;
  });
  for (const FORCE_COLOR of ['0', '1']) {
    const child = await run([process.execPath, 'test', ...suites], { ...process.env, FORCE_COLOR });
    expect(child.code).toBe(1);
    const summary = formatPgGateFailure(child.stdout + child.stderr, suites, ['bun test exited 1'], '/tmp/full.log');
    for (const name of ['before', 'after', 'load', 'test']) expect(summary).toContain(join(dir, `${name}.test.ts`));
    for (const error of ['beforeAll proof', 'afterAll proof', 'load proof', 'test proof'])
      expect(summary).toContain(`error: ${error}`);
    expect(summary).not.toContain(join(dir, 'pass.test.ts'));
    expect(summary).not.toContain('Error: noise from a passing test');
  }
}, 30_000);

test('large diagnostics stay intact while the summary precedes bounded context and stderr drains naturally', async () => {
  const dir = temporaryDirectory();
  const reporter = new URL('./pg-gate-report.ts', import.meta.url).href;
  const source = `
    import { reportPgGateResult } from ${JSON.stringify(reporter)};
    const output = 'NOTICE '.repeat(1024 * 1024) + '\\nproof.test.ts:\\nerror: beforeAll proof\\n(fail) (unnamed)\\n';
    process.exitCode = reportPgGateResult(output, ['proof.test.ts'], 1);
  `;
  const child = await run([process.execPath, '-e', source], { ...process.env, TMPDIR: dir });
  expect(child.code).toBe(1);
  expect(child.stderr).toStartWith('pg-gate: FAILED\n');
  expect(child.stderr).toContain('proof.test.ts\n    error: beforeAll proof');
  expect(child.stderr).not.toContain('NOTICE NOTICE');
  expect(child.stderr.length).toBeLessThan(1000);
  expect(child.stderr.indexOf('pg-gate: child output tail')).toBeGreaterThan(child.stderr.indexOf('pg-gate: FAILED'));
  const logPath = child.stderr.match(/pg-gate: full child output: (.+)\n/)?.[1];
  expect(logPath).toBeDefined();
  if (!logPath) throw new Error('Missing retained diagnostics path');
  expect(readFileSync(logPath, 'utf-8')).toBe(
    `${'NOTICE '.repeat(1024 * 1024)}\nproof.test.ts:\nerror: beforeAll proof\n(fail) (unnamed)\n`,
  );
  expect(statSync(logPath).mode & 0o777).toBe(0o600);
}, 30_000);

test('aggregate failures without Bun suite markers still point to complete diagnostics', () => {
  const summary = formatPgGateFailure('runtime crashed', ['proof.test.ts'], ['bun test exited 1'], '/tmp/full.log');
  expect(summary).toContain('No suite failure marker found');
  expect(summary).toEndWith('pg-gate: full child output: /tmp/full.log\n');
});

test('Bun failure recap does not blame the final passing suite', () => {
  const output = `failed.test.ts:
error: beforeAll proof
(fail) (unnamed)
passed.test.ts:
(pass) successful

1 tests failed:
(fail) (unnamed)
 1 pass
 1 fail
`;
  const summary = formatPgGateFailure(
    output,
    ['failed.test.ts', 'passed.test.ts'],
    ['bun test exited 1'],
    '/tmp/full.log',
  );
  expect(summary).toContain('failed.test.ts\n    error: beforeAll proof');
  expect(summary).not.toContain('passed.test.ts');
});

test('each failure anchors its own typed error and load errors ignore preceding noise', () => {
  const output = `proof.test.ts:
Error: earlier noise
TypeError: first proof
✗ first test
Error: later noise
error: second proof
(fail) second test
Error: load noise
# Unhandled error between tests
SyntaxError: load proof
`;
  const summary = formatPgGateFailure(output, ['proof.test.ts'], ['bun test exited 1'], '/tmp/full.log');
  for (const error of ['TypeError: first proof', 'error: second proof', 'SyntaxError: load proof'])
    expect(summary).toContain(error);
  expect(summary).not.toContain('noise');
});

test('stdout and stderr sharing a slow pipe drain completely on natural exit', async () => {
  const dir = temporaryDirectory();
  const reporter = new URL('./pg-gate-report.ts', import.meta.url).href;
  const source = `
    import { reportPgGateResult } from ${JSON.stringify(reporter)};
    process.stdout.write('P'.repeat(2 * 1024 * 1024));
    process.exitCode = reportPgGateResult('proof.test.ts:\\nerror: shared proof\\n(fail) shared\\n', ['proof.test.ts'], 1);
    process.stderr.write('tail-sentinel\\n');
  `;
  const child = Bun.spawn(['bash', '-c', 'exec "$@" 2>&1', 'pg-report-shared', process.execPath, '-e', source], {
    env: { ...process.env, TMPDIR: dir },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const chunks: Uint8Array[] = [];
  const stderr = new Response(child.stderr).text();
  for await (const chunk of child.stdout) {
    chunks.push(chunk);
    await Bun.sleep(2);
  }
  const output = Buffer.concat(chunks).toString();
  expect(await child.exited).toBe(1);
  expect(await stderr).toBe('');
  expect(output.match(/P/g)?.length).toBe(2 * 1024 * 1024);
  expect(output).toContain('proof.test.ts\n    error: shared proof');
  expect(output).toContain('pg-gate: full child output:');
  expect(output).toContain('tail-sentinel\n');
  expect(output).not.toContain('EAGAIN');
}, 30_000);

test('an unwritable retained log still prints the summary, warning and context', async () => {
  const dir = temporaryDirectory();
  const blocked = join(dir, 'not-a-directory');
  writeFileSync(blocked, 'blocked');
  const reporter = new URL('./pg-gate-report.ts', import.meta.url).href;
  const source = `
    import { reportPgGateResult } from ${JSON.stringify(reporter)};
    process.exitCode = reportPgGateResult('proof.test.ts:\\nerror: disk proof\\n(fail) failed\\n', ['proof.test.ts'], 1);
  `;
  const child = await run([process.execPath, '-e', source], { ...process.env, TMPDIR: blocked });
  expect(child.code).toBe(1);
  expect(child.stderr).toStartWith('pg-gate: FAILED\n');
  expect(child.stderr).toContain('proof.test.ts\n    error: disk proof');
  expect(child.stderr).toContain('pg-gate: could not retain full output:');
  expect(child.stderr.indexOf('could not retain')).toBeGreaterThan(child.stderr.indexOf('pg-gate: FAILED'));
  expect(child.stderr).toContain('pg-gate: child output tail');
}, 30_000);

test('CI context tail keeps at most 200 lines, filters NOTICE and bounds individual lines', async () => {
  const dir = temporaryDirectory();
  const reporter = new URL('./pg-gate-report.ts', import.meta.url).href;
  const source = `
    import { reportPgGateResult } from ${JSON.stringify(reporter)};
    const output = Array.from({length: 500}, (_, i) => 'context-' + i + '\\nNOTICE noisy').join('\\n')
      + '\\n' + 'x'.repeat(4000) + '\\nproof.test.ts:\\nerror: tail proof\\n(fail) failed';
    process.exitCode = reportPgGateResult(output, ['proof.test.ts'], 1);
  `;
  const child = await run([process.execPath, '-e', source], { ...process.env, TMPDIR: dir });
  expect(child.code).toBe(1);
  const tail = child.stderr.split('pg-gate: child output tail (up to 200 non-NOTICE lines):\n')[1];
  expect(tail).toBeDefined();
  if (!tail) throw new Error('Missing CI context tail');
  expect(tail.trimEnd().split('\n')).toHaveLength(200);
  expect(tail).not.toContain('NOTICE');
  expect(tail).not.toContain('context-0\n');
  expect(tail).toContain('context-499\n');
  expect(tail).toContain(`${'x'.repeat(500)}\n`);
  expect(tail).not.toContain('x'.repeat(501));
}, 30_000);

test('passing output stays concise and creates no retained failure log', async () => {
  const dir = temporaryDirectory();
  const reporter = new URL('./pg-gate-report.ts', import.meta.url).href;
  const source = `
    import { reportPgGateResult } from ${JSON.stringify(reporter)};
    const output = 'NOTICE '.repeat(1024 * 1024) + '\\n 2 pass\\n 0 fail\\nRan 2 tests across 1 file.\\n';
    process.exitCode = reportPgGateResult(output, ['proof.test.ts'], 0);
  `;
  const child = await run([process.execPath, '-e', source], { ...process.env, TMPDIR: dir });
  expect(child.code).toBe(0);
  expect(child.stderr).toBe('');
  expect(child.stdout).toBe('\npg-gate: PASSED — 2 assertions across 1 suites, 0 skipped\n');
  expect(readdirSync(dir)).toEqual([]);
}, 30_000);

for (const { output, error } of [
  { output: '1 pass\n1 skip\nRan 2 tests across 1 file.', error: '1 test(s) SKIPPED' },
  { output: '0 pass\nRan 0 tests across 1 file.', error: 'no tests passed' },
  { output: '1 pass\nRan 1 test across 0 files.', error: 'bun test ran 0 file(s), expected 1' },
]) {
  test(`a zero exit still fails the gate for ${error}`, async () => {
    const dir = temporaryDirectory();
    const reporter = new URL('./pg-gate-report.ts', import.meta.url).href;
    const source = `
      import { reportPgGateResult } from ${JSON.stringify(reporter)};
      process.exitCode = reportPgGateResult(${JSON.stringify(output)}, ['proof.test.ts'], 0);
    `;
    const child = await run([process.execPath, '-e', source], { ...process.env, TMPDIR: dir });
    expect(child.code).toBe(1);
    expect(child.stderr).toContain(error);
    expect(child.stdout).toBe('');
  }, 30_000);
}
