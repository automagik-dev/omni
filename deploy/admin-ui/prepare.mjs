// Assembles what the Omni Admin UI image runs, from this Omni checkout, into <out>/:
//
//   <out>/runtime/node_modules   the pinned DeepSeek Harness (runtime/package.json + lock)
//   <out>/profile/               the dsh profile the image starts: package.json,
//                                cordis.patch.yml, pnpm-workspace.yaml, vendor/ (the plugins'
//                                tarballs) and node_modules holding only the plugins
//
// The plugins are the @automagik packages profile/package.json depends on: Omni's own, packed
// from this checkout's apps/*-dsh with `npm pack` at their own version (the Omni release of their
// last change, at most this Omni's), and Automagik's (the
// Bot team and the welcome), the tarballs of the Automagik release apps/automagik.json pins,
// downloaded (or taken from AUTOMAGIK_TARBALLS) and refused unless their integrity is the
// pinned one. The image ships exactly what each package publishes. Their @deepseek-ai peers
// are not installed again: dsh supplies them. Native packages are per platform: run this on the
// platform the image is for.
// Usage: node deploy/admin-ui/prepare.mjs <out>
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchTarballs, readPin } from '../../apps/automagik.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OMNI = resolve(HERE, '..', '..');
const OUT = resolve(process.argv[2] ?? join(HERE, 'build'));
const VENDOR = 'vendor';
// @openuidev/lang-core and others phone home from install scripts unless told not to.
const env = {
  ...process.env,
  DO_NOT_TRACK: '1',
  npm_config_fund: 'false',
  npm_config_audit: 'false',
  npm_config_update_notifier: 'false',
};
const npm = (args, cwd) => execFileSync('npm', args, { cwd, env, stdio: ['ignore', 'inherit', 'inherit'] });
const say = (message) => console.log(`[admin-ui] ${message}`);
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

const version = readJson(join(OMNI, 'package.json')).version;
// An Omni release (<major>.<yymmdd>.<n>) no newer than `omni` (scripts/lib/plugin-versions.ts).
const atMost = (plugin, omni) => {
  if (!/^\d+\.\d{6}\.\d+$/.test(plugin)) return false;
  const [a, b] = [plugin, omni].map((v) => v.split('.').map(Number));
  const at = a.findIndex((part, index) => part !== b[index]);
  return at === -1 || a[at] < b[at];
};
const apps = join(OMNI, 'apps');
const folders = Object.fromEntries(
  readdirSync(apps)
    .filter((name) => name.endsWith('-dsh') && existsSync(join(apps, name, 'package.json')))
    .map((name) => [readJson(join(apps, name, 'package.json')).name, join(apps, name)]),
);
// Omni's own plugins (apps/*-dsh, packed at their own version), Automagik's (the pinned release's
// tarballs) and add-ons from npm at the exact version the profile names (vetted there).
const automagik = readPin();
const shipped = [];
const fromAutomagik = [];
const addons = {};
for (const [name, spec] of Object.entries(readJson(join(HERE, 'profile', 'package.json')).dependencies)) {
  if (folders[name]) shipped.push(name);
  else if (automagik.packages[name]) fromAutomagik.push(name);
  else if (/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(spec)) addons[name] = spec;
  else
    throw new Error(
      `profile/package.json depends on ${name}@${spec}: neither apps/*-dsh, nor Automagik's (apps/automagik.json), nor an add-on at an exact version`,
    );
}

// The DeepSeek Harness the image runs is the one Omni's plugins are tested against.
const tested = readJson(join(apps, 'omni-channels-dsh', 'dev', 'harness', 'package.json')).dependencies[
  '@deepseek-ai/dsh'
];
const pinned = readJson(join(HERE, 'runtime', 'package.json')).dependencies['@deepseek-ai/dsh'];
if (tested !== pinned)
  throw new Error(`runtime/package.json pins dsh ${pinned}, but Omni's plugins are tested on ${tested}`);

