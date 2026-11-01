import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

const isFailure = (line: string) => /^(?:\(fail\)|✗)(?:\s|$)/.test(line);
const isError = (line: string) => /^(?:error:|\w*Error:)/.test(line);

function failureDetails(lines: string[]): string[] {
  const details: string[] = [];
  let lastError = -1;
  let failures = 0;
  for (const [index, line] of lines.entries()) {
    if (isError(line)) lastError = index;
    let error = -1;
    let end = index + 1;
    if (isFailure(line)) error = lastError;
    else if (line.startsWith('# Unhandled error between tests')) {
      const nextError = lines.slice(index + 1).findIndex(isError);
      if (nextError >= 0) error = index + 1 + nextError;
      end = error + 4;
    } else continue;
    const timeout = lines[index + 1];
    const context =
      isFailure(line) && timeout?.trimStart().startsWith('^ this test timed out')
        ? [line, timeout]
        : error < 0
          ? [line]
          : lines.slice(error, end).filter((entry) => entry.trim());
    failures++;
    if (failures <= 3) details.push(...context.slice(0, 4).map((entry) => `    ${entry.trim().slice(0, 300)}`));
    lastError = -1;
  }
  if (failures > 3) details.push(`    … and ${failures - 3} more failures (see full child output)`);
  return details;
}

/** Bun reports hook failures as unnamed tests, and load failures as unhandled errors. */
export function formatPgGateFailure(output: string, suites: string[], problems: string[], logPath: string): string {
  const sections: { file: string; lines: string[] }[] = [];
  let current: (typeof sections)[number] | undefined;
  for (const rawLine of stripVTControlCharacters(output).split('\n')) {
    // Bun wraps file sections and repeats errors as annotations under GITHUB_ACTIONS.
    if (/^::(?:error|warning)(?:\s|::)/.test(rawLine)) continue;
    if (rawLine === '::endgroup::') {
      current = undefined;
      continue;
    }
    const line = rawLine.startsWith('::group::') ? rawLine.slice('::group::'.length) : rawLine;
    // Bun repeats failed test names after the final suite; that footer belongs to no file.
    if (/^\d+ tests? failed:$|^\s*\d+ (?:pass|fail|skip|error)\s*$/.test(line)) {
      current = undefined;
    } else if (/^\S.*\.test\.ts:$/.test(line)) {
      const file = suites.find((suite) => resolve(suite) === resolve(line.slice(0, -1)));
      current = file ? { file, lines: [] } : undefined;
      if (current) sections.push(current);
    } else {
      current?.lines.push(line);
    }
  }
  const summary = ['pg-gate: FAILED', ...problems.map((problem) => `  - ${problem}`)];
  let failures = 0;
  for (const { file, lines } of sections) {
    const details = failureDetails(lines);
    if (details.length === 0) continue;
    failures++;
    summary.push(`  ${file}`, ...details);
  }
  if (failures === 0) summary.push('  No suite failure marker found; inspect the full child output.');
  summary.push(`pg-gate: full child output: ${logPath}`);
  return `${summary.join('\n')}\n`;
}

/** Keep diagnostics outside cleanup; natural exit drains stdout/stderr even on a shared slow pipe. */
function reportPgGateFailure(output: string, suites: string[], problems: string[]): void {
  const logPath = join(tmpdir(), `omni-pg-gate-failure-${randomUUID()}.log`);
  process.stderr.write(formatPgGateFailure(output, suites, problems, logPath));
  try {
    writeFileSync(logPath, output, { mode: 0o600, flag: 'wx' });
  } catch (error) {
    process.stderr.write(`pg-gate: could not retain full output: ${error instanceof Error ? error.message : error}\n`);
  }
  const tail = stripVTControlCharacters(output)
    .split('\n')
    .filter((line) => !line.includes('NOTICE'))
    .slice(-200)
    .map((line) => line.slice(0, 500));
  process.stderr.write(`pg-gate: child output tail (up to 200 non-NOTICE lines):\n${tail.join('\n')}\n`);
}

/** Preserve the gate's zero-skip, nonempty and discovered-file-count contract. */
export function reportPgGateResult(output: string, suites: string[], exitCode: number | null): number {
  const skipCount = Number(/^\s*(\d+)\s+skip\s*$/m.exec(output)?.[1] ?? 0);
  const passCount = Number(/^\s*(\d+)\s+pass\s*$/m.exec(output)?.[1] ?? 0);
  const filesRun = Number(/across\s+(\d+)\s+files?/.exec(output)?.[1] ?? 0);
  const problems: string[] = [];
  if (exitCode !== 0) problems.push(`bun test exited ${exitCode}`);
  if (skipCount > 0) problems.push(`${skipCount} test(s) SKIPPED — the gate requires every suite to run`);
  if (passCount === 0) problems.push('no tests passed — the suites did not execute');
  if (filesRun !== suites.length) problems.push(`bun test ran ${filesRun} file(s), expected ${suites.length}`);
  if (problems.length > 0) {
    reportPgGateFailure(output, suites, problems);
    return 1;
  }
  process.stdout.write(`\npg-gate: PASSED — ${passCount} assertions across ${suites.length} suites, 0 skipped\n`);
  return 0;
}
