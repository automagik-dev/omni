#!/usr/bin/env bun
/**
 * build-capability-inventory.ts
 *
 * Merges the THREE Omni route-census sources into a single capability
 * inventory that drives and measures the Omni Admin UI:
 *
 *   1. SCOPE_MAP        — packages/api/src/constants/scopes.ts (METHOD path -> scope)
 *   2. mounted families — packages/api/src/routes/v2/index.ts (route family census)
 *   3. OpenAPI spec     — scripts/openapi.snapshot.json (documented surface)
 *
 * Plus KNOWN dark families that appear in neither SCOPE_MAP nor the spec but
 * are mounted and reachable (trust, handoffs). Every reachable capability must
 * appear here so coverage can be asserted per group.
 *
 * Each capability records: route, method, resource, scope (or null), inOpenApi,
 * inScopeMap, mutating, destructive, realtime, and a uiStatus coverage level
 * (none -> exposed -> operable -> live-verified -> ux-complete). uiStatus is
 * preserved across regenerations so later groups can raise a capability's level
 * and `--check` stays green.
 *
 * Flags:
 *   (none)                     regenerate + write capabilities.json
 *   --check                    regenerate + verify no drift vs the committed file (exit 1 on drift)
 *   --assert-operable <regex>  exit 1 if any capability whose key matches < operable
 *   --assert-exposed-all       exit 1 if any capability < exposed
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { SCOPE_MAP } from '../../../packages/api/src/constants/scopes.ts';
import openapiSnapshot from './openapi.snapshot.json' with { type: 'json' };

const HERE = import.meta.dir;
const OUTPUT_PATH = `${HERE}/../package/src/capabilities/capabilities.json`;
const ROUTES_INDEX_PATH = `${HERE}/../../../packages/api/src/routes/v2/index.ts`;

// ── Coverage levels ──────────────────────────────────────────────────────────

export const UI_STATUS_LEVELS = ['none', 'exposed', 'operable', 'live-verified', 'ux-complete'] as const;
export type UiStatus = (typeof UI_STATUS_LEVELS)[number];

const levelRank = (s: UiStatus): number => UI_STATUS_LEVELS.indexOf(s);

// ── Capability record ────────────────────────────────────────────────────────

export interface Capability {
  /** `METHOD route` — unique key. */
  key: string;
  /** HTTP method, uppercase. */
  method: string;
  /** Canonical route with `:param` segments, no `/api/v2` prefix. */
  route: string;
  /** Top-level resource family (first literal path segment). */
  resource: string;
  /** Required API-key scope, or null when unknown / unscoped. */
  scope: string | null;
  /** Present in the OpenAPI spec. */
  inOpenApi: boolean;
  /** Present in the API scope map. */
  inScopeMap: boolean;
  /** Non-GET (creates or changes state). */
  mutating: boolean;
  /** DELETE, or a logout/disconnect/revoke/abandon-class action. */
  destructive: boolean;
  /** Server-Sent-Events / WebSocket streaming endpoint. */
  realtime: boolean;
  /** UI coverage level for this capability. */
  uiStatus: UiStatus;
  /** Optional honest caveat (e.g. a known backend bug); curated, not derived. */
  note?: string;
}

interface InventoryFile {
  $generator: string;
  totals: {
    total: number;
    inSpec: number;
    offSpec: number;
    inScopeMap: number;
    mutating: number;
    destructive: number;
    realtime: number;
    darkFamilyCount: number;
    darkFamilies: string[];
    byUiStatus: Record<UiStatus, number>;
  };
  capabilities: Capability[];
}

// ── Path normalization ───────────────────────────────────────────────────────

/** Strip `/api/v2` prefix, drop trailing slash, convert `{x}` params to `:x`. */
function normalizeRoute(path: string): string {
  let p = path.replace(/^\/api\/v2/, '');
  p = p.replace(/\{([^}]+)\}/g, ':$1');
  if (p.length > 1 && p.endsWith('/')) p = p.slice(0, -1);
  if (!p.startsWith('/')) p = `/${p}`;
  return p;
}

/** Collapse param segments to a positional placeholder so param-name and
 *  `:x`/`{x}` differences between sources still merge to one capability. */
function matchKey(method: string, route: string): string {
  const collapsed = route.replace(/:[^/]+/g, ':p').replace(/\{[^}]+\}/g, ':p');
  return `${method.toUpperCase()} ${collapsed}`;
}

