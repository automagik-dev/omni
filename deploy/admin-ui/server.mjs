// The Omni Admin UI image's one process: the Omni UI (DSH with Omni's plugins) behind the same
// contract the image has always kept for the Helm chart's adminUi workload.
//
//   PORT (8899) on HOST    GET /health answers "ok" once DSH is up (503 while it starts);
//                          everything else, WebSockets included, goes to DSH unchanged
//   OMNI_BASE_URL          the Omni this UI is linked to (in the chart: the omni-api Service)
//   OMNI_API_KEY           that Omni's key; it stays on the server (omni.json, 0600) and the
//                          browser never sees it. Without both, the UI signs in to an Omni
//                          itself (Connect Omni), the way the desktop app does
//   OMNI_UI_PUBLIC_URL     the URL people open (https://admin.example.com/): DSH advertises it
//                          and trusts its host. Unset, only loopback (a port-forward) is trusted
//   OMNI_HOME (/data)      everything this UI keeps: dsh/ is DSH_HOME, ui/ the plugins' home.
//                          Mount a volume there to keep Bots, Sessions and sign-ins
//
// DSH itself listens on 127.0.0.1 only and locks its UI with a launch token: the URL this
// prints at start ("open …?token=…", also in the pod's log) signs a browser in, and the
// cookie it mints lasts across restarts while OMNI_HOME is kept.
import { spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PROFILE = 'omni';
export const LINK_FILE = 'omni.json';
const STOP_GRACE_MS = 8_000;

const say = (message) => console.log(`[omni-ui] ${message}`);
const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

/** The image's settings from its environment; throws on a value it cannot use. */
export function configOf(env = process.env) {
  const port = Number(env.PORT || 8899);
  const dshPort = Number(env.DSH_PORT || port + 1);
  for (const [name, value] of [
    ['PORT', port],
    ['DSH_PORT', dshPort],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} must be a port number`);
  }
  if (dshPort === port) throw new Error('DSH_PORT must differ from PORT');
  let publicUrl = null;
  if (env.OMNI_UI_PUBLIC_URL?.trim()) {
    publicUrl = new URL(env.OMNI_UI_PUBLIC_URL.trim());
    if (publicUrl.protocol !== 'https:' && publicUrl.protocol !== 'http:')
      throw new Error('OMNI_UI_PUBLIC_URL must be an http(s) URL');
    if (!publicUrl.pathname.endsWith('/')) publicUrl.pathname = `${publicUrl.pathname}/`;
  }
  const home = resolve(env.OMNI_HOME?.trim() || '/data');
  const baseUrl = env.OMNI_BASE_URL?.trim() || null;
  const apiKey = env.OMNI_API_KEY?.trim() || null;
  return { host: env.HOST?.trim() || '0.0.0.0', port, dshPort, publicUrl, home, baseUrl, apiKey };
}

/** dsh's arguments: the profile, on loopback, advertising and trusting the public URL. */
export function dshArgsOf(config, bin) {
  const args = [bin, '--profile', PROFILE, '--no-open', '--host', '127.0.0.1', '--port', String(config.dshPort)];
  if (config.publicUrl) args.push('--public-url', config.publicUrl.href, '--trusted-host', config.publicUrl.host);
  return args;
}

/**
 * Link the plugins to OMNI_BASE_URL with OMNI_API_KEY: omni.json in their home (0600), as
 * Connect Omni writes it. What the file already holds (the market offer, a key's id) stays
 * unless the URL or the key changed. Returns false, writing nothing, without both settings.
 */
export function writeLink({ home, baseUrl, apiKey }) {
  if (!baseUrl || !apiKey) return false;
  const dir = join(home, 'ui');
  const path = join(dir, LINK_FILE);
  const url = baseUrl.replace(/\/api\/v2\/?$/, '').replace(/\/+$/, '');
  const current = readJson(path);
  const same = current?.url === url && current?.key === apiKey;
  const link = same
    ? current
    : { url, key: apiKey, keyId: null, scopes: [], pairedAt: new Date().toISOString(), keyExpiresAt: null };
  mkdirSync(dir, { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(link, null, 2)}\n`, { mode: 0o600 });
  chmodSync(temp, 0o600);
  renameSync(temp, path);
  return true;
}

// The packages in a node_modules folder, scoped ones as @scope/name.
function packagesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => !name.startsWith('.'))
    .flatMap((name) =>
      name.startsWith('@') ? readdirSync(join(dir, name)).map((inner) => `${name}/${inner}`) : [name],
    );
}

