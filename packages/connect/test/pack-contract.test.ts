/**
 * QA matrix row Recovery/package (Group 2 share): the exact `bun pm pack` archive passes the pack
 * contract under Bun 1.4.2, and each negative control fails for its own reason.
 * Test names are stable acceptance ids that run-required --require matches; rename them only with
 * the wish's evidence record.
 */
import { beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ALLOWLIST,
  type Dependency,
  type Entry,
  REQUIRED_BUN,
  checkClosure,
  checkEntries,
  checkManifest,
  packArchive,
  readClosure,
  readTarGz,
  smokeImport,
  verify,
} from '../scripts/verify-pack';

const PACKAGE_DIR = join(import.meta.dir, '..');
let entries: Entry[];
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'connect-pack-test-'));
  try {
    entries = readTarGz(readFileSync(packArchive(dir)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const text = (e: Entry) => new TextDecoder().decode(e.data);
const encode = (s: string) => new TextEncoder().encode(s);
function edit(name: string, change: (entry: Entry) => Entry | null): Entry[] {
  return entries.flatMap((e) => (e.name === name ? (change(e) ?? []) : [e]));
}
function manifest(change: (pkg: Record<string, unknown>) => void): Entry[] {
  return edit('package/package.json', (e) => {
    const pkg = JSON.parse(text(e));
    change(pkg);
    return { ...e, data: encode(JSON.stringify(pkg)) };
  });
}
const source = (name: string, extra: string) =>
  edit(`package/src/${name}`, (e) => ({ ...e, data: encode(`${text(e)}\n${extra}\n`) }));

describe('pack contract', () => {
  test('the bun pm pack archive passes under Bun 1.4.2 and holds exactly the allowlist', () => {
    expect(Bun.version).toBe(REQUIRED_BUN);
    const report = verify();
    expect(report.errors).toEqual([]);
    expect([...report.entries].sort()).toEqual(ALLOWLIST);
    expect(report.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(checkEntries(entries)).toEqual([]);
  });

  // A full typecheck in a subprocess needs more headroom than a fast unit test.
  test(
    'the sources typecheck under a consumer config with DOM libs and bun-types',
    () => {
      const tsc = join(PACKAGE_DIR, 'node_modules/typescript/bin/tsc');
      const run = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.consumer.json'], {
        cwd: PACKAGE_DIR,
        encoding: 'utf8',
      });
      expect(`${run.stdout}${run.stderr}`.trim()).toBe('');
      expect(run.status).toBe(0);
    },
    { timeout: 20000 },
  );

  test('the workspace manifest claims Bun 1.4.2 only, private, Apache-2.0', () => {
    const pkg = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'));
    expect(checkManifest(pkg)).toEqual([]);
    expect(pkg.engines).toEqual({ bun: '1.4.2' });
    expect(pkg.private).toBe(true);
  });

  const controls: [string, () => Entry[], string][] = [
    [
      'a test file',
      () => [...entries, { name: 'package/test/identity.test.ts', type: '0', data: encode('x') }],
      'not in the allowlist: package/test/identity.test.ts',
    ],
    [
      'a dotenv file',
      () => [...entries, { name: 'package/.env', type: '0', data: encode('A=1') }],
      'not in the allowlist: package/.env',
    ],
    [
      'a missing source',
      () => edit('package/src/oidc.ts', () => null),
      'missing from the archive: package/src/oidc.ts',
    ],
    [
      'a symlink entry',
      () => edit('package/src/index.ts', (e) => ({ ...e, type: '2' })),
      'not a regular file: package/src/index.ts',
    ],
    [
      'another license text',
      () => edit('package/LICENSE', (e) => ({ ...e, data: encode('MIT License') })),
      'LICENSE is not the Apache-2.0 text',
    ],
    [
      'an install script',
      () => manifest((p) => Object.assign(p.scripts as object, { postinstall: 'node x' })),
      'script not allowed: postinstall',
    ],
    [
      'a prepare script',
      () => manifest((p) => Object.assign(p.scripts as object, { prepare: 'husky' })),
      'script not allowed: prepare',
    ],
    [
      'a Node engine claim',
      () => manifest((p) => Object.assign(p, { engines: { bun: '1.4.2', node: '>=20' } })),
      'package.json engines',
    ],
    ['a public package', () => manifest((p) => Object.assign(p, { private: false })), 'package.json private'],
    [
      'an extra runtime dependency',
      () => manifest((p) => Object.assign(p.dependencies as object, { 'left-pad': '1.3.0' })),
      'package.json dependencies',
    ],
    [
      'a workspace dependency',
      () => manifest((p) => Object.assign(p, { dependencies: { '@omni/core': 'workspace:*' } })),
      'package.json dependencies',
    ],
    [
      'an optional dependency',
      () => manifest((p) => Object.assign(p, { optionalDependencies: { x: '1' } })),
      'must not declare optionalDependencies',
    ],
    ['an undeclared import', () => source('index.ts', "import 'left-pad';"), 'imports undeclared module left-pad'],
    [
      'a deep dependency import',
      () => source('oidc.ts', "export * from 'openid-client/passport';"),
      'undeclared module openid-client/passport',
    ],
    [
      'a non-literal import',
      () => source('sessions.ts', 'export const load = (m: string) => import(m);'),
      'non-literal import',
    ],
    [
      'a private key',
      () => source('oidc.ts', '// -----BEGIN RSA PRIVATE KEY-----'),
      'forbidden content in package/src/oidc.ts',
    ],
    [
      'a deployment issuer default',
      () => source('oidc.ts', "export const ISSUER = 'https://id.lembr.ai';"),
      'forbidden content in package/src/oidc.ts',
    ],
  ];
  for (const [name, build, reason] of controls) {
    test(`rejects ${name}`, () => {
      const errors = checkEntries(build());
      expect(errors.some((e) => e.includes(reason))).toBe(true);
    });
  }

  test('the smoke import runs the packed bytes, not the workspace source', () => {
    const errors = smokeImport(
      edit('package/src/oidc.ts', () => null),
      PACKAGE_DIR,
    );
    expect(errors.join()).toContain('import of the packed archive failed');
  });
});

describe('dependency closure', () => {
  test('the installed closure is pinned, permissive and free of install scripts', () => {
    const closure = readClosure(PACKAGE_DIR);
    expect(closure.map((d) => `${d.name}@${d.version} ${d.license}`).sort()).toEqual([
      'jose@6.2.12 MIT',
      'oauth4webapi@3.8.8 MIT',
      'openid-client@6.8.8 MIT',
    ]);
    expect(checkClosure(closure)).toEqual([]);
  });

  const base = (): Dependency[] => readClosure(PACKAGE_DIR);
  const closureControls: [string, (c: Dependency[]) => Dependency[], string][] = [
    [
      'a GPL dependency',
      (c) => c.map((d) => (d.name === 'jose' ? { ...d, license: 'GPL-3.0-only' } : d)),
      'not on the permissive allowlist',
    ],
    [
      'an AGPL dependency',
      (c) => c.map((d) => (d.name === 'jose' ? { ...d, license: 'AGPL-3.0' } : d)),
      'not on the permissive allowlist',
    ],
    [
      'an install script',
      (c) => c.map((d) => (d.name === 'jose' ? { ...d, scripts: { postinstall: 'x' } } : d)),
      'install script',
    ],
    [
      'a drifted version',
      (c) => c.map((d) => (d.name === 'jose' ? { ...d, version: '6.2.13' } : d)),
      'not the pinned version',
    ],
    [
      'an unexpected package',
      (c) => [...c, { name: 'left-pad', version: '1.3.0', license: 'WTFPL', scripts: {} }],
      'dependency closure is',
    ],
  ];
  for (const [name, change, reason] of closureControls) {
    test(`rejects ${name}`, () => {
      expect(checkClosure(change(base())).some((e) => e.includes(reason))).toBe(true);
    });
  }
});
