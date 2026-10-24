// The Automagik plugins this Omni release is tested with and ships: the Bot team
// (@automagik/bots-dsh) its channels and canvases build on, and the welcome
// (@automagik/welcome-dsh). They live in automagik-dev/automagik; apps/automagik.json pins one
// of its releases (a copy of that release's plugins.json: the commit, and each tarball's file
// and integrity), so Omni fetches exactly those bytes and refuses any others.
//
//   node apps/automagik.mjs source [dir]     the pinned commit's plugin folders (git, sparse)
//                                            into dir, default apps/.automagik/<commit>; prints dir
//   node apps/automagik.mjs tarballs <dir>   the pinned tarballs into dir, each checked against its
//                                            integrity; prints one file per line
//
// AUTOMAGIK_TARBALLS names a folder that already holds the tarballs (an offline build): they
// are taken from there, checked the same way. Plain Node, no dependencies: the admin UI image
// runs it in a bare node image, the CLI and server image build through Bun.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APPS = dirname(fileURLToPath(import.meta.url));
export const PIN_FILE = join(APPS, 'automagik.json');

const COMMIT = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
const FILE = /^[a-z0-9][a-z0-9._-]*\.tgz$/;
const INTEGRITY = /^sha512-[A-Za-z0-9+/]{86}==$/;

/** The pin, checked: a release of automagik-dev/automagik, its commit, and each plugin's tarball. */
export function readPin(file = PIN_FILE) {
  const pin = JSON.parse(readFileSync(file, 'utf8'));
  if (pin.repository !== 'https://github.com/automagik-dev/automagik')
    throw new Error(`${file}: repository is ${pin.repository}`);
  if (!VERSION.test(pin.version ?? '')) throw new Error(`${file}: version ${pin.version}`);
  if (!COMMIT.test(pin.commit ?? '')) throw new Error(`${file}: commit ${pin.commit}`);
  const packages = Object.entries(pin.packages ?? {});
  if (packages.length === 0) throw new Error(`${file}: no packages`);
  for (const [name, pkg] of packages) {
    if (!/^@automagik\/[a-z0-9-]+$/.test(name)) throw new Error(`${file}: package ${name}`);
    if (pkg.version !== pin.version || !FILE.test(pkg.file ?? '') || !INTEGRITY.test(pkg.integrity ?? ''))
      throw new Error(`${file}: ${name} is not a pinned tarball`);
  }
  return pin;
}

/** Where the release keeps a tarball. */
export const tarballUrl = (pin, pkg) => `${pin.repository}/releases/download/v${pin.version}/${pkg.file}`;

export const integrityOf = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** A release file's bytes, downloaded with retries (exponential back-off). */
async function download(url, { fetchImpl, attempts, wait }) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
      if (!response.ok) throw new Error(`${url} answered ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt >= attempts) throw new Error(`could not download ${url}: ${error.message}`);
      await wait(1000 * 2 ** attempt);
    }
  }
}

/** One pinned tarball at `path`: kept when its bytes are right, else fetched and checked. */
async function fetchTarball(name, pkg, path, { pin, from, ...transport }) {
  const good = (bytes) => integrityOf(bytes) === pkg.integrity;
  if (existsSync(path) && good(readFileSync(path))) return;
  const bytes = from ? readFileSync(join(resolve(from), pkg.file)) : await download(tarballUrl(pin, pkg), transport);
  if (!good(bytes))
    throw new Error(
      `${name}: ${pkg.file} is not the pinned tarball (integrity ${integrityOf(bytes)}, pinned ${pkg.integrity})`,
    );
  writeFileSync(`${path}.part`, bytes);
  renameSync(`${path}.part`, path);
}

/**
 * Put every pinned tarball in `dir`: kept when already there with the right bytes, else taken
 * from `from` (AUTOMAGIK_TARBALLS) or downloaded from the release, with retries. Bytes whose
 * integrity is not the pinned one are refused. Returns [{ name, version, file, path }].
 */
export async function fetchTarballs(
  dir,
  { pin = readPin(), from = process.env.AUTOMAGIK_TARBALLS, fetchImpl = fetch, attempts = 4, wait = sleep } = {},
) {
  mkdirSync(dir, { recursive: true });
  const out = [];
  for (const [name, pkg] of Object.entries(pin.packages)) {
    const path = join(dir, pkg.file);
    await fetchTarball(name, pkg, path, { pin, from, fetchImpl, attempts, wait });
    out.push({ name, version: pkg.version, file: pkg.file, path });
  }
  return out;
}

/**
 * The pinned commit's plugin folders (apps/<name>-dsh for each pinned package) in `dir`,
 * fetched with git, sparse and shallow; kept when `dir` already holds that commit.
 * Tests compose the Bot team's runtime from there (its test helpers are not in the tarball).
 */
export function checkoutSource(dir = join(APPS, '.automagik', readPin().commit), { pin = readPin() } = {}) {
  const git = (args, cwd = dir) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (existsSync(join(dir, '.git'))) {
    try {
      if (git(['rev-parse', 'HEAD']) === pin.commit) return dir;
    } catch {}
  }
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  git(['init', '-q']);
  git(['remote', 'add', 'origin', pin.repository]);
  const folders = Object.keys(pin.packages).map((name) => `/apps/${name.slice('@automagik/'.length)}/`);
  git(['sparse-checkout', 'set', '--no-cone', ...folders]);
  git(['fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', pin.commit]);
  git(['checkout', '-q', 'FETCH_HEAD']);
  return dir;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, dir] = process.argv.slice(2);
  if (command === 'source') {
    process.stdout.write(`${checkoutSource(dir ? resolve(dir) : undefined)}\n`);
  } else if (command === 'tarballs' && dir) {
    for (const tarball of await fetchTarballs(resolve(dir))) process.stdout.write(`${tarball.path}\n`);
  } else {
    process.stderr.write('usage: node apps/automagik.mjs source [dir] | tarballs <dir>\n');
    process.exit(2);
  }
}
