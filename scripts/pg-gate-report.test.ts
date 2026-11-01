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
    test: 'test("failed", () => { throw new Error("test proof"); });',
    pass: 'test("passed", () => {});',
  };
  const suites = Object.entries(sources).map(([name, source]) => {
    const file = join(dir, `${name}.test.ts`);
    writeFileSync(file, `import { beforeAll, afterAll, test } from 'bun:test';\n${source}\n`);
    return file;
  });
  const child = await run([process.execPath, 'test', ...suites]);
  expect(child.code).toBe(1);
  const summary = formatPgGateFailure(child.stdout + child.stderr, suites, ['bun test exited 1'], '/tmp/full.log');
  for (const name of ['before', 'after', 'load', 'test']) expect(summary).toContain(join(dir, `${name}.test.ts`));
  for (const error of ['beforeAll proof', 'afterAll proof', 'load proof', 'test proof'])
    expect(summary).toContain(`error: ${error}`);
  expect(summary).not.toContain(join(dir, 'pass.test.ts'));
});

test('large diagnostics stay intact in a kept file and piped stderr ends with the summary before exit', async () => {
  const dir = temporaryDirectory();
  const reporter = new URL('./pg-gate-report.ts', import.meta.url).href;
  const source = `
    import { reportPgGateResult } from ${JSON.stringify(reporter)};
    const output = 'NOTICE '.repeat(1024 * 1024) + '\\nproof.test.ts:\\nerror: beforeAll proof\\n(fail) (unnamed)\\n';
    process.exit(reportPgGateResult(output, ['proof.test.ts'], 1));
  `;
  const child = await run([process.execPath, '-e', source], { ...process.env, TMPDIR: dir });
  expect(child.code).toBe(1);
  expect(child.stderr).toStartWith('pg-gate: FAILED\n');
  expect(child.stderr).toContain('proof.test.ts\n    error: beforeAll proof');
  expect(child.stderr).not.toContain('NOTICE');
  expect(child.stderr.length).toBeLessThan(1000);
  const logPath = child.stderr.match(/pg-gate: full child output: (.+)\n$/)?.[1];
  expect(logPath).toBeDefined();
  if (!logPath) throw new Error('Missing retained diagnostics path');
  expect(readFileSync(logPath, 'utf-8')).toBe(
    `${'NOTICE '.repeat(1024 * 1024)}\nproof.test.ts:\nerror: beforeAll proof\n(fail) (unnamed)\n`,
  );
  expect(statSync(logPath).mode & 0o777).toBe(0o600);
});

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

test('passing output stays concise and creates no retained failure log', async () => {
  const dir = temporaryDirectory();
  const reporter = new URL('./pg-gate-report.ts', import.meta.url).href;
  const source = `
    import { reportPgGateResult } from ${JSON.stringify(reporter)};
    const output = 'NOTICE '.repeat(1024 * 1024) + '\\n 2 pass\\n 0 fail\\nRan 2 tests across 1 file.\\n';
    process.exit(reportPgGateResult(output, ['proof.test.ts'], 0));
  `;
  const child = await run([process.execPath, '-e', source], { ...process.env, TMPDIR: dir });
  expect(child.code).toBe(0);
  expect(child.stderr).toBe('');
  expect(child.stdout).toBe('\npg-gate: PASSED — 2 assertions across 1 suites, 0 skipped\n');
  expect(readdirSync(dir)).toEqual([]);
});

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
      process.exit(reportPgGateResult(${JSON.stringify(output)}, ['proof.test.ts'], 0));
    `;
    const child = await run([process.execPath, '-e', source], { ...process.env, TMPDIR: dir });
    expect(child.code).toBe(1);
    expect(child.stderr).toContain(error);
    expect(child.stdout).toBe('');
  });
}
