#!/usr/bin/env bun
/**
 * Does each of Omni's own DSH plugins (apps/*-dsh) work with the oldest Omni it declares?
 *
 *   bun scripts/plugin-compat.ts            check every plugin against its `engines.omni` minimum
 *   bun scripts/plugin-compat.ts oldest     also say the oldest recent release that serves all it uses
 *
 * What a plugin uses: every Omni API path its own source names as a string or template literal
 * (`call('GET', \`/chats/${id}\`)`, `omniFetch(url, 'POST', '/api/v2/login/connect')`, a prompt that
 * tells the model to read `/instances`), with the HTTP method when the literal follows one. The
 * generated route catalogue (src/host/omni-routes.js) and bundles are not uses: they list what the
 * Omni it was built from serves, which the model reads at run time from the Omni it is linked to.
 *
 * What a release serves: its /api/v2 routes, read from its source at the tag v<version> the way
 * the plugin's own build reads them (apps/omni-channels-dsh/scripts/omni-routes.mjs), with the
 * operations its OpenAPI registry declares (packages/api/src/schemas/openapi), and the few
 * endpoints outside /api/v2 a plugin calls, each held to the declaration that serves it.
 *
 * It proves that every API path a plugin names exists, with that method, in the minimum release.
 * It does not prove the request and response shapes match there, nor anything about calls whose
 * path is built at run time (omni_call runs whatever the model picks; those are checked against
 * the linked Omni's own catalogue then).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
// @ts-expect-error -- plain Node ESM without types: the plugin's own route reader.
import { sourceRoutes } from '../apps/omni-channels-dsh/scripts/omni-routes.mjs';
import { minimumOf, ownPlugins, releaseCommit } from './lib/plugin-versions';

const repoRoot = join(import.meta.dir, '..');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Method = (typeof METHODS)[number];

/** One operation: a method and a path under the server root, `{}` for each parameter, `*` for the rest. */
export interface Operation {
  method: Method;
  path: string;
}
export interface Use {
  /** null when the source does not say which method. */
  method: Method | null;
  path: string;
  file: string;
}

/** The release source the surface is read from. */
const API_SOURCES = ['packages/api/src/routes/v2', 'packages/api/src/schemas/openapi'];

/**
 * Endpoints outside /api/v2 a plugin calls, and the declaration that serves each: present when
 * that file holds that literal at the release.
 */
export const OUTSIDE_V2: { method: Method; path: string; file: string; literal: string }[] = [
  { method: 'POST', path: '/api/auth/device/code', file: 'packages/api/src/login/auth.ts', literal: "'/device/code'" },
  {
    method: 'POST',
    path: '/api/auth/device/token',
    file: 'packages/api/src/login/auth.ts',
    literal: "'/device/token'",
  },
  {
    method: 'GET',
    path: '/api/market/index.json',
    file: 'packages/api/src/market/routes.ts',
    literal: "'/index.json'",
  },
];

const normalize = (path: string) =>
  path
    .replace(/\{[^}]*\}/g, '{}')
    .replace(/:\w+/g, '{}')
    .replace(/\/+$/, '') || '/';

/** Every operation the API source under `dir` (a checkout's root) declares under /api/v2. */
function v2Operations(dir: string): Operation[] {
  const ops: Operation[] = [];
  for (const route of (sourceRoutes(join(dir, 'packages/api')) ?? []) as { method: Method; path: string }[])
    ops.push({ method: route.method, path: normalize(`/api/v2${route.path}`) });
  const openapi = join(dir, 'packages/api/src/schemas/openapi');
  if (existsSync(openapi)) {
    for (const file of readdirSync(openapi).filter((name) => name.endsWith('.ts'))) {
      const text = readFileSync(join(openapi, file), 'utf8');
      for (const block of text.split('registerPath(').slice(1)) {
        const head = block.slice(0, 800);
        const method = /\bmethod:\s*'(get|post|put|patch|delete)'/.exec(head)?.[1];
        const path = /\bpath:\s*'([^']+)'/.exec(head)?.[1];
        if (method && path) ops.push({ method: method.toUpperCase() as Method, path: normalize(`/api/v2${path}`) });
      }
    }
  }
  return ops;
}