/**
 * Packages earlier images shipped under another name: the Bot team and the welcome were
 * @automagik/omni-dsh and @automagik/omni-ai-dsh while they lived in this repository. A new
 * image moves a profile it finds to the new names (installProfile), so DSH does not run two
 * copies of one plugin and the settings rows keep applying: DSH applies a profile row only to
 * the package its `name` names.
 */
export const RENAMED = Object.freeze({
  '@automagik/omni-dsh': '@automagik/bots-dsh',
  '@automagik/omni-ai-dsh': '@automagik/welcome-dsh',
});

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

/** A cordis patch file's text with each renamed package (and its subpaths) under its new name; null when unchanged. */
export function renamePatch(text, renamed = RENAMED) {
  let next = String(text);
  for (const [from, to] of Object.entries(renamed)) {
    next = next.replace(new RegExp(`(?<![\\w@/.-])${escapeRegExp(from)}(?![\\w.-])`, 'gm'), to);
  }
  return next === String(text) ? null : next;
}

/**
 * Move a profile from the renamed packages to the new names the shipped profile carries: the
 * old packages leave node_modules, and the profile's patch and DSH's own name the new ones. The
 * team's home ($OMNI_HOME/ui) is not touched.
 */
export function migrateRenamed({ target, dshHome, shipped, renamed = RENAMED }) {
  const moved = Object.entries(renamed).filter(([, to]) => Object.hasOwn(shipped.dependencies ?? {}, to));
  for (const [from] of moved)
    rmSync(join(target, 'node_modules', ...from.split('/')), { recursive: true, force: true });
  const only = Object.fromEntries(moved);
  for (const file of [join(target, 'cordis.patch.yml'), join(dshHome, 'cordis.patch.yml')]) {
    if (moved.length === 0 || !existsSync(file)) continue;
    const next = renamePatch(readFileSync(file, 'utf8'), only);
    if (next !== null) writeFileSync(file, next);
  }
  return moved.map(([from]) => from);
}

/**
 * Put the image's profile in place under DSH_HOME/profiles/omni. It is copied, not linked:
 * dsh routes a plugin's imports to its own packages only for files inside the profile. A
 * profile from the same image (.build-id) stays as it is. Another image's gets the shipped
 * packages, tarballs and package.json, keeping plugins added from the market; the settings
 * DSH keeps there (cordis.patch.yml, .plugin-manager/) are left alone.
 */
export function installProfile({ dshHome, source }) {
  const target = join(dshHome, 'profiles', PROFILE);
  const stamp = readFileSync(join(source, '.build-id'), 'utf8');
  const marker = join(target, '.omni-admin-ui-profile');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === stamp) return { target, installed: false };
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target, { recursive: true });
  } else {
    const shipped = readJson(join(source, 'package.json'));
    // A profile from an image that shipped the Bot team or the welcome under its old name.
    const replaced = migrateRenamed({ target, dshHome, shipped });
    for (const name of packagesIn(join(source, 'node_modules'))) {
      rmSync(join(target, 'node_modules', name), { recursive: true, force: true });
      cpSync(join(source, 'node_modules', name), join(target, 'node_modules', name), { recursive: true });
    }
    rmSync(join(target, 'vendor'), { recursive: true, force: true });
    cpSync(join(source, 'vendor'), join(target, 'vendor'), { recursive: true });
    const user = readJson(join(target, 'package.json')) ?? {};
    const added = Object.entries(user.dependencies ?? {}).filter(
      ([name]) => !Object.hasOwn(shipped.dependencies, name) && !replaced.includes(name),
    );
    if (added.length > 0) shipped.dependencies = { ...shipped.dependencies, ...Object.fromEntries(added) };
    const bundles = shipped.dsh.profile.bundles;
    shipped.dsh.profile.bundles = [
      ...bundles,
      ...(user.dsh?.profile?.bundles ?? []).filter((name) => !bundles.includes(name) && !replaced.includes(name)),
    ];
    writeFileSync(join(target, 'package.json'), `${JSON.stringify(shipped, null, 2)}\n`);
    for (const file of ['cordis.patch.yml', 'pnpm-workspace.yaml']) {
      if (!existsSync(join(target, file))) cpSync(join(source, file), join(target, file));
    }
  }
  writeFileSync(marker, stamp);
  return { target, installed: true };
}

