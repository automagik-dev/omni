import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDisposableCluster, isDisposablePgPort } from './disposable-pg-cluster';

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'omni-pg-fixture-'));
  scratch.push(dir);
  const path = join(dir, 'binary');
  writeFileSync(path, `#!/usr/bin/env bun\n${source}`, { mode: 0o700 });
  return path;
}
function clusterDirs(): string[] {
  return readdirSync(tmpdir())
    .filter((name) => name.startsWith('omni-g3-pg-') || name.startsWith('omni-pg-gate-output-'))
    .sort();
}

describe('disposable PostgreSQL isolation', () => {
  test('refuses both shared ports and invalid ports', () => {
    for (const port of [0, 5432, 15432, -1, 65536, 1.5]) expect(isDisposablePgPort(port)).toBe(false);
    expect(isDisposablePgPort(49152)).toBe(true);
  });
  test('initdb failure destroys its temporary directory', async () => {
    const before = clusterDirs();
    const fail = fixture('process.exit(1);');
    await expect(createDisposableCluster({ initdb: fail, pgCtl: fail, psql: fail })).rejects.toThrow('initdb');
    expect(clusterDirs()).toEqual(before);
  });
  test('start failure destroys its temporary directory', async () => {
    const before = clusterDirs();
    const initdb = fixture(
      `const { mkdirSync } = await import('node:fs'); mkdirSync(process.argv[process.argv.indexOf('--pgdata') + 1], { recursive: true });`,
    );
    const fail = fixture('process.exit(1);');
    await expect(createDisposableCluster({ initdb, pgCtl: fail, psql: fail })).rejects.toThrow('postmaster');
    expect(clusterDirs()).toEqual(before);
  }, 20000);
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    test(`gate ${signal} stops its cluster and deletes output and data directories`, async () => {
      const before = clusterDirs();
      const initdb = fixture(
        `const { mkdirSync } = await import('node:fs'); mkdirSync(process.argv[process.argv.indexOf('--pgdata') + 1], { recursive: true });`,
      );
      const pgCtl = fixture(
        `const { writeFileSync, rmSync } = await import('node:fs'); const dir = process.argv[process.argv.indexOf('-D') + 1]; if (process.argv.includes('start')) writeFileSync(dir + '/postmaster.pid', 'fixture'); else { writeFileSync(${JSON.stringify(join(initdb, '..', 'stopped'))}, 'stopped'); rmSync(dir + '/postmaster.pid'); }`,
      );
      const child = Bun.spawn(['bun', 'scripts/pg-gate.ts'], {
        env: { ...process.env, OMNI_PG_INITDB_BIN: initdb, OMNI_PG_CTL_BIN: pgCtl },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      try {
        const reader = child.stdout.getReader();
        let output = '';
        while (!output.includes('disposable cluster on')) {
          const next = await reader.read();
          if (next.done) throw new Error('gate exited before creating cluster');
          output += new TextDecoder().decode(next.value);
        }
        child.kill(signal);
        expect(await child.exited).not.toBe(0);
        expect(readFileSync(join(initdb, '..', 'stopped'), 'utf8')).toBe('stopped');
        expect(clusterDirs()).toEqual(before);
        expect(existsSync(join(initdb, '..', 'stopped'))).toBe(true);
      } finally {
        child.kill();
        await child.exited;
      }
    }, 20000);
  }
});
