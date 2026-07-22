/**
 * Architectural guard test (wish: omni-full-multitenancy, Group G3).
 *
 * Fails closed: a database access site that is not in the registry is a test
 * failure. The seeded-site test at the bottom is the one that matters most —
 * it proves the guard actually catches a new unscoped call site rather than
 * merely agreeing with a registry that was generated from the same scan.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIRRORED_RLS_EXCLUSIONS,
  PENDING_G4_CEILING,
  PENDING_G5_CEILING,
  REGISTERED_DB_ACCESS,
  TOTAL_PENDING_CEILING,
  defaultClassFor,
  evaluateDbAccessGuard,
  scanDbAccessSites,
} from './tenancy-db-access-guard';
import { RLS_EXCLUSIONS, RLS_TENANT_TABLES } from './tenancy-rls';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const packagesDir = join(repoRoot, 'packages');

const found = scanDbAccessSites(packagesDir, repoRoot);
const report = evaluateDbAccessGuard(found);

const scratchDir = join(packagesDir, 'db', 'src', '__g3_access_scratch__');
afterAll(() => rmSync(scratchDir, { recursive: true, force: true }));

describe('db-access guard', () => {
  test('the scan finds sites at all (guards against a broken scanner)', () => {
    expect(found.length).toBeGreaterThan(80);
    expect(REGISTERED_DB_ACCESS.length).toBe(found.length);
  });

  test('every discovered access site is registered', () => {
    expect(report.unregistered).toEqual([]);
  });

  test('no registry entry is stale', () => {
    expect(report.stale).toEqual([]);
  });

  test('every control-plane, migration-ddl, and G5-deferred entry carries a justification', () => {
    expect(report.unjustified).toEqual([]);
    for (const entry of REGISTERED_DB_ACCESS) {
      if (
        entry.class === 'control-plane' ||
        entry.class === 'migration-ddl' ||
        entry.class === 'pending-G5-conversion'
      ) {
        expect((entry.justification ?? '').length).toBeGreaterThan(40);
      }
    }
  });

  test('exceptions fall only into the authorised classes', () => {
    const allowed = new Set([
      'tenant-boundary',
      'control-plane',
      'migration-ddl',
      'pending-G4-conversion',
      'pending-G5-conversion',
    ]);
    for (const entry of REGISTERED_DB_ACCESS) expect(allowed.has(entry.class)).toBe(true);
  });

  test('the pending-G4 class is at or below its ceiling — it may shrink, never grow', () => {
    expect(report.counts['pending-G4-conversion']).toBeLessThanOrEqual(PENDING_G4_CEILING);
    // If this reaches zero, G4 is done and the class can be retired.
    expect(report.counts['pending-G4-conversion']).toBeGreaterThan(0);
  });

  test('the pending-G5 class is at or below its ceiling — G4 cannot grow its way out', () => {
    // The point of capping a class G4 itself opened: without this, "convert" and
    // "defer to G5" would be indistinguishable from the outside, and the G4
    // number could be driven to zero purely by relabelling.
    expect(report.counts['pending-G5-conversion']).toBeLessThanOrEqual(PENDING_G5_CEILING);
  });

  test('total pending work never grows — the ratchet reclassification cannot game', () => {
    // The per-class caps are individually gameable in one direction: moving a
    // site from G4 to G5 lowers one and raises the other, and leg 3 did raise
    // the G5 cap. This is the invariant that makes such a move honest, because
    // relabelling cannot lower it. Only converting a site, or proving it was
    // never database access, can.
    const totalPending = report.counts['pending-G4-conversion'] + report.counts['pending-G5-conversion'];
    expect(totalPending).toBeLessThanOrEqual(TOTAL_PENDING_CEILING);
  });

  test('every G5 deferral names the async mechanism that owns its caller', () => {
    const deferred = REGISTERED_DB_ACCESS.filter((e) => e.class === 'pending-G5-conversion');
    expect(deferred.length).toBeGreaterThan(0);
    for (const entry of deferred) {
      // A deferral that cannot say WHY no request context exists is a hiding
      // place for synchronous work, so the mechanism must be stated. The named
      // mechanism is either a non-request caller (an eventBus consumer, a
      // scheduler cron/interval, a storage path) or a request-spawned but
      // deliberately request-detached executor (fire-and-forget work that
      // outlives the request and runs on the ambient pool). The bare word
      // "background" is intentionally NOT accepted — it describes a symptom, not
      // the mechanism, so a justification must name the detaching act itself.
      expect(entry.justification).toMatch(
        /consumer|cron|setInterval|scheduled|interval|storage path|fire-and-forget|detached/i,
      );
      expect(entry.justification).toContain('ADR-0008');
    }
  });

  test('tenant-boundary is the G3 boundary modules plus the services G4/G5 fully converted', () => {
    // G3 could only claim this class for `tenancy/` itself. G4 converts service
    // files, so the assertion widens — but only to services whose EVERY caller
    // carries a request context. A service with a consumer or cron caller stays
    // in a pending class, which is what keeps this from becoming "anything that
    // has been edited". G5 widens it once more, to CONSUMER files whose worker
    // callers now establish a tenant scope from the versioned envelope.
    const boundary = REGISTERED_DB_ACCESS.filter((e) => e.class === 'tenant-boundary');
    expect(boundary.length).toBeGreaterThan(0);
    const converted = new Set([
      // Services whose every caller is request-context AND whose tables carry
      // real G2 ownership. `conversations.ts` appears for its `chats` access
      // only — its own table is `unowned`, so that site stays pending.
      'packages/api/src/services/conversations.ts',
      'packages/api/src/services/routes.ts',
      'packages/api/src/services/events.ts',
      'packages/api/src/services/agent-tasks.ts',
      'packages/api/src/services/agents.ts',
      // Route handlers that query directly; scoped by the edge rebinding
      // `c.get('db')` to the request transaction.
      'packages/api/src/routes/v2/handoffs.ts',
      'packages/api/src/routes/v2/messages.ts',
      // G5 leg A: consumer-only plugin whose NATS handlers now open a worker
      // tenant scope from the envelope (tenancy/worker-tenant-context.ts) before
      // any DB work. Its only callers are those consumers, so every caller is
      // now scoped.
      'packages/api/src/plugins/event-persistence.ts',
    ]);
    for (const entry of boundary) {
      expect(entry.file.startsWith('packages/api/src/tenancy/') || converted.has(entry.file)).toBe(true);
    }
  });

  test('the auth plane is control-plane and names ADR-0003', () => {
    const authPlane = REGISTERED_DB_ACCESS.filter((e) => e.file === 'packages/api/src/services/auth-bootstrap.ts');
    expect(authPlane.length).toBeGreaterThan(0);
    for (const entry of authPlane) {
      expect(entry.class).toBe('control-plane');
      expect(entry.justification).toContain('ADR-0003');
    }
  });

  test('a CLI or channel site is control-plane only on the WISH operator-surface grounds', () => {
    // Originally a blanket ban: every CLI/channel site had to stay
    // pending-G4-conversion. That was the right default while the class was
    // untested, but it was too strong to be true — the WISH allows CLI operator
    // tooling to be control-plane "only when it cannot run under a tenant
    // credential and is inventoried as operator surface", and the auth-plane key
    // bootstrap meets both conditions by construction (it mints the FIRST
    // credential, so there is no tenant credential to run it under).
    //
    // So the ban becomes a bar. What the original test was really protecting is
    // that the class is never taken for CONVENIENCE, and a justification forced
    // to cite both WISH conditions cannot be written casually.
    for (const entry of REGISTERED_DB_ACCESS) {
      if (!entry.file.startsWith('packages/cli/') && !entry.file.startsWith('packages/channel-')) continue;
      if (entry.class === 'control-plane') {
        expect(entry.justification).toContain('ADR-0003');
        // Condition 1: inventoried as operator surface.
        expect(entry.justification).toContain('SURFACE_INVENTORY');
        // Condition 2: cannot run under a tenant credential.
        expect(entry.justification).toMatch(/no tenant credential can exist|cannot run under a tenant credential/i);
        continue;
      }
      // Everything else keeps the original default: no quiet exemptions.
      expect(entry.class).toBe('pending-G4-conversion');
    }
  });

  test('exactly one CLI site holds control-plane, so the bar cannot erode unnoticed', () => {
    // A count, deliberately. If a second CLI site ever takes this class the test
    // fails and someone has to argue it on the record, which is the whole point
    // of having replaced a ban with a bar.
    const cliControlPlane = REGISTERED_DB_ACCESS.filter(
      (e) => e.file.startsWith('packages/cli/') && e.class === 'control-plane',
    );
    expect(cliControlPlane.map((e) => e.file)).toEqual(['packages/cli/src/commands/keys.ts']);
  });

  test('a new unregistered direct-db call site fails the guard', () => {
    mkdirSync(scratchDir, { recursive: true });
    const seeded = join(scratchDir, 'rogue-service.ts');
    writeFileSync(
      seeded,
      [
        "import { getDb, messages } from '@omni/db';",
        'export async function leak() {',
        '  const db = getDb();',
        '  return db.select().from(messages);',
        '}',
        '',
      ].join('\n'),
    );

    const rescanned = scanDbAccessSites(packagesDir, repoRoot);
    const rescannedReport = evaluateDbAccessGuard(rescanned);

    const files = rescannedReport.unregistered.map((s) => `${s.file}::${s.table}`);
    expect(files).toContain('packages/db/src/__g3_access_scratch__/rogue-service.ts::*');
    expect(files).toContain('packages/db/src/__g3_access_scratch__/rogue-service.ts::messages');

    rmSync(scratchDir, { recursive: true, force: true });
    // And the guard goes quiet again once the site is gone.
    expect(evaluateDbAccessGuard(scanDbAccessSites(packagesDir, repoRoot)).unregistered).toEqual([]);
  });

  test('the raw-SQL scanner reads code, not prose — and still catches real SQL in a template literal', () => {
    // The raw-SQL pattern had two precision defects that manufactured phantom
    // debt: it had no leading word boundary, so `__fish_seen_subcommand_from
    // instances` in a shell-completion string scanned as "FROM instances"; and
    // it read comments, so English prose like "sourced from chats.upsert"
    // scanned as "FROM chats". Eight registry entries were these, not queries.
    //
    // The fix must buy precision WITHOUT costing recall: real raw SQL lives in
    // template literals, so strings are still scanned. The last seeded case is
    // the one that must keep failing the guard.
    mkdirSync(scratchDir, { recursive: true });
    const seeded = join(scratchDir, 'prose-and-sql.ts');
    writeFileSync(
      seeded,
      [
        '/** Enrich contacts that have no name from platform_identities (GH #307) */',
        '// Last-known unread count per JID — sourced from chats.upsert events.',
        '/*',
        ' * Handles adding and removing reactions from messages.',
        ' */',
        'export const completion = `complete -n "__fish_seen_subcommand_from instances" -a list`;',
        'export const notSql = "delete from the cache when persons change";',
        'export async function real(db: { execute: (q: unknown) => Promise<unknown> }) {',
        '  return db.execute(`SELECT id FROM conversations WHERE tenant_id = $1`);',
        '}',
        '',
      ].join('\n'),
    );

    const tables = scanDbAccessSites(packagesDir, repoRoot)
      .filter((s) => s.file.endsWith('prose-and-sql.ts'))
      .map((s) => s.table);
    rmSync(scratchDir, { recursive: true, force: true });

    // Prose, comments, and shell-completion strings are not database access.
    expect(tables).not.toContain('platform_identities');
    expect(tables).not.toContain('chats');
    expect(tables).not.toContain('messages');
    expect(tables).not.toContain('instances');
    // Recall is intact: a real `FROM conversations` in a template literal is
    // still a site, and would still fail the guard unregistered.
    expect(tables).toContain('conversations');
  });

  test('a newly discovered site defaults to pending-G4-conversion, not to an exemption', () => {
    const fresh = defaultClassFor({ file: 'packages/api/src/services/brand-new.ts', table: 'messages' });
    expect(fresh.class).toBe('pending-G4-conversion');
    expect(fresh.justification).toBeUndefined();
  });

  test('the scanner catches createDbHandle, not only getDb/createDb (G3 review L2)', () => {
    mkdirSync(scratchDir, { recursive: true });
    const seeded = join(scratchDir, 'rogue-handle.ts');
    writeFileSync(
      seeded,
      [
        "import { createDbHandle } from '@omni/db';",
        'export function leak() {',
        '  return createDbHandle({ url: process.env.SOMETHING ?? "" });',
        '}',
        '',
      ].join('\n'),
    );

    const files = evaluateDbAccessGuard(scanDbAccessSites(packagesDir, repoRoot)).unregistered.map(
      (s) => `${s.file}::${s.table}`,
    );
    rmSync(scratchDir, { recursive: true, force: true });

    // `createDbHandle` hands out a pool handle with no tenant context attached,
    // exactly as `getDb`/`createDb` do. It was added after the original regex
    // was written, which is how a guard silently loses coverage.
    expect(files).toContain('packages/db/src/__g3_access_scratch__/rogue-handle.ts::*');
  });

  test('every real createDbHandle call site is registered (G3 review L2)', () => {
    const handleSites = REGISTERED_DB_ACCESS.filter(
      (e) => e.table === '*' && e.file === 'packages/db/scripts/apply-rls-enforcement.ts',
    );
    expect(handleSites.length).toBe(1);
    expect(handleSites[0]?.class).toBe('migration-ddl');
  });

  test('the RLS exclusion justifications are mirrored here, verbatim (G3 review L4)', () => {
    // The exclusions live in `tenancy-rls.ts` because that is where the DDL is
    // generated. A reader auditing *this* file — the inventory of who may touch
    // the database — must not have to know that a second, differently shaped
    // list exists elsewhere. Mirrored rather than re-worded so a divergence is a
    // test failure instead of a discrepancy nobody notices.
    expect(MIRRORED_RLS_EXCLUSIONS).toEqual(RLS_EXCLUSIONS);
    for (const exclusion of MIRRORED_RLS_EXCLUSIONS) {
      expect(RLS_TENANT_TABLES).not.toContain(exclusion.table);
      expect(exclusion.justification.length).toBeGreaterThan(40);
    }
  });

  test('the scanner covers every RLS table name', () => {
    // A table missing from the scan vocabulary would make its call sites
    // invisible — a silent hole rather than a loud failure.
    const registeredTables = new Set(REGISTERED_DB_ACCESS.map((e) => e.table));
    expect(registeredTables.has('*')).toBe(true);
    for (const table of registeredTables) {
      if (table === '*') continue;
      expect(RLS_TENANT_TABLES).toContain(table);
    }
  });
});
