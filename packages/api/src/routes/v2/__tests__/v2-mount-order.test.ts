/**
 * v2 mount-order invariant (issue #496, regressed for /handoffs).
 *
 * `automationsRoutes` is mounted TWICE in routes/v2/index.ts: at `/automations`
 * and at the v2 root (so `/automation-logs` and `/automation-metrics` resolve).
 * It defines `get('/:id')`, so the root mount registers `GET /api/v2/:id` — a
 * single-segment catch-all over the entire v2 surface. Hono resolves
 * same-path handlers in REGISTRATION ORDER, so any prefix router mounted below
 * the root mounts loses its bare collection path to that catch-all.
 *
 * In production this made `GET /api/v2/handoffs` reach the automations `/:id`
 * handler, which passed the literal string "handoffs" into
 * `where(eq(automations.id, id))` with no uuid guard:
 *
 *   HTTP 500 {"error":{"code":"INTERNAL_ERROR",
 *             "message":"invalid input syntax for type uuid: \"handoffs\""}}
 *
 * INVARIANT: every router with a bare collection route (`get('/')`) must be
 * mounted ABOVE the first root mount that installs a single-segment `/:id`
 * catch-all. In practice: above the root-mount block at the end of index.ts.
 *
 * The check is driven from the source of index.ts rather than from a live
 * Hono instance so it needs no database, and so it names the offending line
 * when it fails.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const V2_DIR = join(import.meta.dir, '..');
const INDEX_SRC = readFileSync(join(V2_DIR, 'index.ts'), 'utf8');

interface Mount {
  path: string;
  ident: string;
  line: number;
}

/** `import { fooRoutes } from './foo';` -> fooRoutes => ./foo */
function importedModules(src: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /import\s*\{\s*([A-Za-z0-9_,\s]+?)\s*\}\s*from\s*'(\.\/[^']+)'/g;
  for (const m of src.matchAll(re)) {
    const [, names, modulePath] = m;
    if (!names || !modulePath) continue;
    for (const raw of names.split(',')) {
      const ident = raw.trim();
      if (ident) map.set(ident, modulePath);
    }
  }
  return map;
}

/** `v2Routes.route('/x', xRoutes);` in registration order. */
function mounts(src: string): Mount[] {
  const out: Mount[] = [];
  src.split('\n').forEach((text, i) => {
    const m = text.match(/^\s*v2Routes\.route\(\s*'([^']*)'\s*,\s*([A-Za-z0-9_]+)\s*\)/);
    const [, path, ident] = m ?? [];
    if (path !== undefined && ident) out.push({ path, ident, line: i + 1 });
  });
  return out;
}

function moduleSource(modulePath: string): string {
  return readFileSync(join(V2_DIR, `${modulePath.replace(/^\.\//, '')}.ts`), 'utf8');
}

/** Does the router module register a bare collection GET (`get('/')`)? */
function hasBareCollectionGet(ident: string, modulePath: string): boolean {
  return new RegExp(`\\b${ident}\\.get\\(\\s*'/'`).test(moduleSource(modulePath));
}

/**
 * Does the module register a single-segment param GET (`get('/:id')`)? Mounted
 * at the root, that is the `GET /api/v2/:id` catch-all. Multi-segment routes
 * (`/events/:id/payloads`) never match a one-segment request and are harmless.
 */
function hasSingleSegmentParamGet(ident: string, modulePath: string): boolean {
  return new RegExp(`\\b${ident}\\.get\\(\\s*'/:[^'/]+'`).test(moduleSource(modulePath));
}

describe('v2 route mount order', () => {
  const all = mounts(INDEX_SRC);
  const modules = importedModules(INDEX_SRC);

  /** First root mount that installs a `GET /api/v2/:id` catch-all. */
  const catchAll = all.findIndex((m) => {
    if (m.path !== '/') return false;
    const mod = modules.get(m.ident);
    return mod ? hasSingleSegmentParamGet(m.ident, mod) : false;
  });

  it('parses the mount table and finds the root catch-all', () => {
    expect(all.length).toBeGreaterThan(20);
    expect(catchAll).toBeGreaterThan(-1);
    expect(all[catchAll]?.ident).toBe('automationsRoutes');
  });

  it('mounts every router with a bare collection GET above the root /:id catch-all', () => {
    const shadowed = all
      .slice(catchAll + 1)
      .filter((m) => m.path !== '/')
      .filter((m) => {
        const mod = modules.get(m.ident);
        return mod ? hasBareCollectionGet(m.ident, mod) : false;
      })
      .map((m) => `index.ts:${m.line} ${m.ident} at '${m.path}'`);

    // Any name here is shadowed by GET /api/v2/:id from the root automations
    // mount and will 500 on its collection path. Move it above the root mounts.
    expect(shadowed).toEqual([]);
  });

  it('mounts /handoffs before the root catch-all (the #496 regression)', () => {
    const handoffs = all.findIndex((m) => m.path === '/handoffs');
    expect(handoffs).toBeGreaterThan(-1);
    expect(handoffs).toBeLessThan(catchAll);
  });

  it('still exposes the root automations mount that made the catch-all necessary', () => {
    // Guards the fix from being "solved" by deleting the root mount, which
    // would break /automation-logs and /automation-metrics.
    expect(all.some((m) => m.path === '/' && m.ident === 'automationsRoutes')).toBe(true);
    expect(all.some((m) => m.path === '/automations' && m.ident === 'automationsRoutes')).toBe(true);
  });
});