/** What Omni serves at `ref` (a release tag or commit), or in this working tree when `ref` is null. */
export function apiSurface(ref: string | null, root = repoRoot): Operation[] {
  const outside = (read: (file: string) => string | null) =>
    OUTSIDE_V2.filter((entry) => read(entry.file)?.includes(entry.literal)).map(({ method, path }) => ({
      method,
      path,
    }));
  if (ref === null) {
    const read = (file: string) => (existsSync(join(root, file)) ? readFileSync(join(root, file), 'utf8') : null);
    return [...v2Operations(root), ...outside(read)];
  }
  const dir = mkdtempSync(join(tmpdir(), 'omni-api-surface-'));
  try {
    const present = API_SOURCES.filter((path) => {
      try {
        execFileSync('git', ['cat-file', '-e', `${ref}:${path}`], { cwd: root, stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    });
    if (present.length > 0) {
      const archive = execFileSync('git', ['archive', '--format=tar', ref, '--', ...present], {
        cwd: root,
        maxBuffer: 256 * 1024 * 1024,
      });
      execFileSync('tar', ['-x', '-C', dir], { input: archive });
    }
    const read = (file: string) => {
      try {
        return execFileSync('git', ['show', `${ref}:${file}`], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
      } catch {
        return null;
      }
    };
    return [...v2Operations(dir), ...outside(read)];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A template literal's text with each `${…}` as `{}`, braces and nested literals included. */
function templateText(source: string, start: number): { text: string; end: number } | null {
  let text = '';
  for (let at = start + 1; at < source.length; at++) {
    const char = source[at];
    if (char === '`') return { text, end: at };
    if (char === '\\') {
      text += source[at + 1] ?? '';
      at++;
    } else if (char === '$' && source[at + 1] === '{') {
      let depth = 0;
      for (at += 1; at < source.length; at++) {
        if (source[at] === '{') depth++;
        else if (source[at] === '}' && --depth === 0) break;
      }
      text += '{}';
    } else text += char;
  }
  return null;
}

/** Every string and template literal in `source`, with where it starts. */
function literals(source: string): { text: string; index: number }[] {
  const found: { text: string; index: number }[] = [];
  for (let at = 0; at < source.length; at++) {
    const char = source[at];
    if (char === '/' && source[at + 1] === '/') {
      at = source.indexOf('\n', at);
      if (at === -1) break;
    } else if (char === '/' && source[at + 1] === '*') {
      at = source.indexOf('*/', at + 2);
      if (at === -1) break;
      at++;
    } else if (char === '`') {
      const template = templateText(source, at);
      if (!template) break;
      found.push({ text: template.text, index: at });
      at = template.end;
    } else if (char === "'" || char === '"') {
      let end = at + 1;
      while (end < source.length && source[end] !== char && source[end] !== '\n') end += source[end] === '\\' ? 2 : 1;
      found.push({ text: source.slice(at + 1, end), index: at });
      at = end;
    }
  }
  return found;
}

/** The plugin's own source files: what it runs and what it tells the model, never generated catalogues or bundles. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (path: string) => {
    for (const name of readdirSync(path)) {
      const full = join(path, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(m?js|jsx)$/.test(name) && !name.endsWith('.bundle.js') && name !== 'omni-routes.js')
        files.push(full);
    }
  };
  if (existsSync(join(dir, 'src'))) walk(join(dir, 'src'));
  if (existsSync(join(dir, 'index.js'))) files.push(join(dir, 'index.js'));
  return files.sort();
}

/** Top-level /api/v2 segments of the surface: a literal is an API path only when it starts with one. */
const segmentsOf = (surface: Operation[]) =>
  new Set(surface.map((op) => op.path.split('/')[3]).filter((segment): segment is string => Boolean(segment)));

/** Every Omni API path the plugin in `dir` names, judged by what `surface` (this Omni's) could serve. */
export function pluginUses(dir: string, surface: Operation[]): Use[] {
  const v2 = segmentsOf(surface);
  const outside = new Set(OUTSIDE_V2.map((entry) => entry.path.split('/')[2]));
  const uses = new Map<string, Use>();
  for (const file of sourceFiles(dir)) {
    const source = readFileSync(file, 'utf8');
    for (const { text, index } of literals(source)) {
      // A literal that is a path, or paths named in a sentence (a prompt telling the model to read one).
      const named = text.startsWith('/')
        ? [{ raw: text.split(/[?#\s]/)[0] ?? '', at: index }]
        : [...text.matchAll(/(?<=^|[\s("'(])\/[a-z][\w-]*(?:\/[\w{}.*-]+)*/g)].map((match) => ({
            raw: match[0],
            at: -1,
          }));
      for (const { raw, at } of named) {
        let path: string;
        if (raw.startsWith('/api/v2/')) path = raw;
        else if (raw.startsWith('/api/') && outside.has(raw.split('/')[2] ?? '')) path = raw;
        else if (v2.has(raw.split('/')[1] ?? '')) path = `/api/v2${raw}`;
        else continue;
        path = path.replace(/[.,;:]+$/, '');
        const before =
          at < 0 ? null : /'(GET|POST|PUT|PATCH|DELETE)'\s*,\s*$/.exec(source.slice(Math.max(0, at - 24), at));
        const use: Use = { method: (before?.[1] as Method) ?? null, path: normalize(path), file: relative(dir, file) };
        uses.set(`${use.method} ${use.path}`, uses.get(`${use.method} ${use.path}`) ?? use);
      }
    }
  }
  return [...uses.values()].sort(
    (a, b) => a.path.localeCompare(b.path) || String(a.method).localeCompare(String(b.method)),
  );
}

/** Whether `use` names an operation of `surface`: `{}` stands for one segment, `*` for the rest. */
export function serves(surface: Operation[], use: Use): boolean {
  const want = use.path.split('/');
  return surface.some((op) => {
    if (use.method !== null && op.method !== use.method) return false;
    const have = op.path.split('/');
    for (let index = 0; index < have.length; index++) {
      if (have[index] === '*') return true;
      if (index >= want.length) return false;
      if (have[index] === '{}' || want[index] === '{}') continue;
      if (have[index] !== want[index]) return false;
    }
    return have.length === want.length;
  });
}

const show = (use: Use) => `${use.method ?? 'any'} ${use.path} (${use.file})`;

export interface PluginCompat {
  dir: string;
  minimum: string | null;
  /** The release the uses were checked against: v<minimum>, or this tree while the minimum is pending. */
  against: string;
  uses: Use[];
  problems: string[];
}

/**
 * Check one plugin: every use must be served here (else this check cannot see it) and by its
 * minimum release. A minimum above the repository's version is pending (scripts/lib/plugin-versions.ts):
 * the next cut makes it this tree's release, so this tree is what it is checked against.
 */
export function checkPlugin(dir: string, range: string | null, repoVersion: string, root = repoRoot): PluginCompat {
  const here = apiSurface(null, root);
  const uses = pluginUses(join(root, dir), here);
  const minimum = minimumOf(range);
  const problems = uses.filter((use) => !serves(here, use)).map((use) => `this Omni serves no ${show(use)}`);
  if (minimum === null)
    return {
      dir,
      minimum,
      against: '-',
      uses,
      problems: [...problems, `engines.omni ${JSON.stringify(range)} is not ">=<Omni release>"`],
    };
  if (Bun.semver.order(minimum, repoVersion) > 0)
    return { dir, minimum, against: 'this tree (pending)', uses, problems };
  const commit = releaseCommit(root, minimum);
  if (commit === null)
    return {
      dir,
      minimum,
      against: '-',
      uses,
      problems: [...problems, `there is no Omni release ${minimum} (tag v${minimum})`],
    };
  const then = apiSurface(commit, root);
  for (const use of uses)
    if (serves(here, use) && !serves(then, use))
      problems.push(`Omni ${minimum} serves no ${show(use)}: raise engines.omni`);
  return { dir, minimum, against: `v${minimum}`, uses, problems };
}

if (import.meta.main) {
  const repoVersion = String(JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version);
  let failed = false;
  for (const plugin of ownPlugins(repoRoot)) {
    const result = checkPlugin(plugin.dir, plugin.omniRange, repoVersion);
    console.log(
      `${plugin.dir}: ${result.uses.length} Omni API paths, minimum ${result.minimum ?? '?'}, against ${result.against}`,
    );
    for (const problem of result.problems) console.error(`  ${problem}`);
    failed ||= result.problems.length > 0;
    if (process.argv[2] === 'oldest') {
      const tags = execFileSync('git', ['tag', '--list', 'v2.*', '--sort=-v:refname'], {
        cwd: repoRoot,
        encoding: 'utf8',
      })
        .split('\n')
        .filter((tag) => /^v\d+\.\d{6}\.\d+$/.test(tag))
        .slice(0, 60);
      let oldest: string | null = null;
      for (const tag of tags) {
        const surface = apiSurface(tag);
        if (!result.uses.every((use) => serves(surface, use))) break;
        oldest = tag;
      }
      console.log(`  every use is served by ${oldest ?? 'no checked release'} and the releases after it`);
    }
  }
  if (failed) process.exit(1);
}