function resourceOf(route: string): string {
  const seg = route.split('/').filter(Boolean)[0] ?? '';
  return seg.replace(/^:/, 'root');
}

const DESTRUCTIVE_VERBS = /\/(logout|disconnect|revoke|abandon)(\/|$)/;

function computeFlags(method: string, route: string): Pick<Capability, 'mutating' | 'destructive' | 'realtime'> {
  const m = method.toUpperCase();
  return {
    mutating: m !== 'GET' && m !== 'HEAD' && m !== 'OPTIONS',
    destructive: m === 'DELETE' || DESTRUCTIVE_VERBS.test(route),
    realtime: /\/stream(\/|$)/.test(route),
  };
}

// ── Dark families — mounted + reachable, but in neither SCOPE_MAP nor spec ────
// Enumerated from packages/api/src/routes/v2/{trust,handoffs}.ts.

const DARK_CAPABILITIES: Array<{ method: string; route: string }> = [
  { method: 'POST', route: '/trust/handshake' },
  { method: 'GET', route: '/trust/hosts' },
  { method: 'GET', route: '/trust/hosts/:id' },
  { method: 'PATCH', route: '/trust/hosts/:id' },
  { method: 'DELETE', route: '/trust/hosts/:id' },
  { method: 'GET', route: '/handoffs' },
  { method: 'GET', route: '/handoffs/:id' },
];

// ── Curated notes — honest caveats about specific capabilities ────────────────
// Manually maintained (not derivable from the census sources) and attached by
// key during assembly, so `--check` stays deterministic. Keep terse and factual;
// these render as caveats in the Capabilities page.

const CAPABILITY_NOTES: Record<string, string> = {
  'GET /handoffs': 'backend returns 500 as of 2026-07-11; error surfaced honestly in UI',
};

// ── Merge ────────────────────────────────────────────────────────────────────

function buildCapabilities(): Map<string, Capability> {
  const byMatch = new Map<string, Capability>();

  const upsert = (method: string, route: string): Capability => {
    const key = matchKey(method, route);
    const existing = byMatch.get(key);
    if (existing) return existing;
    const flags = computeFlags(method, route);
    const cap: Capability = {
      key: `${method.toUpperCase()} ${route}`,
      method: method.toUpperCase(),
      route,
      resource: resourceOf(route),
      scope: null,
      inOpenApi: false,
      inScopeMap: false,
      ...flags,
      uiStatus: 'none',
    };
    byMatch.set(key, cap);
    return cap;
  };

  // 1. SCOPE_MAP — `METHOD /path` -> scope.
  for (const [entry, scope] of Object.entries(SCOPE_MAP)) {
    const spaceIdx = entry.indexOf(' ');
    if (spaceIdx === -1) continue;
    const method = entry.slice(0, spaceIdx);
    const route = normalizeRoute(entry.slice(spaceIdx + 1));
    const cap = upsert(method, route);
    cap.inScopeMap = true;
    cap.scope = scope;
  }

  // 2. OpenAPI spec — documented surface.
  const spec = openapiSnapshot as { paths?: Record<string, Record<string, unknown>> };
  for (const [rawPath, methods] of Object.entries(spec.paths ?? {})) {
    const route = normalizeRoute(rawPath);
    for (const method of Object.keys(methods)) {
      if (!/^(get|post|put|patch|delete|head|options)$/i.test(method)) continue;
      const cap = upsert(method, route);
      cap.inOpenApi = true;
    }
  }

  // 3. Dark families — reachable but undocumented and unscoped.
  for (const { method, route } of DARK_CAPABILITIES) {
    upsert(method, route);
  }

  return byMatch;
}

// ── Family census (for reporting / sanity) ───────────────────────────────────

