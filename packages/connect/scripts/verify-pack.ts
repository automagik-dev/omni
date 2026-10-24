#!/usr/bin/env bun
/**
 * Pack contract for @omni/connect, run under the claimed runtime only (Bun 1.4.2):
 *
 *   bun packages/connect/scripts/verify-pack.ts [--archive <file.tgz>]
 *
 * Without --archive it runs `bun pm pack --ignore-scripts` into a temporary directory and checks
 * that exact archive; with --archive it checks the given bytes (the archive an adopter pins).
 * The archive must hold exactly ALLOWLIST as regular files, the Apache-2.0 LICENSE bytes, the
 * exact manifest (private, Bun-only engines, one pinned runtime dependency, no install or
 * lifecycle scripts) and sources that import only node: builtins, each other and declared
 * dependencies, with no secret-shaped content. The installed dependency closure must match
 * DEPENDENCY_CLOSURE with permissive licenses and no install scripts. Finally the archive is
 * extracted outside the workspace and imported by Bun 1.4.2. Exit 0 pass, 1 fail, 2 usage.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

export const REQUIRED_BUN = '1.4.2';
/** The closed list of files the archive may carry: sources (which are also the types), manifest, license. */
export const FILES = [
  'LICENSE',
  'src/index.ts',
  'src/oidc.ts',
  'src/sessions.ts',
  'src/store-port.ts',
  'src/transactions.ts',
];
export const ALLOWLIST = ['package/package.json', ...FILES.map((f) => `package/${f}`)].sort();
/** SHA-256 of the Apache License 2.0 text, identical to the Omni root LICENSE. */
export const LICENSE_SHA256 = '7a2e7520cec98f2f7b308bd7a52944d4deb2beca0e0314cc812e6fe8aa04e905';
export const RUNTIME_DEPENDENCIES = { 'openid-client': '6.8.8' };
/** Every package the runtime dependency brings, with the version the lockfile resolves. */
export const DEPENDENCY_CLOSURE: Record<string, string> = {
  'openid-client': '6.8.8',
  jose: '6.2.12',
  oauth4webapi: '3.8.8',
};
export const ALLOWED_LICENSES = ['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD'];
export const EXPORTED_NAMES = [
  'CALLBACK_PATH',
  'CORE_LIMITS',
  'ConnectConfigError',
  'ConnectCore',
  'MAX_SKEW_SECONDS',
  'ProviderUnavailableError',
  'RETURN_PATH',
  'TRANSACTION_LIMITS',
  'TransactionStore',
  'callStore',
  'createConnectCore',
  'createOidcClient',
  'hashSecret',
  'newSetupCapability',
  'readClientSecret',
  'validateOidcSettings',
];
const EXPECTED_MANIFEST: Record<string, unknown> = {
  name: '@omni/connect',
  private: true,
  license: 'Apache-2.0',
  type: 'module',
  exports: { '.': { types: './src/index.ts', default: './src/index.ts' } },
  engines: { bun: REQUIRED_BUN },
  dependencies: RUNTIME_DEPENDENCIES,
};
const ALLOWED_SCRIPTS = ['typecheck', 'test', 'verify-pack'];
const FORBIDDEN_KEYS = ['optionalDependencies', 'peerDependencies', 'bundleDependencies', 'bundledDependencies'];
const MORE_FORBIDDEN = ['bin', 'main', 'module', 'browser', 'publishConfig', 'gypfile', 'workspaces'];
const INSTALL_SCRIPTS = ['preinstall', 'install', 'postinstall'];
const SECRETS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bsk_(?:live|test)_[A-Za-z0-9]{16,}/,
  /client_secret\s*[:=]\s*['"][^'"]{8,}/i,
  /lembr\.ai/,
];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;
const PACKAGE_DIR = join(import.meta.dir, '..');

