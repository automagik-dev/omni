/**
 * Every route the v2 API serves, read from the source (as the mount-order test does), so
 * the OpenAPI coverage gate needs no database or live server: the routers routes/v2/index.ts
 * mounts, and what app.ts mounts or declares under /api/v2 itself (health, channel
 * webhooks, platform tenants).
 *
 * `v2Routes.route('/chats', chatsRoutes)` in index.ts plus `chatsRoutes.get('/:id', …)` in
 * chats.ts is `get /chats/{id}`. A router mounted at the root for a few extra paths also
 * yields catch-alls there (`/`, `/{id}`), which no client calls and the docs leave out.
 * A router a function builds (`app.route('/api/v2/login', loginApiRoutes(login))`) is read
 * from that function's body, under the name it gives the router there.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dir, '..');
const V2_DIR = join(SRC, 'routes/v2');
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/** `import { fooRoutes } from './foo';` -> fooRoutes => foo */
function importedFiles(src: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const [, names = '', file = ''] of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/([\w-]+)'/g)) {
    for (const raw of names.split(',')) {
      const ident = raw
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (ident) map.set(ident, file);
    }
  }
  return map;
}

const openApiPath = (path: string) => path.replace(/:(\w+)/g, '{$1}').replace(/\/+$/, '') || '/';

/** The body of `export function name(…) {…}` in `src`, up to its closing brace at column 0. */
function factoryBody(src: string, name: string): string {
  const start = src.search(new RegExp(`^export function ${name}\\(`, 'm'));
  if (start < 0) return '';
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end < 0 ? undefined : end);
}

/** The routes `ident` declares in `file`, under `prefix`; for a factory, the router it builds. */
function routesOf(file: string, ident: string, prefix: string, into: Set<string>, factory = false): void {
  if (!existsSync(file)) return;
  const whole = readFileSync(file, 'utf8');
  const src = factory ? factoryBody(whole, ident) : whole;
  const router = factory ? /\bconst (\w+) = new (?:OpenAPI)?Hono\b/.exec(src)?.[1] : ident;
  if (!router) return;
  const pattern = new RegExp(`\\b${router}\\.(${METHODS.join('|')})\\(\\s*'([^']*)'`, 'g');
  for (const [, method = '', sub = ''] of src.matchAll(pattern)) {
    const full = openApiPath(`${prefix === '/' ? '' : prefix}${sub === '/' ? '' : sub}`);
    if (prefix === '/' && (full === '/' || /^\/\{\w+\}(\/|$)/.test(full))) continue;
    into.add(`${method} ${full}`);
  }
}

/** Routes as `method /path`, OpenAPI style (`{id}` for `:id`), relative to /api/v2. */
export function mountedRoutes(): string[] {
  const routes = new Set<string>();
  const index = readFileSync(join(V2_DIR, 'index.ts'), 'utf8');
  const files = importedFiles(index);
  for (const [, prefix = '', ident = ''] of index.matchAll(/^\s*v2Routes\.route\(\s*'([^']*)'\s*,\s*(\w+)\s*\)/gm)) {
    const file = files.get(ident);
    if (file) routesOf(join(V2_DIR, `${file}.ts`), ident, prefix, routes);
  }
  // app.ts: routers mounted under /api/v2 (not the v2 app itself, nor the spec's own route)
  // and the routes it declares there directly.
  const app = readFileSync(join(SRC, 'app.ts'), 'utf8');
  const appImports = new Map<string, string>();
  for (const [, names = '', file = ''] of app.matchAll(/import\s*\{([^}]+)\}\s*from\s*'\.\/(routes\/[\w/-]+)'/g)) {
    for (const raw of names.split(',')) {
      const ident = raw
        .trim()
        .split(/\s+as\s+/)
        .pop();
      if (ident) appImports.set(ident, file);
    }
  }
  for (const [, prefix = '', ident = '', call] of app.matchAll(
    /\bapp\.route\(\s*'\/api\/v2([^']*)'\s*,\s*(\w+)(\([^)]*\))?\s*\)/g,
  )) {
    const file = appImports.get(ident);
    if (file && ident !== 'openapiRoutes')
      routesOf(join(SRC, `${file}.ts`), ident, prefix || '/', routes, Boolean(call));
  }
  for (const [, method = '', path = ''] of app.matchAll(
    new RegExp(`\\bapp\\.(${METHODS.join('|')})\\(\\s*'\\/api\\/v2([^']*)'`, 'g'),
  )) {
    routes.add(`${method} ${openApiPath(path)}`);
  }
  return [...routes].sort();
}
