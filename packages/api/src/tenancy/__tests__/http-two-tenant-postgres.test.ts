/**
 * Two-tenant containment over REAL HTTP, with REAL minted tenant credentials
 * (wish: omni-full-multitenancy, Group G4; ADR-0003, ADR-0004, ADR-0006).
 *
 * WHAT MAKES THIS DIFFERENT FROM THE OTHER TWO-TENANT SUITE
 * ---------------------------------------------------------
 * `two-tenant-adversarial-postgres.test.ts` calls services directly inside a
 * scope the test itself opens. It proves containment holds once a scope exists.
 * It cannot prove that a request ever GETS one — its own header note records
 * that gap and defers it here.
 *
 * This suite closes it. Nothing is synthesised: the credentials are minted over
 * HTTP through `POST /platform/tenants/:id/keys/root` (#979) by a real platform
 * credential, presented as a plaintext `x-api-key` header over
 * `app.request(...)`, and resolved by the
 * real `tenancyMiddleware` → `authMiddleware` → `scopeEnforcerMiddleware` chain
 * in the same order `app.ts` mounts it, against real route modules, over a real
 * PostgreSQL database with RLS enforced and the runtime role's grants applied.
 * Every link — edge, authorization, route, service, RLS — is the production one.
 *
 * THE FIXTURE IS BUILT TO CONFUSE
 * -------------------------------
 * Tenants A and B hold colliding display names, chat external ids, canonical
 * JIDs, message external ids, and identical timestamps, exactly as the sibling
 * suite does. Every row of A has a twin in B distinguishable only by
 * `tenant_id`, so a containment bug cannot be masked by a fixture that happens
 * to look different on each side.
 *
 * WHY THE CHILD-KEY PROBE IS SPLIT IN TWO
 * ---------------------------------------
 * See `describe('child key delegation over HTTP')`. The ceiling behaviour and
 * the enforced-world reachability of `POST /keys` are separate facts, and the
 * second one is currently a gap in the G3 role model rather than in this route.
 * Both are pinned rather than papered over.
 *
 * Set `OMNI_G4_POSTGRES_URL` to a DISPOSABLE superuser URL; `scripts/pg-gate.ts`
 * does that for you. No ambient `DATABASE_URL` is read.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_ROLE_NAMES,
  type Database,
  applyTenancyRoles,
  applyTenantRlsEnforcement,
  createDbHandle,
} from '@omni/db';
import { provisionMigratedDatabase } from '@omni/db/pg-migrated-template';
import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { errorHandler } from '../../middleware/error';
import { scopeEnforcerMiddleware } from '../../middleware/scope-enforcer';
import { tenancyMiddleware } from '../../middleware/tenancy';
import { chatsRoutes } from '../../routes/v2/chats';
import { instancesRoutes } from '../../routes/v2/instances';
import { keysRoutes } from '../../routes/v2/keys';
import { messagesRoutes } from '../../routes/v2/messages';
import { personsRoutes } from '../../routes/v2/persons';
import { platformTenantRoutes } from '../../routes/v2/platform-tenants';
import type { Services } from '../../services';
import { ApiKeyService } from '../../services/api-keys';
import { AuthBootstrapService } from '../../services/auth-bootstrap';
import { ChatService } from '../../services/chats';
import { EventService } from '../../services/events';
import { InstanceService } from '../../services/instances';
import { MessageService } from '../../services/messages';
import { PersonService } from '../../services/persons';
import { TenantKeyService } from '../../services/tenant-keys';
import type { AppVariables } from '../../types';
import { MULTITENANCY_FLAG_ENV } from '../feature-flag';
import { generateSecret, hashSecret, secretPrefix } from '../hash';
import { MembershipSelectionService, RequestAuthenticator } from '../request-auth';

const superUrl = process.env.OMNI_G4_POSTGRES_URL ?? '';
const postgresDescribe = superUrl.length > 0 ? describe : describe.skip;
const psqlBin = process.env.OMNI_G4_PSQL_BIN ?? 'psql';

const TENANT_A = '11111111-1111-4111-8111-11111111111a';
const TENANT_B = '22222222-2222-4222-8222-22222222222b';
/** Seeded SUSPENDED — exists only so root issuance against an inactive tenant can be probed. */
const TENANT_C_SUSPENDED = '22222222-2222-4222-8222-22222222222c';
const PRINCIPAL_A = '33333333-3333-4333-8333-33333333333a';
const PRINCIPAL_B = '33333333-3333-4333-8333-33333333333b';
/** Holds an ACTIVE membership in BOTH tenants — the header-confusion case that matters. */
const PRINCIPAL_DUAL = '33333333-3333-4333-8333-33333333333d';
const PLATFORM_PRINCIPAL = '33333333-3333-4333-8333-3333333333f0';
const MEMBERSHIP_A = '44444444-4444-4444-8444-44444444444a';
const MEMBERSHIP_B = '44444444-4444-4444-8444-44444444444b';
const MEMBERSHIP_DUAL_A = '44444444-4444-4444-8444-4444444444d1';
const MEMBERSHIP_DUAL_B = '44444444-4444-4444-8444-4444444444d2';
/** PRINCIPAL_A's membership in the suspended tenant C. */
const MEMBERSHIP_C = '44444444-4444-4444-8444-44444444444c';
const PLATFORM_KEY_ID = '4444aaaa-4444-4444-8444-4444444444f0';
const PLATFORM_CREDENTIAL_ID = '4444bbbb-4444-4444-8444-4444444444f1';
const INSTANCE_A = '55555555-5555-4555-8555-55555555555a';
const INSTANCE_B = '55555555-5555-4555-8555-55555555555b';
const CHAT_A = '66666666-6666-4666-8666-66666666666a';
const CHAT_B = '66666666-6666-4666-8666-66666666666b';
const MESSAGE_A = '77777777-7777-4777-8777-77777777777a';
const MESSAGE_B = '77777777-7777-4777-8777-77777777777b';
const PERSON_A = '88888888-8888-4888-8888-88888888888a';
const PERSON_B = '88888888-8888-4888-8888-88888888888b';
const EVENT_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const EVENT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
/** Never inserted. The control for every non-enumeration probe. */
const NEVER_EXISTED = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const SHARED_NAME = 'Ana Silva';
const SHARED_JID = '5511999990000@s.whatsapp.net';
const SHARED_MESSAGE_EXTERNAL_ID = 'wamid.SHARED_COLLIDING_ID';
const SHARED_TIMESTAMP = '2026-01-01 00:00:00+00';

