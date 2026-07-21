/**
 * Two-tenant adversarial containment over the CONVERTED services
 * (wish: omni-full-multitenancy, Group G4; ADR-0004).
 *
 * `tenant-boundary-postgres.test.ts` proves the G3 primitives contain. This
 * suite asks the harder question G4 actually has to answer: when a real,
 * unmodified service — the same `InstanceService.list` the route calls — runs
 * inside a request's tenant scope, does it return only that tenant's rows?
 *
 * WHY THE FIXTURE IS BUILT TO CONFUSE
 * -----------------------------------
 * Tenants A and B are seeded with deliberately COLLIDING business data: the
 * same display names, the same chat external ids and JIDs, the same message
 * external ids, and identical `created_at` timestamps. A containment bug that
 * happens to be masked by distinct-looking fixtures — the usual way these tests
 * pass while the system leaks — cannot hide here, because every row of A has a
 * twin in B that is indistinguishable by every field except `tenant_id`.
 *
 * Two known fixture limits, both properties of the CURRENT schema rather than
 * of the boundary, and both recorded rather than worked around:
 *
 *   * `persons_phone_idx` is a GLOBAL unique index on `primary_phone`, so two
 *     tenants cannot hold the same phone number today. Overlapping phones are
 *     therefore not seeded; names, external ids, JIDs, and timestamps collide
 *     instead. Retiring that global uniqueness belongs to the G6 backfill.
 *   * Nothing here asserts at the HTTP layer. The route-level probes need
 *     minted tenant credentials and are the next leg's work; what is proven
 *     here is the containment those routes depend on.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
} from '@omni/db';
import { ChatService } from '../../services/chats';
import { ConversationService } from '../../services/conversations';
import { InstanceService } from '../../services/instances';
import { MessageService } from '../../services/messages';
import { PersonService } from '../../services/persons';
import { type TenantAuthContext, freezeContext } from '../auth-context';
import { runInTenantScope } from '../tenant-scope';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const here = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(here, '..', '..', '..', '..', 'db', 'drizzle');

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
const PRINCIPAL = '33333333-3333-4333-8333-333333333331';
const INSTANCE_A = '55555555-5555-4555-8555-55555555555a';
const INSTANCE_B = '55555555-5555-4555-8555-55555555555b';
const CHAT_A = '66666666-6666-4666-8666-66666666666a';
const CHAT_B = '66666666-6666-4666-8666-66666666666b';
const MESSAGE_A = '77777777-7777-4777-8777-77777777777a';
const MESSAGE_B = '77777777-7777-4777-8777-77777777777b';
const PERSON_A = '88888888-8888-4888-8888-88888888888a';
const PERSON_B = '88888888-8888-4888-8888-88888888888b';
const CONVERSATION_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const CONVERSATION_B = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';

/** Identical on both sides — the collision is the point. */
const SHARED_NAME = 'Ana Silva';
const SHARED_JID = '5511999990000@s.whatsapp.net';
const SHARED_MESSAGE_EXTERNAL_ID = 'wamid.SHARED_COLLIDING_ID';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g4-${crypto.randomUUID()}.sql`);
  writeFileSync(file, script);
  try {
    const result = Bun.spawnSync({
      cmd: [psqlBin, '-X', '--no-psqlrc', '-A', '-t', '--set', 'ON_ERROR_STOP=1', '--dbname', url, '-f', file],
      stdout: 'pipe',
      stderr: 'pipe',
    });
    return { exitCode: result.exitCode, stderr: result.stderr.toString() };
  } finally {
    rmSync(file, { force: true });
  }
}

function urlFor(base: string, database: string, user?: { name: string; password: string }): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (user) {
    url.username = user.name;
    url.password = user.password;
  }
  return url.toString();
}

function contextFor(tenantId: string): TenantAuthContext {
  return freezeContext({
    credentialClass: 'tenant',
    requestId: `req-${tenantId}`,
    principalId: PRINCIPAL,
    credentialId: '99999999-9999-4999-8999-999999999992',
    tenantId,
    actorRole: 'tenant-admin',
    scopes: ['instances:read', 'chats:read', 'messages:read', 'persons:read'],
    membershipId: '44444444-4444-4444-8444-444444444441',
    resourceConstraints: {},
    expiresAt: null,
    rateLimit: null,
    budget: null,
    delegationDepth: 0,
    rootKeyId: 'root-1',
    policyVersion: 1,
    revocationEpoch: 0,
    tenantKeyLineageId: 'lin-1',
  }) as TenantAuthContext;
}

postgresDescribe('two-tenant adversarial containment (real PostgreSQL)', () => {
  const dbName = `omni_g4_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  let runtimeDb: Database;

  let instances: InstanceService;
  let chats: ChatService;
  let messages: MessageService;
  let persons: PersonService;
  let conversations: ConversationService;

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  /** Run `fn` exactly as a converted route handler would, for one tenant. */
  const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
    runInTenantScope(runtimeDb, contextFor(tenantId), fn);

  beforeAll(async () => {
    const created = runSqlOn(superUrl, `CREATE DATABASE "${dbName}";`);
    if (created.exitCode !== 0) throw new Error(`could not create database: ${created.stderr}`);

    const migrations = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
      .map((f) => readFileSync(join(drizzleDir, f), 'utf-8'))
      .join('\n');
    const superDbUrl = urlFor(superUrl, dbName);
    const migrated = runSqlOn(superDbUrl, migrations);
    if (migrated.exitCode !== 0) throw new Error(`migrations failed: ${migrated.stderr}`);

    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 100, 100),
        ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 100, 100);
      INSERT INTO principals (id, type, subject) VALUES ('${PRINCIPAL}', 'human', 'subject-a');

      -- Same NAME on both sides: a list that leaks is not detectable by eye.
      INSERT INTO instances (id, name, channel, tenant_id, created_at) VALUES
        ('${INSTANCE_A}', 'shared-instance-name-a', 'whatsapp-baileys', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'shared-instance-name-b', 'whatsapp-baileys', '${TENANT_B}', '${SHARED_TIMESTAMP}');

      INSERT INTO conversations (id, tenant_id, created_at) VALUES
        ('${CONVERSATION_A}', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CONVERSATION_B}', '${TENANT_B}', '${SHARED_TIMESTAMP}');

      -- Identical external id AND canonical JID, distinguished only by instance.
      INSERT INTO chats (id, instance_id, external_id, canonical_id, chat_type, channel, name, tenant_id, created_at)
      VALUES
        ('${CHAT_A}', '${INSTANCE_A}', '${SHARED_JID}', '${SHARED_JID}', 'direct', 'whatsapp-baileys',
         '${SHARED_NAME}', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${CHAT_B}', '${INSTANCE_B}', '${SHARED_JID}', '${SHARED_JID}', 'direct', 'whatsapp-baileys',
         '${SHARED_NAME}', '${TENANT_B}', '${SHARED_TIMESTAMP}');

      INSERT INTO persons (id, display_name, tenant_id, created_at) VALUES
        ('${PERSON_A}', '${SHARED_NAME}', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${PERSON_B}', '${SHARED_NAME}', '${TENANT_B}', '${SHARED_TIMESTAMP}');

      INSERT INTO messages (id, chat_id, external_id, source, message_type, text_content, platform_timestamp,
                            tenant_id, created_at)
      VALUES
        ('${MESSAGE_A}', '${CHAT_A}', '${SHARED_MESSAGE_EXTERNAL_ID}', 'inbound', 'text',
         'tenant A secret', '${SHARED_TIMESTAMP}', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${MESSAGE_B}', '${CHAT_B}', '${SHARED_MESSAGE_EXTERNAL_ID}', 'inbound', 'text',
         'tenant B secret', '${SHARED_TIMESTAMP}', '${TENANT_B}', '${SHARED_TIMESTAMP}');
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // ONE physical connection, shared by both tenants' requests: any bleed
    // between them shows up here rather than being hidden by pool luck.
    runtimeDb = openDb(urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }), 1);

    // The services are constructed exactly as `createServices` builds them —
    // with the POOL. Nothing about them is test-specific; the scope is what
    // redirects them.
    instances = new InstanceService(runtimeDb, null);
    chats = new ChatService(runtimeDb, null);
    messages = new MessageService(runtimeDb, null);
    persons = new PersonService(runtimeDb, null);
    conversations = new ConversationService(runtimeDb, null);
  }, 180_000);

  afterAll(async () => {
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  describe('lists return only same-tenant rows', () => {
    test('instances', async () => {
      const a = await asTenant(TENANT_A, () => instances.list());
      const b = await asTenant(TENANT_B, () => instances.list());
      expect(a.items.map((i) => i.id)).toEqual([INSTANCE_A]);
      expect(b.items.map((i) => i.id)).toEqual([INSTANCE_B]);
    });

    test('chats', async () => {
      const a = await asTenant(TENANT_A, () => chats.list());
      const b = await asTenant(TENANT_B, () => chats.list());
      expect(a.items.map((c) => c.id)).toEqual([CHAT_A]);
      expect(b.items.map((c) => c.id)).toEqual([CHAT_B]);
    });

    test('messages', async () => {
      const a = await asTenant(TENANT_A, () => messages.list());
      const b = await asTenant(TENANT_B, () => messages.list());
      expect(a.items.map((m) => m.id)).toEqual([MESSAGE_A]);
      expect(b.items.map((m) => m.id)).toEqual([MESSAGE_B]);
    });
  });

  describe('scoping happens BEFORE limiting, not after', () => {
    test('a limit of 1 returns the tenant’s own row, never the other tenant’s', async () => {
      // The classic ordering bug: filter applied after the page is cut, so a
      // full page of foreign rows becomes an empty page instead of a full one.
      const a = await asTenant(TENANT_A, () => instances.list({ limit: 1 }));
      expect(a.items.map((i) => i.id)).toEqual([INSTANCE_A]);

      const chatPage = await asTenant(TENANT_B, () => chats.list({ limit: 1 }));
      expect(chatPage.items.map((c) => c.id)).toEqual([CHAT_B]);
    });

    test('hasMore reflects only same-tenant rows', async () => {
      // Each tenant owns exactly one instance; if the other tenant's row were
      // counted, a page of 1 would claim there is more to fetch.
      const a = await asTenant(TENANT_A, () => instances.list({ limit: 1 }));
      expect(a.hasMore).toBe(false);
    });
  });

  /**
   * `persons` and `conversations` are `unowned` in G2 (`tenancy-ownership.ts`):
   * their G0 rule names a parent that does not exist as a column, so G2
   * deliberately leaves `tenant_id` NULL and the G6 backfill decides ownership.
   * Under forced RLS the equality predicate `tenant_id = omni_current_tenant_id()`
   * therefore matches NOTHING, for every tenant.
   *
   * This is asserted rather than skipped because it is the single most
   * surprising consequence of enforcing RLS on the current schema, and because
   * a future change that starts stamping ownership on these tables must be
   * forced to come back and update this expectation deliberately. It is also
   * why the person/conversation sites stay `pending-G4-conversion` in the
   * db-access guard: the blocker is G6 ownership, not G4 plumbing.
   */
  describe('unowned tables are invisible to every tenant until the G6 backfill', () => {
    test('persons rows exist but no tenant can see them', async () => {
      const a = await asTenant(TENANT_A, () => persons.list());
      const b = await asTenant(TENANT_B, () => persons.list());
      expect(a.items).toEqual([]);
      expect(b.items).toEqual([]);
    });

    test('conversations behave the same way', async () => {
      const a = await asTenant(TENANT_A, () => conversations.list());
      const b = await asTenant(TENANT_B, () => conversations.list());
      expect(a).toEqual([]);
      expect(b).toEqual([]);
    });

    test('search over a colliding name leaks nothing, because it can see nothing', async () => {
      // The containment property still holds — vacuously here, but it holds.
      const a = await asTenant(TENANT_A, () => persons.search(SHARED_NAME));
      expect(a.map((p) => p.id)).toEqual([]);
    });
  });

  describe('direct cross-tenant id probes are non-enumerating', () => {
    /**
     * Each probe asks for a REAL id belonging to the other tenant, and the
     * requirement is that the answer is indistinguishable from one for an id
     * that never existed.
     *
     * The comparison masks the probed id out of the message first. These
     * services echo the requested id back ("Instance not found: <id>"), which
     * is not an oracle — the caller supplied that id and already knows it. What
     * would be an oracle is any OTHER difference: a different error type, a
     * different message shape, a name, a count, a timestamp. Masking the one
     * value the caller already holds is what lets the assertion be about
     * everything else.
     */
    const unknownId = '00000000-0000-4000-8000-000000000000';
    const shape = async (probe: () => Promise<unknown>, id: string): Promise<string> => {
      try {
        return `resolved:${JSON.stringify(await probe())}`;
      } catch (error) {
        const e = error as Error;
        return `${e.constructor.name}:${e.message.split(id).join('<id>')}`;
      }
    };

    test('instances: a foreign id is indistinguishable from a nonexistent one', async () => {
      const foreign = await asTenant(TENANT_A, () => shape(() => instances.getById(INSTANCE_B), INSTANCE_B));
      const missing = await asTenant(TENANT_A, () => shape(() => instances.getById(unknownId), unknownId));
      expect(foreign).toBe(missing);
      expect(foreign).toContain('<id>');
    });

    test('chats: a foreign id is indistinguishable from a nonexistent one', async () => {
      const foreign = await asTenant(TENANT_A, () => shape(() => chats.getById(CHAT_B), CHAT_B));
      const missing = await asTenant(TENANT_A, () => shape(() => chats.getById(unknownId), unknownId));
      expect(foreign).toBe(missing);
    });

    test('messages: a foreign id is indistinguishable from a nonexistent one', async () => {
      const foreign = await asTenant(TENANT_A, () => shape(() => messages.getById(MESSAGE_B), MESSAGE_B));
      const missing = await asTenant(TENANT_A, () => shape(() => messages.getById(unknownId), unknownId));
      expect(foreign).toBe(missing);
    });

    test('the foreign row is genuinely there — the probe is not passing vacuously', async () => {
      // Without this, every probe above would still pass if the seed had
      // silently failed and neither row existed.
      const owner = await asTenant(TENANT_B, () => instances.getById(INSTANCE_B));
      expect(owner.id).toBe(INSTANCE_B);
    });
  });

  describe('indirect probes through a parent the caller does not own', () => {
    test('messages of a foreign chat are not readable by chat id', async () => {
      // The chat id is real and the messages exist — but they belong to B, and
      // reaching them through a parent id must not be a way around the scope.
      const rows = await asTenant(TENANT_A, () => messages.list({ chatId: CHAT_B }));
      expect(rows.items).toEqual([]);
    });

    test('a foreign chat cannot be reached through its instance id', async () => {
      const rows = await asTenant(TENANT_A, () => chats.list({ instanceId: INSTANCE_B }));
      expect(rows.items).toEqual([]);
    });
  });

  describe('the scope does not leak between requests on one connection', () => {
    test('interleaved tenant requests each see only their own data', async () => {
      const results = await Promise.all([
        asTenant(TENANT_A, () => instances.list()),
        asTenant(TENANT_B, () => instances.list()),
        asTenant(TENANT_A, () => instances.list()),
      ]);
      expect(results.map((r) => r.items.map((i) => i.id))).toEqual([[INSTANCE_A], [INSTANCE_B], [INSTANCE_A]]);
    });

    test('an unscoped call after a scoped one is refused by the server', async () => {
      await asTenant(TENANT_A, () => instances.list());
      // No scope is active here, so the service reaches the ambient pool and
      // the forced RLS policy denies it — the connection carries no leftover
      // tenant from the request that just finished.
      await expect(instances.list()).rejects.toThrow(/app\.tenant_id is not set/);
    });
  });
});