rmSync(OUT, { recursive: true, force: true });
const runtimeDir = join(OUT, 'runtime');
mkdirSync(runtimeDir, { recursive: true });
for (const file of ['package.json', 'package-lock.json']) cpSync(join(HERE, 'runtime', file), join(runtimeDir, file));
say(`installing the DeepSeek Harness ${pinned}`);
npm(['ci', '--omit=dev'], runtimeDir);

say(`packing ${shipped.join(', ')}`);
const packs = join(OUT, 'packs');
mkdirSync(packs, { recursive: true });
const packed = shipped.map((name) => {
  const [info] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', packs], { cwd: folders[name], env, encoding: 'utf8' }),
  );
  if (info.name !== name) throw new Error(`${folders[name]} packs ${info.name}, not ${name}`);
  if (!atMost(info.version, version))
    throw new Error(
      `${name} is ${info.version}: an Omni plugin carries an Omni release, at most this Omni's ${version}`,
    );
  return { name, version: info.version, tarball: join(packs, info.filename) };
});
say(`taking ${fromAutomagik.join(', ')} from Automagik ${automagik.version}`);
const fetched = (await fetchTarballs(packs, { pin: automagik })).filter((tarball) =>
  fromAutomagik.includes(tarball.name),
);
packed.push(...fetched.map(({ name, version: at, path }) => ({ name, version: at, tarball: path })));

// The profile is installed the way DSH installs any plugin: the pinned dsh's own
// `dsh plugin --profile omni install` (pnpm from the runtime, hoisted, no install scripts) in
// a scratch DSH home; its result, pnpm's lockfile with it, is the profile the image ships.
const dshHome = join(OUT, 'dsh-home');
const installDir = join(dshHome, 'profiles', 'omni');
mkdirSync(join(installDir, VENDOR), { recursive: true });
const profile = readJson(join(HERE, 'profile', 'package.json'));
// The profile's package.json names the tarballs it ships (file:vendor/…): dsh's pnpm,
// installing a market plugin later, resolves Omni's own there, offline.
for (const plugin of packed) {
  cpSync(plugin.tarball, join(installDir, VENDOR, basename(plugin.tarball)));
  profile.dependencies[plugin.name] = `file:${VENDOR}/${basename(plugin.tarball)}`;
}
writeFileSync(join(installDir, 'package.json'), `${JSON.stringify(profile, null, 2)}\n`);
for (const file of ['cordis.patch.yml', 'pnpm-workspace.yaml'])
  cpSync(join(HERE, 'profile', file), join(installDir, file));
execFileSync(
  process.execPath,
  [
    join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
    'plugin',
    '--profile',
    'omni',
    'install',
    '--prod',
    '--ignore-scripts',
  ],
  {
    cwd: installDir,
    env: { ...env, DSH_HOME: dshHome, PATH: `${join(runtimeDir, 'node_modules', '.bin')}:${env.PATH ?? ''}` },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
for (const [name, wanted] of Object.entries(addons)) {
  const got = readJson(join(installDir, 'node_modules', ...name.split('/'), 'package.json')).version;
  if (got !== wanted) throw new Error(`${name} installed at ${got}, not the vetted ${wanted}`);
}
// DSH's own record of the build's install (.plugin-manager) is not part of what ships.
rmSync(join(installDir, '.plugin-manager'), { recursive: true, force: true });
const profileDir = join(OUT, 'profile');
cpSync(installDir, profileDir, { recursive: true, verbatimSymlinks: true });
rmSync(dshHome, { recursive: true, force: true });
// server.mjs puts the profile in place again whenever this id changes.
writeFileSync(join(profileDir, '.build-id'), `${version}+${new Date().toISOString()}\n`);
rmSync(packs, { recursive: true, force: true });

const dsh = readJson(join(runtimeDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')).version;
writeFileSync(
  join(OUT, 'versions.json'),
  `${JSON.stringify({ omni: version, automagik: automagik.version, dsh, plugins: Object.fromEntries(packed.map((plugin) => [plugin.name, plugin.version])), addons }, null, 2)}\n`,
);
say(`ready: Omni ${version}, dsh ${dsh}`);
