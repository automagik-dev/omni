/**
 * Every route registered on the v2 router must resolve to a SCOPE_MAP entry,
 * and every SCOPE_MAP entry must match a live route (issue #1039).
 *
 * The enforcer is deny-by-default: an unmapped route is a 403 for every
 * non-wildcard key, whatever scopes it holds. A stale entry is a renamed
 * route that silently became unreachable for scoped keys.
 */
import { describe, expect, it } from 'bun:test';
import { v2Routes } from '../../routes/v2';
import { SCOPE_MAP } from '../scopes';

/** Root-mounted aliases (automations at `/`) and 404 placeholders; unmapped on purpose. */
const IGNORED = [
  /^(GET|POST|PATCH|DELETE) \/(:id(\/(logs|enable|disable|test|execute))?)?$/,
  /^GET \/(event-ops|processed-events)$/,
];

function segmentsMatch(pattern: string, path: string): boolean {
  const a = pattern.split('/');
  const b = path.split('/');
  return a.length === b.length && a.every((s, i) => s.startsWith(':') || s === b[i]);
}

function findEntry(method: string, path: string): string | undefined {
  if (SCOPE_MAP[`${method} ${path}`]) return `${method} ${path}`;
  return Object.keys(SCOPE_MAP).find((key) => {
    const idx = key.indexOf(' ');
    if (key.slice(0, idx) !== method) return false;
    const pattern = key.slice(idx + 1);
    return pattern.endsWith('/*') ? path.startsWith(pattern.slice(0, -2)) : segmentsMatch(pattern, path);
  });
}

describe('SCOPE_MAP coverage', () => {
  const routes = [...new Set(v2Routes.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`))];
  const hit = new Set<string>();
  const unmapped: string[] = [];

  for (const route of routes) {
    if (IGNORED.some((re) => re.test(route))) continue;
    const idx = route.indexOf(' ');
    const entry = findEntry(route.slice(0, idx), route.slice(idx + 1));
    if (entry) hit.add(entry);
    else unmapped.push(route);
  }

  it('maps every registered v2 route', () => {
    expect(unmapped.sort()).toEqual([]);
  });

  it('has no stale entries', () => {
    const stale = Object.keys(SCOPE_MAP).filter((k) => !hit.has(k) && !k.endsWith('/*'));
    expect(stale.sort()).toEqual([]);
  });
});