function password(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** The legacy `api_keys.key_hash` format: SHA-256, lowercase hex. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function runSqlOn(url: string, script: string): { exitCode: number; stderr: string } {
  const file = join(tmpdir(), `omni-g4-http-${crypto.randomUUID()}.sql`);
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

const sqlArray = (values: readonly string[]) => `ARRAY[${values.map((v) => `'${v}'`).join(',')}]::text[]`;

postgresDescribe('two-tenant containment over HTTP (real PostgreSQL)', () => {
  const dbName = `omni_g4_http_${crypto.randomUUID().replaceAll('-', '')}`;
  const passwords = { ddl: password(), runtime: password(), authPlane: password() };
  const closers: (() => Promise<void>)[] = [];
  const flagWasSet = process.env[MULTITENANCY_FLAG_ENV];

  let app: Hono<{ Variables: AppVariables }>;
  /** Plaintext secrets, minted once in `beforeAll`. Never logged or persisted. */
  const keys = { a: '', b: '', dualA: '', legacy: '', platform: '' };

  function openDb(url: string, maxConnections: number): Database {
    const handle = createDbHandle({ url, maxConnections });
    closers.push(() => handle.close().catch(() => undefined));
    return handle.db;
  }

  /** One request, exactly as a client would make it. */
  const get = (path: string, key: string, headers: Record<string, string> = {}) =>
    app.request(path, { headers: { 'x-api-key': key, ...headers } });

  beforeAll(async () => {
    provisionMigratedDatabase({ superUrl, psqlBin }, dbName);
    const superDbUrl = urlFor(superUrl, dbName);

    // The platform actor that ISSUES the tenant root keys. Its credential and
    // its source key must agree field-for-field or
    // `platformActorFreshnessFailure` refuses the issuance — which is the
    // point: the fixture cannot fake an issuer.
    const platformSecret = generateSecret();
    const platformHash = await hashSecret(platformSecret);
    const platformPrefix = secretPrefix(platformSecret);
    // Root issuance over HTTP needs BOTH: the route guard checks
    // `platform:tenant-keys:write`, and `issueRootKey` itself re-checks
    // `platform:tenants:write` inside the transaction.
    const platformScopes = ['platform:tenants:write', 'platform:tenant-keys:write'];
    keys.platform = platformSecret;

    // A REAL legacy key, in the exact storage form `ApiKeyService.validate`
    // expects: the `omni_sk_` prefix its format check requires, and the SHA-256
    // hex digest it looks the row up by. The hashing is reproduced here rather
    // than called because `ApiKeyService.hashKey` is private — and it should
    // stay private, since nothing in production hashes a key it did not mint.
    // A fixture that seeds SQL directly has to speak the storage format anyway;
    // if that format ever changes, the dual-world probes below go red, which is
    // the correct signal.
    const legacySecret = `omni_sk_${crypto.randomUUID().replaceAll('-', '')}`;
    const legacyHash = await sha256Hex(legacySecret);
    keys.legacy = legacySecret;

    const seeded = runSqlOn(
      superDbUrl,
      `
      INSERT INTO tenants (id, slug, display_name, max_key_ttl_seconds, max_key_rate_limit, max_key_budget) VALUES
        ('${TENANT_A}', 'tenant-a', 'Tenant A', 86400, 1000, 1000),
        ('${TENANT_B}', 'tenant-b', 'Tenant B', 86400, 1000, 1000);

      -- Suspended from birth: exists solely so the root-issuance probes can
      -- show an inactive tenant refusing issuance, without suspending A or B
      -- (which would bump their revocation epochs and break every minted key).
      INSERT INTO tenants (id, slug, display_name, status, max_key_ttl_seconds, max_key_rate_limit, max_key_budget)
      VALUES ('${TENANT_C_SUSPENDED}', 'tenant-c', 'Tenant C', 'suspended', 86400, 1000, 1000);

      INSERT INTO principals (id, type, subject) VALUES
        ('${PRINCIPAL_A}', 'human', 'subject-a'),
        ('${PRINCIPAL_B}', 'human', 'subject-b'),
        ('${PRINCIPAL_DUAL}', 'human', 'subject-dual'),
        ('${PLATFORM_PRINCIPAL}', 'service', 'subject-platform');

      INSERT INTO tenant_memberships (id, tenant_id, principal_id, role) VALUES
        ('${MEMBERSHIP_A}', '${TENANT_A}', '${PRINCIPAL_A}', 'tenant-admin'),
        ('${MEMBERSHIP_B}', '${TENANT_B}', '${PRINCIPAL_B}', 'tenant-admin'),
        -- The dual-membership principal: genuinely entitled in BOTH tenants.
        ('${MEMBERSHIP_DUAL_A}', '${TENANT_A}', '${PRINCIPAL_DUAL}', 'tenant-admin'),
        ('${MEMBERSHIP_DUAL_B}', '${TENANT_B}', '${PRINCIPAL_DUAL}', 'tenant-admin'),
        -- A perfectly valid membership in the SUSPENDED tenant C.
        ('${MEMBERSHIP_C}', '${TENANT_C_SUSPENDED}', '${PRINCIPAL_A}', 'tenant-admin');

      INSERT INTO platform_api_keys (id, name, key_prefix, key_hash, scopes, principal_id) VALUES
        ('${PLATFORM_KEY_ID}', 'g4-http-issuer', '${platformPrefix}', '${platformHash}',
         ${sqlArray(platformScopes)}, '${PLATFORM_PRINCIPAL}');

      INSERT INTO auth_credentials
        (id, credential_class, key_hash, key_prefix, principal_id, platform_api_key_id, scopes) VALUES
        ('${PLATFORM_CREDENTIAL_ID}', 'platform', '${platformHash}', '${platformPrefix}',
         '${PLATFORM_PRINCIPAL}', '${PLATFORM_KEY_ID}', ${sqlArray(platformScopes)});

      -- A LEGACY key, for the dual-world probes. It is not in auth_credentials,
      -- so the auth plane cannot recognise it and the edge must decline.
      INSERT INTO api_keys (name, key_prefix, key_hash, scopes) VALUES
        ('legacy-key', '${legacySecret.substring(8, 16)}', '${legacyHash}', ${sqlArray(['*'])});

      INSERT INTO instances (id, name, channel, tenant_id, created_at) VALUES
        ('${INSTANCE_A}', 'shared-instance-name-a', 'whatsapp-baileys', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${INSTANCE_B}', 'shared-instance-name-b', 'whatsapp-baileys', '${TENANT_B}', '${SHARED_TIMESTAMP}');

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

      INSERT INTO omni_events (id, channel, instance_id, person_id, event_type, text_content, tenant_id, received_at)
      VALUES
        ('${EVENT_A}', 'whatsapp-baileys', '${INSTANCE_A}', '${PERSON_A}', 'message',
         'tenant A timeline entry', '${TENANT_A}', '${SHARED_TIMESTAMP}'),
        ('${EVENT_B}', 'whatsapp-baileys', '${INSTANCE_B}', '${PERSON_B}', 'message',
         'tenant B timeline entry', '${TENANT_B}', '${SHARED_TIMESTAMP}');

      -- WHY OWNERSHIP FOR THESE TWO TABLES IS SET BY UPDATE, NOT BY INSERT
      -- ------------------------------------------------------------------
      -- G2 installed BEFORE INSERT triggers (\`omni_tenant_ownership_*\`,
      -- migration 0041) that DERIVE tenant identity and explicitly refuse to
      -- accept it from the caller — every one of them opens with
      -- \`NEW."tenant_id" := NULL\`. That is the correct rule and this fixture
      -- must not fight it, but it has two consequences here:
      --
      --   * \`persons\` is a ROOT entity with no owning parent to derive from, so
      --     its trigger can only ever leave \`tenant_id\` NULL. Assigning person
      --     ownership is a G6 backfill concern, not something an INSERT can say.
      --   * \`omni_events\` derives from its parents and deliberately will not
      --     "write a non-null child tenant id above a NULL-owner parent". Its
      --     \`person_id\` points at one of the persons above, so it inherits that
      --     NULL and lands unowned too — even though its \`instance_id\` parent is
      --     properly owned.
      --
      -- The tenant_id values in the INSERTs above are therefore silently
      -- discarded for these two tables. Without this UPDATE the rows exist but
      -- belong to nobody, RLS hides them from BOTH tenants, and the timeline
      -- probes would pass vacuously — "B cannot see A's timeline" is worthless
      -- if nobody can see any timeline. The UPDATE is what a G6 backfill does;
      -- the triggers are BEFORE INSERT only, so it is the supported way to
      -- establish already-owned rows.
      UPDATE persons SET tenant_id = '${TENANT_A}' WHERE id = '${PERSON_A}';
      UPDATE persons SET tenant_id = '${TENANT_B}' WHERE id = '${PERSON_B}';
      UPDATE omni_events SET tenant_id = '${TENANT_A}' WHERE id = '${EVENT_A}';
      UPDATE omni_events SET tenant_id = '${TENANT_B}' WHERE id = '${EVENT_B}';
      `,
    );
    if (seeded.exitCode !== 0) throw new Error(`seed failed: ${seeded.stderr}`);

    // The fixture is only meaningful if those four rows are genuinely owned.
    // A silent regression here (a new BEFORE UPDATE trigger, a changed
    // derivation rule) would make the containment probes vacuous rather than
    // failing, so it is checked rather than assumed.
    const ownership = runSqlOn(
      superDbUrl,
      `DO $$
       DECLARE unowned int;
       BEGIN
         SELECT count(*) INTO unowned FROM (
           SELECT tenant_id FROM persons WHERE id IN ('${PERSON_A}', '${PERSON_B}')
           UNION ALL
           SELECT tenant_id FROM omni_events WHERE id IN ('${EVENT_A}', '${EVENT_B}')
         ) t WHERE t.tenant_id IS NULL;
         IF unowned > 0 THEN
           RAISE EXCEPTION 'fixture has % unowned person/event rows', unowned;
         END IF;
       END $$;`,
    );
    if (ownership.exitCode !== 0) throw new Error(`fixture ownership check failed: ${ownership.stderr}`);

    const provisioner = openDb(superDbUrl, 3);
    await applyTenantRlsEnforcement(provisioner);
    await applyTenancyRoles(provisioner, passwords, DEFAULT_ROLE_NAMES, dbName);

    // ONE physical runtime connection, shared by every request: cross-request
    // scope bleed shows up here rather than being hidden by pool luck.
    const runtimeDb = openDb(
      urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime }),
      1,
    );
    // The auth plane on its own SELECT-only identity, which is how
    // `resolveAuthPlaneConnection` wires it under enforcement — the runtime role
    // is REVOKEd on `auth_credentials`, so the lookup could not run on it.
    const authPlaneDb = openDb(
      urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane }),
      2,
    );

    const authBootstrap = new AuthBootstrapService(authPlaneDb);
    const services = {
      instances: new InstanceService(runtimeDb, null),
      chats: new ChatService(runtimeDb, null),
      messages: new MessageService(runtimeDb, null),
      persons: new PersonService(runtimeDb, null),
      events: new EventService(runtimeDb),
      apiKeys: new ApiKeyService(runtimeDb),
      authBootstrap,
      requestAuthenticator: new RequestAuthenticator(authBootstrap, new MembershipSelectionService(authPlaneDb)),
      // Issuance needs to WRITE the auth plane, which neither application role
      // may do under enforcement. Wiring the provisioner here isolates that gap
      // so the ceiling tests below measure the ceiling and not the grant — the
      // gap itself is pinned by its own test.
      tenantKeys: new TenantKeyService(provisioner),
    } as unknown as Services;

    process.env[MULTITENANCY_FLAG_ENV] = 'true';

    app = new Hono<{ Variables: AppVariables }>();
    app.onError(errorHandler);
    app.use('*', async (c, next) => {
      c.set('db', runtimeDb);
      c.set('services', services);
      c.set('requestId', crypto.randomUUID());
      c.set('eventBus', null);
      c.set('channelRegistry', null);
      await next();
    });
    // Mounted BEFORE the tenancy/auth/scope chain, exactly as `app.ts` mounts
    // it on the root app outside `protectedApp`: the control plane carries its
    // own platform-class guard and the legacy middleware never sees it.
    app.route('/api/v2/platform', platformTenantRoutes);
    // The production order, from `app.ts`: the tenancy edge decides the world,
    // then legacy auth, then scope enforcement.
    app.use('*', tenancyMiddleware);
    app.use('*', authMiddleware);
    app.use('*', scopeEnforcerMiddleware);
    app.route('/api/v2/instances', instancesRoutes);
    app.route('/api/v2/chats', chatsRoutes);
    app.route('/api/v2/messages', messagesRoutes);
    app.route('/api/v2/persons', personsRoutes);
    app.route('/api/v2/keys', keysRoutes);

    // Mint the tenant credentials through the REAL issuance path — over HTTP,
    // through `POST /platform/tenants/:id/keys/root` (#979), with the seeded
    // platform credential presented as `x-api-key`. Issuance is a control-plane
    // act that happens before any tenant request exists, so it is fixture
    // setup; but reaching it through the route means the whole supported
    // bootstrap chain (platform guard → action/tenant binding → transactional
    // `issueRootKey`) is what mints every credential this suite then probes.
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
    const mint = async (tenantId: string, principalId: string, membershipId: string, name: string) => {
      const res = await app.request(`/api/v2/platform/tenants/${tenantId}/keys/root`, {
        method: 'POST',
        headers: { 'x-api-key': keys.platform, 'content-type': 'application/json' },
        body: JSON.stringify({
          principalId,
          membershipId,
          role: 'tenant-admin',
          name,
          scopes: ['tenant:*', 'keys:delegate'],
          expiresAt,
          rateLimit: 1000,
          budget: 1000,
          reason: 'g4 http two-tenant acceptance fixture',
        }),
      });
      if (res.status !== 201) throw new Error(`fixture root issuance failed for ${name}: ${res.status}`);
      const { data } = (await res.json()) as {
        data: { tenantId: string; delegationDepth: number; plainTextKey: string };
      };
      if (data.tenantId !== tenantId || data.delegationDepth !== 0) {
        throw new Error(`fixture root issuance returned a mis-bound credential for ${name}`);
      }
      return data.plainTextKey;
    };

    keys.a = await mint(TENANT_A, PRINCIPAL_A, MEMBERSHIP_A, 'tenant-a-root');
    keys.b = await mint(TENANT_B, PRINCIPAL_B, MEMBERSHIP_B, 'tenant-b-root');
    keys.dualA = await mint(TENANT_A, PRINCIPAL_DUAL, MEMBERSHIP_DUAL_A, 'dual-a-root');
  }, 180_000);

  afterAll(async () => {
    if (flagWasSet === undefined) delete process.env[MULTITENANCY_FLAG_ENV];
    else process.env[MULTITENANCY_FLAG_ENV] = flagWasSet;
    for (const close of closers) await close();
    runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`);
  });

  describe('a minted tenant credential can actually use the API', () => {
    // If this fails, every probe below is vacuous: a 403 from the scope
    // enforcer would "contain" tenant B's data just as well as RLS does, and
    // for entirely the wrong reason.
    test('the credential is authorized on a tenant-scoped route', async () => {
      const res = await get('/api/v2/instances', keys.a);
      expect(res.status).toBe(200);
    });

    test('it reads its own instance by id', async () => {
      const res = await get(`/api/v2/instances/${INSTANCE_A}`, keys.a);
      expect(res.status).toBe(200);
      expect(((await res.json()) as { data: { id: string } }).data.id).toBe(INSTANCE_A);
    });
  });

  describe('lists return only same-tenant rows', () => {
    test('instances', async () => {
      const res = await get('/api/v2/instances', keys.a);
      const { items } = (await res.json()) as { items: { id: string }[] };
      expect(items.map((i) => i.id)).toEqual([INSTANCE_A]);
    });

    test('the other tenant sees the mirror image over the same connection', async () => {
      const res = await get('/api/v2/instances', keys.b);
      const { items } = (await res.json()) as { items: { id: string }[] };
      expect(items.map((i) => i.id)).toEqual([INSTANCE_B]);
    });

    test('scoping happens BEFORE limiting — a limit of 1 never yields the foreign twin', async () => {
      const res = await get('/api/v2/instances?limit=1', keys.a);
      const { items, meta } = (await res.json()) as { items: { id: string }[]; meta: { hasMore: boolean } };
      expect(items.map((i) => i.id)).toEqual([INSTANCE_A]);
      // Two rows exist globally; only one is A's, so there is nothing more.
      expect(meta.hasMore).toBe(false);
    });
  });

  describe('direct cross-tenant /:id probes are non-enumerating', () => {
    /**
     * A foreign id and an id that never existed must be indistinguishable.
     *
     * The comparison substitutes the probed id out of both bodies first. These
     * 404s echo the id the CALLER asked for (`"Chat not found: <id>"`), so the
     * raw texts necessarily differ for two different ids — but echoing the
     * caller's own input tells the caller nothing it did not already know, and
     * is not an oracle. What WOULD be an oracle is any other difference:
     * a different status, error code, message shape, or detail field for
     * "exists but belongs to someone else" versus "never existed". Normalising
     * the one value that is legitimately allowed to differ is what makes the
     * assertion test that, rather than testing string formatting.
     */
    async function compare(path: (id: string) => string, foreignId: string) {
      const foreign = await get(path(foreignId), keys.a);
      const absent = await get(path(NEVER_EXISTED), keys.a);
      expect(foreign.status).toBe(absent.status);
      const normalise = (text: string, id: string) => text.replaceAll(id, '<probed-id>');
      expect(normalise(await foreign.text(), foreignId)).toBe(normalise(await absent.text(), NEVER_EXISTED));
      return foreign.status;
    }

    test('instances', async () => {
      expect(await compare((id) => `/api/v2/instances/${id}`, INSTANCE_B)).toBe(404);
    });

    test('chats', async () => {
      expect(await compare((id) => `/api/v2/chats/${id}`, CHAT_B)).toBe(404);
    });

    test('messages', async () => {
      expect(await compare((id) => `/api/v2/messages/${id}`, MESSAGE_B)).toBe(404);
    });

    test('the foreign rows are genuinely there — the probes are not passing vacuously', async () => {
      expect((await get(`/api/v2/instances/${INSTANCE_B}`, keys.b)).status).toBe(200);
      expect((await get(`/api/v2/chats/${CHAT_B}`, keys.b)).status).toBe(200);
      expect((await get(`/api/v2/messages/${MESSAGE_B}`, keys.b)).status).toBe(200);
    });
  });

  describe('indirect probes through a parent the caller does not own', () => {
    test('the messages of a foreign chat are not readable by chat id', async () => {
      const res = await get(`/api/v2/chats/${CHAT_B}/messages`, keys.a);
      if (res.status === 200) {
        expect(((await res.json()) as { items: unknown[] }).items).toEqual([]);
      } else {
        expect(res.status).toBe(404);
      }
    });

    test('a person timeline is filtered before it is paginated or counted', async () => {
      const foreign = await get(`/api/v2/persons/${PERSON_B}/timeline`, keys.a);
      expect(foreign.status).toBe(200);
      const body = (await foreign.json()) as { items: unknown[]; meta: { hasMore: boolean; cursor?: string } };
      // Not merely "no rows returned": no count, no cursor, nothing that would
      // let A infer that B's person has timeline entries at all.
      expect(body.items).toEqual([]);
      expect(body.meta.hasMore).toBe(false);
      expect(body.meta.cursor).toBeUndefined();
    });

    test('the same timeline is non-empty for its owner', async () => {
      const own = await get(`/api/v2/persons/${PERSON_B}/timeline`, keys.b);
      const body = (await own.json()) as { items: { id: string }[] };
      expect(body.items.map((i) => i.id)).toEqual([EVENT_B]);
    });
  });

  describe('the advisory tenant header can confirm but never select', () => {
    test('a confirming header is accepted', async () => {
      const res = await get('/api/v2/instances', keys.a, { 'x-omni-tenant-id': TENANT_A });
      expect(res.status).toBe(200);
      expect(((await res.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([INSTANCE_A]);
    });

    test('a header naming another tenant is rejected — caller holds NO membership there', async () => {
      const res = await get('/api/v2/instances', keys.a, { 'x-omni-tenant-id': TENANT_B });
      expect(res.status).toBe(401);
    });

    test('a header naming another tenant is rejected even when the caller IS a member there', async () => {
      // `PRINCIPAL_DUAL` holds an active tenant-admin membership in B. The
      // credential is bound to A, and a credential's tenant is not negotiable —
      // the entitlement elsewhere is irrelevant. This is the case a
      // membership-first implementation gets wrong.
      const res = await get('/api/v2/instances', keys.dualA, { 'x-omni-tenant-id': TENANT_B });
      expect(res.status).toBe(401);
    });

    test('the two rejections are byte-identical, so the header is not a membership oracle', async () => {
      const noMembership = await get('/api/v2/instances', keys.a, { 'x-omni-tenant-id': TENANT_B });
      const withMembership = await get('/api/v2/instances', keys.dualA, { 'x-omni-tenant-id': TENANT_B });
      expect(await noMembership.text()).toBe(await withMembership.text());
    });

    test('a header naming a tenant that does not exist is rejected the same way', async () => {
      const unknown = await get('/api/v2/instances', keys.a, { 'x-omni-tenant-id': NEVER_EXISTED });
      const foreign = await get('/api/v2/instances', keys.a, { 'x-omni-tenant-id': TENANT_B });
      expect(unknown.status).toBe(foreign.status);
      expect(await unknown.text()).toBe(await foreign.text());
    });
  });

  /**
   * WHICH WORLD THIS FIXTURE IS, AND WHAT THAT MEANS FOR A LEGACY KEY
   * -----------------------------------------------------------------
   * This suite is the ENFORCED world: the flag is on, RLS policies are
   * installed, and the request path runs as the non-owning `NOBYPASSRLS`
   * runtime role. That is the whole point — it is what makes the containment
   * probes above test RLS rather than a service `where` clause.
   *
   * A legacy key in that world is a deliberately awkward case, and the
   * behaviour below is the DESIGNED one rather than a defect. `tenancyMiddleware`
   * does not recognise the key in the auth plane, so it falls through with no
   * tenant context and the ambient (unscoped) handle. Every tenant-scoped table
   * then answers through `omni_current_tenant_id()`, which RAISES
   * `insufficient_privilege` when `app.tenant_id` was never set
   * (`tenancy-rls.ts`, "FAIL-CLOSED SHAPE"). A missing context is an ERROR, not
   * an empty result — chosen precisely so it cannot be mistaken for a clean
   * read.
   *
   * So the security-relevant property to pin here is NOT "legacy still sees
   * everything" — that is the FLAG-OFF contract, and it is proven by the entire
   * pre-existing test surface, which runs flag-off and stays green. Asserting it
   * here would assert the wrong world's contract and would only pass if
   * enforcement were broken. What matters under enforcement is the negative:
   * turning enforcement on must not leave a legacy credential as an
   * unconstrained cross-tenant reader.
   */
  describe('under enforcement a legacy credential is not a cross-tenant reader', () => {
    test('it is not recognised by the auth plane, so it gets no tenant scope', async () => {
      // A 200 here would be the alarming outcome: it would mean an unscoped
      // handle read tenant-owned rows with RLS supposedly enforced.
      const res = await get('/api/v2/instances', keys.legacy);
      expect(res.status).toBe(500);
      const body = (await res.json()) as { error?: { code?: string } };
      expect(body.error?.code).toBeDefined();
    });

    test('it cannot read either tenant’s row by id', async () => {
      expect((await get(`/api/v2/instances/${INSTANCE_A}`, keys.legacy)).status).not.toBe(200);
      expect((await get(`/api/v2/instances/${INSTANCE_B}`, keys.legacy)).status).not.toBe(200);
    });

    test('an unknown secret is still rejected by the legacy path', async () => {
      expect((await get('/api/v2/instances', 'not-a-key-at-all')).status).toBe(401);
    });
  });

  describe('child key delegation over HTTP', () => {
    const post = (body: unknown, key: string) =>
      app.request('/api/v2/keys', {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    test('a tenant credential mints a child bound to its OWN tenant', async () => {
      const res = await post({ name: 'child-of-a', scopes: ['tenant:read'], reason: 'probe' }, keys.a);
      expect(res.status).toBe(201);
      const { data } = (await res.json()) as { data: { tenantId: string; delegationDepth: number } };
      expect(data.tenantId).toBe(TENANT_A);
      expect(data.delegationDepth).toBe(1);
    });

    test('a tenantId in the body is inert — it cannot move the child to another tenant', async () => {
      const res = await post(
        { name: 'child-body-claim', scopes: ['tenant:read'], reason: 'probe', tenantId: TENANT_B },
        keys.a,
      );
      expect(res.status).toBe(201);
      expect(((await res.json()) as { data: { tenantId: string } }).data.tenantId).toBe(TENANT_A);
    });

    test('the parent scope ceiling is enforced at the route', async () => {
      // `platform:*` is outside anything a tenant credential holds, so the
      // route refuses before a transaction is ever opened.
      const res = await post({ name: 'child-too-wide', scopes: ['platform:tenants:write'] }, keys.a);
      expect(res.status).toBe(403);
    });

    test('a role the parent does not hold is refused', async () => {
      const res = await post({ name: 'child-bad-role', scopes: ['tenant:read'], role: 'platform-admin' }, keys.a);
      expect(res.status).toBe(400);
    });

    test('a minted child is itself a working, same-tenant credential', async () => {
      const res = await post({ name: 'child-usable', scopes: ['tenant:read'], reason: 'probe' }, keys.a);
      const { data } = (await res.json()) as { data: { plainTextKey: string } };

      const own = await get('/api/v2/instances', data.plainTextKey);
      expect(own.status).toBe(200);
      expect(((await own.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([INSTANCE_A]);

      // And it inherits the containment, not just the tenant id.
      const foreign = await get(`/api/v2/instances/${INSTANCE_B}`, data.plainTextKey);
      expect(foreign.status).toBe(404);
    });

    test('a read-only child cannot mint a grandchild', async () => {
      const created = await post({ name: 'child-readonly', scopes: ['tenant:read'], reason: 'probe' }, keys.a);
      const { data } = (await created.json()) as { data: { plainTextKey: string } };
      // No `keys:delegate`, so `keys:write` is never projected and the scope
      // enforcer refuses the route outright.
      expect((await post({ name: 'grandchild', scopes: ['tenant:read'] }, data.plainTextKey)).status).toBe(403);
    });
  });

  describe('root key issuance over HTTP (#979)', () => {
    const issueBody = (overrides: Record<string, unknown> = {}) => ({
      principalId: PRINCIPAL_A,
      membershipId: MEMBERSHIP_A,
      role: 'tenant-admin',
      name: `root-probe-${crypto.randomUUID().slice(0, 8)}`,
      scopes: ['tenant:*', 'keys:delegate'],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      rateLimit: 100,
      budget: 100,
      reason: 'root issuance adversarial probe',
      ...overrides,
    });
    const issue = (tenantId: string, body: Record<string, unknown>, key: string) =>
      app.request(`/api/v2/platform/tenants/${tenantId}/keys/root`, {
        method: 'POST',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });

    test('the platform credential issues a working tenant-class root over HTTP', async () => {
      const res = await issue(TENANT_A, issueBody({ name: 'extra-root-a' }), keys.platform);
      expect(res.status).toBe(201);
      const { data } = (await res.json()) as {
        data: { tenantId: string; delegationDepth: number; plainTextKey: string };
      };
      expect(data.tenantId).toBe(TENANT_A);
      expect(data.delegationDepth).toBe(0);

      // The issued credential authenticates as tenant A and is contained to it.
      const own = await get('/api/v2/instances', data.plainTextKey);
      expect(own.status).toBe(200);
      expect(((await own.json()) as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([INSTANCE_A]);
      expect((await get(`/api/v2/instances/${INSTANCE_B}`, data.plainTextKey)).status).toBe(404);

      // And it can mint a strictly narrower child through POST /keys.
      const child = await app.request('/api/v2/keys', {
        method: 'POST',
        headers: { 'x-api-key': data.plainTextKey, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'child-of-extra-root', scopes: ['tenant:read'], reason: 'probe' }),
      });
      expect(child.status).toBe(201);
      expect(((await child.json()) as { data: { tenantId: string } }).data.tenantId).toBe(TENANT_A);
    });

    test('a tenant credential cannot reach the surface (403), a legacy key is a uniform 401', async () => {
      expect((await issue(TENANT_A, issueBody(), keys.a)).status).toBe(403);
      expect((await issue(TENANT_A, issueBody(), keys.legacy)).status).toBe(401);
      expect((await issue(TENANT_A, issueBody(), 'not-a-key-at-all')).status).toBe(401);
    });

    test('a cross-tenant subject is indistinguishable from one that never existed', async () => {
      // MEMBERSHIP_B genuinely exists — in tenant B. Issuing under tenant A
      // must answer exactly as if it did not exist at all.
      const foreign = await issue(
        TENANT_A,
        issueBody({ principalId: PRINCIPAL_B, membershipId: MEMBERSHIP_B }),
        keys.platform,
      );
      const absent = await issue(TENANT_A, issueBody({ membershipId: NEVER_EXISTED }), keys.platform);
      expect(foreign.status).toBe(404);
      expect(absent.status).toBe(404);
      expect(await foreign.text()).toBe(await absent.text());
    });

    test('an inactive tenant refuses issuance even for its own valid membership', async () => {
      const res = await issue(
        TENANT_C_SUSPENDED,
        issueBody({ principalId: PRINCIPAL_A, membershipId: MEMBERSHIP_C }),
        keys.platform,
      );
      expect(res.status).toBe(409);
      // The lifecycle state itself is not echoed.
      expect(await res.text()).not.toContain('suspended');
    });

    test('a request above the tenant policy ceiling is refused', async () => {
      const res = await issue(TENANT_A, issueBody({ rateLimit: 1_000_000 }), keys.platform);
      expect(res.status).toBe(403);
    });

    test('wildcard and platform scopes fail closed', async () => {
      expect((await issue(TENANT_A, issueBody({ scopes: ['*'] }), keys.platform)).status).toBe(400);
      expect((await issue(TENANT_A, issueBody({ scopes: ['platform:tenants:write'] }), keys.platform)).status).toBe(
        400,
      );
    });
  });

  describe('KNOWN GAP — issuance is unreachable on an application identity under enforcement', () => {
    /**
     * `POST /keys` writes `auth_credentials`. Under G3 enforcement the runtime
     * role is REVOKEd on that table and the auth-plane role is granted SELECT
     * only (`tenancy-roles.ts`), so NO identity the application holds can
     * perform the write. The route above is exercised with the provisioning
     * handle to isolate the ceiling logic; this test pins the grant reality so
     * the gap is a tracked fact rather than a surprise, and so it fails loudly
     * if the role model changes underneath it.
     */
    test('the runtime role cannot write the credential index', async () => {
      const url = urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.runtime, password: passwords.runtime });
      const attempt = runSqlOn(
        url,
        `INSERT INTO auth_credentials (credential_class, key_hash, key_prefix, principal_id, platform_api_key_id, scopes)
         VALUES ('platform', repeat('a', 64), 'zzzz', '${PLATFORM_PRINCIPAL}', '${PLATFORM_KEY_ID}', ${sqlArray(['platform:x'])});`,
      );
      expect(attempt.exitCode).not.toBe(0);
      expect(attempt.stderr).toContain('permission denied');
    });

    test('the auth-plane role cannot write it either', async () => {
      const url = urlFor(superUrl, dbName, { name: DEFAULT_ROLE_NAMES.authPlane, password: passwords.authPlane });
      const attempt = runSqlOn(
        url,
        `INSERT INTO auth_credentials (credential_class, key_hash, key_prefix, principal_id, platform_api_key_id, scopes)
         VALUES ('platform', repeat('b', 64), 'zzzz', '${PLATFORM_PRINCIPAL}', '${PLATFORM_KEY_ID}', ${sqlArray(['platform:x'])});`,
      );
      expect(attempt.exitCode).not.toBe(0);
      expect(attempt.stderr).toContain('permission denied');
    });
  });
});