export interface Entry {
  name: string;
  type: string;
  data: Uint8Array;
}
export interface Dependency {
  name: string;
  version: string;
  license: unknown;
  scripts: Record<string, string>;
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(Buffer.from(data)).digest('hex');

/** Gunzips and walks a ustar archive: name, type flag and bytes of every entry. */
export function readTarGz(bytes: Uint8Array): Entry[] {
  const tar = Bun.gunzipSync(new Uint8Array(bytes));
  const entries: Entry[] = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start: number, length: number) =>
      new TextDecoder().decode(header.subarray(start, start + length)).replace(/\0[\s\S]*$/, '');
    const prefix = field(345, 155);
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    entries.push({
      name: prefix ? `${prefix}/${field(0, 100)}` : field(0, 100),
      type: field(156, 1) || '0',
      data: tar.slice(offset + 512, offset + 512 + size),
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export function checkManifest(pkg: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [key, want] of Object.entries(EXPECTED_MANIFEST)) {
    if (!Bun.deepEquals(pkg[key], want, true)) errors.push(`package.json ${key} must be ${JSON.stringify(want)}`);
  }
  const files = Array.isArray(pkg.files) ? [...pkg.files].sort() : null;
  if (!Bun.deepEquals(files, [...FILES].sort())) errors.push(`package.json files must be ${JSON.stringify(FILES)}`);
  for (const key of [...FORBIDDEN_KEYS, ...MORE_FORBIDDEN])
    if (key in pkg) errors.push(`package.json must not declare ${key}`);
  for (const name of Object.keys((pkg.scripts as object) ?? {})) {
    if (!ALLOWED_SCRIPTS.includes(name)) errors.push(`package.json script not allowed: ${name}`);
  }
  return errors;
}

export function checkSource(name: string, source: string): string[] {
  const errors: string[] = [];
  for (const [, spec = ''] of source.matchAll(SPECIFIER)) {
    const local = spec.startsWith('./') && ALLOWLIST.includes(`package/src/${spec.slice(2)}.ts`);
    if (!local && !spec.startsWith('node:') && !(spec in RUNTIME_DEPENDENCIES)) {
      errors.push(`${name} imports undeclared module ${spec}`);
    }
  }
  if (/\brequire\s*\(|\bimport\s*\(\s*[^'"\s]/.test(source)) errors.push(`${name} has a non-literal import or require`);
  return errors;
}

/** The archive's own contract: allowlist, regular files, license, manifest, imports and secrets. */
export function checkEntries(entries: Entry[]): string[] {
  const errors: string[] = [];
  const names = entries.map((e) => e.name);
  for (const name of names) if (!ALLOWLIST.includes(name)) errors.push(`not in the allowlist: ${name}`);
  for (const name of ALLOWLIST) if (!names.includes(name)) errors.push(`missing from the archive: ${name}`);
  if (new Set(names).size !== names.length) errors.push('duplicate archive entries');
  for (const entry of entries) {
    if (entry.type !== '0') errors.push(`not a regular file: ${entry.name}`);
    const text = new TextDecoder().decode(entry.data);
    if (SECRETS.some((re) => re.test(text))) errors.push(`forbidden content in ${entry.name}`);
    if (entry.name.endsWith('.ts')) errors.push(...checkSource(entry.name, text));
  }
  const license = entries.find((e) => e.name === 'package/LICENSE');
  if (license && sha256(license.data) !== LICENSE_SHA256) errors.push('LICENSE is not the Apache-2.0 text');
  const manifest = entries.find((e) => e.name === 'package/package.json');
  try {
    if (manifest) errors.push(...checkManifest(JSON.parse(new TextDecoder().decode(manifest.data))));
  } catch {
    errors.push('package.json is not JSON');
  }
  return errors;
}

/** The installed runtime closure, resolved the way Bun's linker lays it out. */
export function readClosure(packageDir: string): Dependency[] {
  const found = new Map<string, Dependency>();
  const visit = (name: string, from: string) => {
    const candidates = [join(from, 'node_modules', name), join(dirname(from), name)];
    const dir = candidates
      .map((c) => {
        try {
          return realpathSync(c);
        } catch {
          return null;
        }
      })
      .find((c) => c !== null);
    if (!dir) throw new Error(`dependency ${name} is not installed`);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (found.has(name)) return;
    found.set(name, { name, version: pkg.version, license: pkg.license, scripts: pkg.scripts ?? {} });
    for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir);
  };
  for (const name of Object.keys(RUNTIME_DEPENDENCIES)) visit(name, packageDir);
  return [...found.values()];
}

export function checkClosure(closure: Dependency[]): string[] {
  const errors: string[] = [];
  const names = closure.map((d) => d.name).sort();
  if (!Bun.deepEquals(names, Object.keys(DEPENDENCY_CLOSURE).sort()))
    errors.push(`dependency closure is ${names.join(', ')}`);
  for (const dep of closure) {
    if (DEPENDENCY_CLOSURE[dep.name] !== dep.version)
      errors.push(`${dep.name}@${dep.version} is not the pinned version`);
    if (typeof dep.license !== 'string' || !ALLOWED_LICENSES.includes(dep.license)) {
      errors.push(`${dep.name} license ${JSON.stringify(dep.license)} is not on the permissive allowlist`);
    }
    for (const s of INSTALL_SCRIPTS) if (dep.scripts[s]) errors.push(`${dep.name} has an install script: ${s}`);
  }
  return errors;
}

const SMOKE = `import * as connect from '@omni/connect';
let rejectsHttp = false;
try {
  connect.validateOidcSettings({ issuer: 'http://issuer.invalid', clientId: 'c', clientSecretFile: '/s', origin: 'https://a.invalid' });
} catch (error) {
  rejectsHttp = error instanceof connect.ConnectConfigError;
}
const resolved = Bun.resolveSync('@omni/connect', import.meta.dir);
console.log(JSON.stringify({ bun: Bun.version, exports: Object.keys(connect).sort(), rejectsHttp, resolved }));
`;

/** Extracts the archive outside the workspace and imports it with this Bun. */
export function smokeImport(entries: Entry[], packageDir: string): string[] {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'connect-pack-')));
  try {
    for (const entry of entries) {
      const path = join(root, 'node_modules/@omni/connect', entry.name.replace(/^package\//, ''));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, entry.data);
    }
    for (const name of Object.keys(RUNTIME_DEPENDENCIES)) {
      symlinkSync(realpathSync(join(packageDir, 'node_modules', name)), join(root, 'node_modules', name));
    }
    writeFileSync(join(root, 'smoke.ts'), SMOKE);
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: root, NO_COLOR: '1' };
    const run = spawnSync(process.execPath, ['smoke.ts'], { cwd: root, env, encoding: 'utf8' });
    if (run.status !== 0) return [`import of the packed archive failed: ${run.stderr.trim().split('\n').at(-1)}`];
    const out = JSON.parse(run.stdout.trim().split('\n').at(-1) ?? '{}');
    const errors: string[] = [];
    if (out.bun !== REQUIRED_BUN) errors.push(`smoke ran on Bun ${out.bun}`);
    if (!String(out.resolved).startsWith(join(root, 'node_modules/@omni/connect/')))
      errors.push('smoke did not import the archive');
    if (!Bun.deepEquals(out.exports, EXPORTED_NAMES)) errors.push(`exports are ${JSON.stringify(out.exports)}`);
    if (out.rejectsHttp !== true) errors.push('packed validateOidcSettings accepted an http issuer');
    return errors;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Runs `bun pm pack --ignore-scripts` and returns the archive path. */
export function packArchive(destination: string): string {
  const run = spawnSync(process.execPath, ['pm', 'pack', '--ignore-scripts', '--quiet', '--destination', destination], {
    cwd: PACKAGE_DIR,
    encoding: 'utf8',
  });
  const archives = readdirSync(destination).filter((f) => f.endsWith('.tgz'));
  if (run.status !== 0 || archives.length !== 1) throw new Error(`bun pm pack failed: ${run.stderr.trim()}`);
  return join(destination, archives[0] ?? '');
}

export function verify(archivePath?: string): { archive: string; sha256: string; entries: string[]; errors: string[] } {
  const scratch = archivePath ? null : mkdtempSync(join(tmpdir(), 'connect-pack-out-'));
  let archive = archivePath ?? '';
  let bytes: Uint8Array;
  try {
    archive = scratch ? packArchive(scratch) : archive;
    bytes = readFileSync(archive);
  } finally {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
  const entries = readTarGz(bytes);
  const errors = [
    ...checkEntries(entries),
    ...checkClosure(readClosure(PACKAGE_DIR)),
    ...smokeImport(entries, PACKAGE_DIR),
  ];
  return {
    archive: archivePath ? archive : basename(archive),
    sha256: sha256(bytes),
    entries: entries.map((e) => e.name),
    errors,
  };
}

function main(argv: string[]): number {
  const out = (line: string) => process.stdout.write(`${line}\n`);
  if (Bun.version !== REQUIRED_BUN) {
    process.stderr.write(`verify-pack: Bun ${Bun.version} is not the claimed runtime ${REQUIRED_BUN}\n`);
    return 2;
  }
  if (argv.length !== 0 && (argv.length !== 2 || argv[0] !== '--archive')) {
    process.stderr.write('usage: bun scripts/verify-pack.ts [--archive <file.tgz>]\n');
    return 2;
  }
  const report = verify(argv[1]);
  out(`verify-pack: bun ${Bun.version}, archive ${report.archive}, sha256 ${report.sha256}`);
  for (const name of report.entries) out(`  ${name}`);
  for (const error of report.errors) out(`verify-pack: FAIL ${error}`);
  out(report.errors.length === 0 ? 'verify-pack: PASS' : `verify-pack: FAIL (${report.errors.length})`);
  return report.errors.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
