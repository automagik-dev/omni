/**
 * Egress architecture guard test (wish: omni-full-multitenancy, Group G5;
 * ADR-0009).
 *
 * The sibling of the db-access guard test. Fails closed: a global `fetch`/socket
 * call site in a scanned root that the registry does not list is a test failure.
 * The seeded-site tests at the bottom are the ones that matter most — they prove
 * the guard actually catches a NEW raw tenant `fetch` (and a new socket) rather
 * than merely agreeing with a registry generated from the same scan.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PENDING_EGRESS_CEILING,
  REGISTERED_EGRESS,
  evaluateEgressGuard,
  scanEgressSites,
} from '../egress-access-guard';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..', '..');

const found = scanEgressSites(repoRoot);
const report = evaluateEgressGuard(found);

// Seed rogue files under a real scanned root so the scanner actually walks them.
const scratchDir = join(repoRoot, 'packages', 'core', 'src', '__g5_egress_scratch__');
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

describe('egress-access guard', () => {
  test('the scan finds egress sites at all (guards against a broken scanner)', () => {
    expect(found.length).toBeGreaterThan(15);
    expect(REGISTERED_EGRESS.length).toBe(found.length);
  });

  test('every discovered egress site is registered', () => {
    expect(report.unregistered).toEqual([]);
  });

  test('no registry entry is stale', () => {
    expect(report.stale).toEqual([]);
  });

  test('no registered file has a drifted site count (a new fetch in a known file fails)', () => {
    expect(report.countDrift).toEqual([]);
  });

  test('every registered egress site carries a justification', () => {
    expect(report.unjustified).toEqual([]);
    for (const entry of REGISTERED_EGRESS) expect((entry.justification ?? '').length).toBeGreaterThan(40);
  });

  test('every entry falls into an authorised class', () => {
    const allowed = new Set(['platform-vendor', 'media-guard', 'infra', 'pending-egress-broker']);
    for (const entry of REGISTERED_EGRESS) expect(allowed.has(entry.class)).toBe(true);
  });

  test('every pending-egress-broker entry names ADR-0009 and the tenant-controlled source', () => {
    const pending = REGISTERED_EGRESS.filter((e) => e.class === 'pending-egress-broker');
    expect(pending.length).toBeGreaterThan(0);
    for (const entry of pending) {
      expect(entry.justification).toContain('ADR-0009');
      expect(entry.justification).toMatch(
        /tenant-controlled|tenant-configured|per-instance|baseUrl|config\.|callback/i,
      );
    }
  });

  test('the pending-egress-broker class is at or below its ceiling — it may shrink, never grow', () => {
    expect(report.counts['pending-egress-broker']).toBeLessThanOrEqual(PENDING_EGRESS_CEILING);
  });

  test('the converted reference site (automations/actions.ts) is absent from the scan', () => {
    // A brokered file has no raw `fetch` — conversion is proven by absence.
    expect(found.some((s) => s.file.endsWith('automations/actions.ts'))).toBe(false);
    expect(REGISTERED_EGRESS.some((e) => e.file.endsWith('automations/actions.ts'))).toBe(false);
  });

  test('a new unregistered raw tenant fetch fails the guard', () => {
    mkdirSync(scratchDir, { recursive: true });
    const seeded = join(scratchDir, 'rogue-egress.ts');
    writeFileSync(
      seeded,
      [
        'export async function leak(tenantUrl: string) {',
        '  return fetch(tenantUrl, { method: "POST" });',
        '}',
        '',
      ].join('\n'),
    );

    const files = evaluateEgressGuard(scanEgressSites(repoRoot)).unregistered.map((s) => s.file);
    expect(files).toContain('packages/core/src/__g5_egress_scratch__/rogue-egress.ts');

    rmSync(scratchDir, { recursive: true, force: true });
    // And the guard goes quiet again once the site is gone.
    expect(evaluateEgressGuard(scanEgressSites(repoRoot)).unregistered).toEqual([]);
  });

  test('a new raw socket/WebSocket site is also caught, not just fetch', () => {
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(
      join(scratchDir, 'rogue-socket.ts'),
      ['export function open(url: string) {', '  return new WebSocket(url);', '}', ''].join('\n'),
    );
    const files = evaluateEgressGuard(scanEgressSites(repoRoot)).unregistered.map((s) => s.file);
    expect(files).toContain('packages/core/src/__g5_egress_scratch__/rogue-socket.ts');
    rmSync(scratchDir, { recursive: true, force: true });
  });

  test('the scanner reads code not prose, and ignores method .fetch() calls', () => {
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(
      join(scratchDir, 'not-egress.ts'),
      [
        '// This comment says fetch( the user from the cache.',
        '/* another fetch( in a block comment */',
        'export async function ok(client: any, app: any, id: string, req: Request) {',
        '  await client.channels.fetch(id);', // method call — not global egress
        '  await client.messages.fetch(id);', // method call — not global egress
        '  return app.fetch(req);', // method call — not global egress
        '}',
        '',
      ].join('\n'),
    );
    const sites = scanEgressSites(repoRoot).filter((s) => s.file.endsWith('not-egress.ts'));
    rmSync(scratchDir, { recursive: true, force: true });
    // Neither the comments nor the `.fetch(` method calls are egress sites.
    expect(sites).toEqual([]);
  });

  test('the broker source itself is skipped (it is the definition, not a site)', () => {
    expect(found.some((s) => s.file === 'packages/core/src/egress/broker.ts')).toBe(false);
    expect(REGISTERED_EGRESS.some((e) => e.file === 'packages/core/src/egress/broker.ts')).toBe(false);
  });
});
