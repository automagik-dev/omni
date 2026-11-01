import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDisposableCluster, destroyDisposableCluster, isDisposablePgPort } from './disposable-pg-cluster';

const scratch: string[] = [];
const parentTmpDir = tmpdir();
let privateTmpDir: string;
let originalTmpDir: string | undefined;
beforeEach(() => {
  originalTmpDir = process.env.TMPDIR;
  privateTmpDir = mkdtempSync(join(parentTmpDir, 'omni-pg-test-'));
  process.env.TMPDIR = privateTmpDir;
  expect(tmpdir()).toBe(privateTmpDir);
});
afterEach(() => {
  if (originalTmpDir === undefined) Reflect.deleteProperty(process.env, 'TMPDIR');
  else process.env.TMPDIR = originalTmpDir;
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
  rmSync(privateTmpDir, { recursive: true, force: true });
});
function fixture(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'omni-pg-fixture-'));
  scratch.push(dir);
  const path = join(dir, 'binary');
  writeFileSync(path, `#!/usr/bin/env bun\n${source}`, { mode: 0o700 });
  return path;
}
function clusterDirs(): string[] {
  return readdirSync(privateTmpDir)
    .filter((name) => name.startsWith('omni-g3-pg-') || name.startsWith('omni-pg-gate-output-'))
    .sort();
}

describe('disposable PostgreSQL isolation', () => {
  for (const args of [
    ['--url', 'postgres://u:p@127.0.0.1:5432/db'],
    ['--url=postgres://u:p@127.0.0.1:5432/db'],
    ['--url=postgres://u:p@127.0.0.1:15432/db'],
    ['--url', 'postgres://u:p@127.0.0.1:65432/db?port=5432'],
    ['--url=postgres://u:p@127.0.0.1:65432/db?host=10.1.2.3'],
    ['--url', 'postgres://u:p@127.0.0.1:65432/db?host=127.0.0.1&port=15432'],
    ['--url', 'postgres://u:p@127.0.0.1:65432/db?'],
    ['--url', 'host=10.1.2.3 port=5432 dbname=postgres'],
    ['--url', 'postgresql://u:x@localhost:5432,127.0.0.1:7777/db'],
    ['--url', 'postgresql://u:x@localhost:5432,y@127.0.0.1:7777/db'],
    ['--url', 'postgresql://u:x@y@127.0.0.1:7777/db'],
    ['--url'],
    ['--url='],
    ['--url', '--keep'],
  ]) {
    test(`refuses unsafe or missing URL: ${args.join(' ')}`, async () => {
      const before = clusterDirs();
      const fail = fixture('process.exit(1);');
      const child = Bun.spawn([process.execPath, 'scripts/pg-gate.ts', ...args], {
        env: {
          ...process.env,
          // Even a regressed validator cannot launch tests or connect to a DB.
          PATH: '/usr/bin:/bin',
          OMNI_PG_INITDB_BIN: fail,
          OMNI_PG_CTL_BIN: fail,
          OMNI_PG_PSQL_BIN: fail,
        },
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      const output = stdout + stderr;
      expect(code).not.toBe(0);
      expect(output).toMatch(
        /requires 127\.0\.0\.1 on a disposable port|requires a value|Invalid URL|single-host URLs/,
      );
      expect(output).not.toContain('disposable cluster on');
      expect(clusterDirs()).toEqual(before);
    });
  }

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
    test(`gate ${signal} with --keep reports the retained directory`, async () => {
      const initdb = fixture(
        `const { mkdirSync } = await import('node:fs'); mkdirSync(process.argv[process.argv.indexOf('--pgdata') + 1], { recursive: true });`,
      );
      const pgCtl = fixture('process.exit(0);');
      const child = Bun.spawn(['bun', 'scripts/pg-gate.ts', '--keep'], {
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
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          output += new TextDecoder().decode(next.value);
        }
        const retained = /cluster KEPT at (.+) \(destroy it yourself\)/.exec(output)?.[1];
        if (!retained) throw new Error(`missing kept cluster breadcrumb: ${output}`);
        expect(retained.startsWith(privateTmpDir)).toBe(true);
        expect(existsSync(retained)).toBe(true);
        expect(output.match(/cluster KEPT at/g)).toHaveLength(1);
        destroyDisposableCluster(retained, { initdb, pgCtl, psql: pgCtl });
        expect(clusterDirs()).toEqual([]);
      } finally {
        child.kill();
        await child.exited;
      }
    }, 20000);

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
