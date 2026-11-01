import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

/** Bun reports hook failures as unnamed tests, and load failures as unhandled errors. */
export function formatPgGateFailure(output: string, suites: string[], problems: string[], logPath: string): string {
  const sections: { file: string; lines: string[] }[] = [];
  let current: (typeof sections)[number] | undefined;
  for (const line of stripVTControlCharacters(output).split('\n')) {
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
  const failures = sections.filter(({ lines }) =>
    lines.some((line) => line.startsWith('(fail)') || line.startsWith('# Unhandled error between tests')),
  );
  const summary = ['pg-gate: FAILED', ...problems.map((problem) => `  - ${problem}`)];
  for (const { file, lines } of failures) {
    summary.push(`  ${file}`);
    const error = lines.findIndex((line) => /^(?:error:|\w*Error:)/.test(line));
    const details =
      error < 0
        ? lines.filter((line) => line.startsWith('(fail)') || line.startsWith('# Unhandled error'))
        : lines.slice(error).filter((line) => line.trim());
    summary.push(...details.slice(0, 4).map((line) => `    ${line.trim().slice(0, 300)}`));
  }
  if (failures.length === 0) summary.push('  No suite failure marker found; inspect the full child output.');
  summary.push(`pg-gate: full child output: ${logPath}`);
  return `${summary.join('\n')}\n`;
}

/** Keep diagnostics outside cluster/spool cleanup; synchronous stderr survives process.exit. */
function reportPgGateFailure(output: string, suites: string[], problems: string[]): void {
  const logPath = join(tmpdir(), `omni-pg-gate-failure-${randomUUID()}.log`);
  writeFileSync(logPath, output, { mode: 0o600, flag: 'wx' });
  writeFileSync(2, formatPgGateFailure(output, suites, problems, logPath));
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
  writeFileSync(1, `\npg-gate: PASSED — ${passCount} assertions across ${suites.length} suites, 0 skipped\n`);
  return 0;
}