function mountedFamilies(): string[] {
  const src = readFileSync(ROUTES_INDEX_PATH, 'utf8');
  const families = new Set<string>();
  for (const m of src.matchAll(/v2Routes\.route\('\/([a-z0-9-]+)'/g)) {
    if (m[1]) families.add(m[1]);
  }
  return [...families].sort();
}

// ── Assemble file ────────────────────────────────────────────────────────────

function assemble(previous: Map<string, UiStatus>): InventoryFile {
  const caps = [...buildCapabilities().values()].map((cap) => ({
    ...cap,
    uiStatus: previous.get(cap.key) ?? cap.uiStatus,
    ...(CAPABILITY_NOTES[cap.key] ? { note: CAPABILITY_NOTES[cap.key] } : {}),
  }));
  caps.sort((a, b) => a.key.localeCompare(b.key));

  const familiesWithCoverage = new Set<string>();
  for (const cap of caps) {
    if (cap.inScopeMap || cap.inOpenApi) familiesWithCoverage.add(cap.resource);
  }
  const darkFamilies = [...new Set(caps.map((c) => c.resource))].filter((fam) => !familiesWithCoverage.has(fam)).sort();

  const byUiStatus = Object.fromEntries(UI_STATUS_LEVELS.map((l) => [l, 0])) as Record<UiStatus, number>;
  for (const cap of caps) byUiStatus[cap.uiStatus] += 1;

  return {
    $generator: 'scripts/build-capability-inventory.ts',
    totals: {
      total: caps.length,
      inSpec: caps.filter((c) => c.inOpenApi).length,
      offSpec: caps.filter((c) => !c.inOpenApi).length,
      inScopeMap: caps.filter((c) => c.inScopeMap).length,
      mutating: caps.filter((c) => c.mutating).length,
      destructive: caps.filter((c) => c.destructive).length,
      realtime: caps.filter((c) => c.realtime).length,
      darkFamilyCount: darkFamilies.length,
      darkFamilies,
      byUiStatus,
    },
    capabilities: caps,
  };
}

function readPreviousUiStatus(): Map<string, UiStatus> {
  const map = new Map<string, UiStatus>();
  if (!existsSync(OUTPUT_PATH)) return map;
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8')) as InventoryFile;
    for (const cap of parsed.capabilities ?? []) {
      if (cap.key && cap.uiStatus) map.set(cap.key, cap.uiStatus);
    }
  } catch {
    // Corrupt/absent — regenerate from scratch.
  }
  return map;
}

function serialize(file: InventoryFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

// ── Report ───────────────────────────────────────────────────────────────────

function printTotals(file: InventoryFile): void {
  const t = file.totals;
  console.log('Omni capability inventory');
  console.log(`  total:          ${t.total}`);
  console.log(`  in-spec:        ${t.inSpec}`);
  console.log(`  off-spec:       ${t.offSpec}`);
  console.log(`  in-scope-map:   ${t.inScopeMap}`);
  console.log(`  mutating:       ${t.mutating}`);
  console.log(`  destructive:    ${t.destructive}`);
  console.log(`  realtime:       ${t.realtime}`);
  console.log(`  dark families:  ${t.darkFamilyCount} [${t.darkFamilies.join(', ')}]`);
  console.log(`  mounted:        ${mountedFamilies().length} families`);
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function assertLevel(file: InventoryFile, min: UiStatus, filter?: RegExp): number {
  const failing = file.capabilities.filter((c) => {
    if (filter && !filter.test(c.key)) return false;
    return levelRank(c.uiStatus) < levelRank(min);
  });
  if (failing.length > 0) {
    console.error(`FAIL: ${failing.length} capabilit${failing.length === 1 ? 'y' : 'ies'} below '${min}':`);
    for (const c of failing.slice(0, 40)) console.error(`  ${c.key} [${c.uiStatus}]`);
    if (failing.length > 40) console.error(`  … and ${failing.length - 40} more`);
    return 1;
  }
  console.log(`OK: all ${filter ? 'matching ' : ''}capabilities >= '${min}'.`);
  return 0;
}

function main(): number {
  const args = Bun.argv.slice(2);
  const file = assemble(readPreviousUiStatus());
  const serialized = serialize(file);

  const operableIdx = args.indexOf('--assert-operable');
  if (operableIdx !== -1) {
    const pattern = args[operableIdx + 1];
    if (!pattern) {
      console.error('--assert-operable requires a <regex> argument');
      return 1;
    }
    return assertLevel(file, 'operable', new RegExp(pattern));
  }

  if (args.includes('--assert-exposed-all')) {
    return assertLevel(file, 'exposed');
  }

  if (args.includes('--check')) {
    const onDisk = existsSync(OUTPUT_PATH) ? readFileSync(OUTPUT_PATH, 'utf8') : '';
    printTotals(file);
    if (onDisk !== serialized) {
      console.error('\nFAIL: capabilities.json is stale. Run `bun run capabilities` and commit the result.');
      return 1;
    }
    console.log('\nOK: capabilities.json is up to date.');
    return 0;
  }

  writeFileSync(OUTPUT_PATH, serialized);
  printTotals(file);
  console.log(`\nWrote ${OUTPUT_PATH}`);
  return 0;
}

process.exit(main());