/** The launch path (/…?token=…) in a line of dsh's output, or null. */
export function launchPathOf(text) {
  const match = String(text).match(/dsh web: https?:\/\/[^/\s]+(\/\S*token=\S+)/);
  return match ? match[1] : null;
}

/** The front door on PORT: /health, then a plain reverse proxy to DSH (WebSockets spliced). */
export function startGate({ host, port, dshPort, ready }) {
  const server = createServer((req, res) => {
    if (req.url === '/health' || req.url.startsWith('/health?')) {
      const up = ready();
      res.writeHead(up ? 200 : 503, { 'content-type': 'text/plain', 'cache-control': 'no-store' });
      res.end(up ? 'ok' : 'starting');
      return;
    }
    const upstream = request(
      { host: '127.0.0.1', port: dshPort, method: req.method, path: req.url, headers: req.headers },
      (reply) => {
        res.writeHead(reply.statusCode, reply.headers);
        reply.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('The Omni UI is not answering yet.\n');
    });
    req.pipe(upstream);
  });
  server.on('upgrade', (req, socket, head) => {
    const upstream = connect(dshPort, '127.0.0.1', () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    const close = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
  });
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, host, () => done(server));
  });
}

async function main() {
  const config = configOf();
  const dshHome = join(config.home, 'dsh');
  const env = { ...process.env, DSH_HOME: dshHome, OMNI_HOME: config.home, DO_NOT_TRACK: '1' };
  // The key reaches the plugins through omni.json only, not through DSH's environment.
  Reflect.deleteProperty(env, 'OMNI_API_KEY');
  if (writeLink(config)) say(`linked to ${config.baseUrl}`);
  else say('OMNI_BASE_URL and OMNI_API_KEY are not both set: sign in with Connect Omni');
  const { installed } = installProfile({ dshHome, source: join(HERE, 'profile') });
  if (installed) say('profile in place');

  let up = false;
  const gate = await startGate({ ...config, ready: () => up });
  say(`listening on ${config.host}:${config.port}`);
  const bin = join(HERE, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js');
  const dsh = spawn(process.execPath, dshArgsOf(config, bin), {
    cwd: config.home,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const origin = config.publicUrl ? config.publicUrl.origin : `http://127.0.0.1:${config.port}`;
  const relay = (chunk) => {
    process.stdout.write(chunk);
    const launch = launchPathOf(chunk);
    if (launch && !up) {
      up = true;
      say(`open ${origin}${launch}`);
    }
  };
  dsh.stdout.on('data', relay);
  dsh.stderr.on('data', relay);

  let stopping = false;
  const stop = (code) => {
    if (stopping) return;
    stopping = true;
    gate.close();
    if (dsh.exitCode === null) dsh.kill('SIGTERM');
    setTimeout(() => {
      try {
        dsh.kill('SIGKILL');
      } catch {}
      process.exit(code);
    }, STOP_GRACE_MS).unref();
  };
  process.on('SIGINT', () => stop(0));
  process.on('SIGTERM', () => stop(0));
  // A DSH that stops by itself takes the container with it, so Kubernetes restarts it.
  dsh.on('exit', (code, signal) => {
    say(`DSH exited (${signal ?? code})`);
    process.exit(stopping ? 0 : 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[omni-ui] ${error.message}\n`);
    process.exit(1);
  });
}
