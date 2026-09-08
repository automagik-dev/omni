/**
 * Idempotency / race tests for PersonService.findOrCreateIdentity.
 *
 * Reproduces the concurrent first-contact race that used to create orphan
 * phone-less persons and throw unhandled unique-violations:
 *   - N simultaneous first-contact messages from the SAME new
 *     (channel, instanceId, platformUserId) with NO phone must settle on
 *     exactly ONE platform_identities row and exactly ONE persons row, with
 *     every caller receiving the same identity + person and nobody throwing.
 *
 * Runs against the disposable test DB (describeWithDb / getTestDb). Real
 * DB-level concurrency is exercised via the connection pool: each
 * findOrCreateIdentity opens its own transaction on a separate pooled
 * connection, so the ON CONFLICT DO NOTHING blocking is the real thing.
 */

import { afterEach, beforeAll, expect, test } from 'bun:test';
import type { Database } from '@omni/db';
import { instances, persons, platformIdentities } from '@omni/db';
import { and, eq, sql } from 'drizzle-orm';
import { PersonService } from '../services/persons';
import { describeWithDb, getTestDb } from './db-helper';

describeWithDb('Identity resolution idempotency (concurrency)', () => {
  let db: Database;
  let personService: PersonService;
  let instanceId: string;
  const createdInstanceIds: string[] = [];

  beforeAll(async () => {
    db = getTestDb();
    personService = new PersonService(db, null);

    const [instance] = await db
      .insert(instances)
      .values({ name: `idem-race-inst-${Date.now()}`, channel: 'whatsapp-baileys' as const })
      .returning();
    if (!instance) throw new Error('Failed to create test instance');
    instanceId = instance.id;
    createdInstanceIds.push(instance.id);
  });

  afterEach(async () => {
    // Remove identities + persons for this instance so each test starts clean.
    const identities = await db.select().from(platformIdentities).where(eq(platformIdentities.instanceId, instanceId));
    const personIds = [...new Set(identities.map((i) => i.personId).filter((id): id is string => Boolean(id)))];
    await db.delete(platformIdentities).where(eq(platformIdentities.instanceId, instanceId));
    for (const personId of personIds) {
      await db.delete(persons).where(eq(persons.id, personId));
    }
  });

  test('N concurrent first-contact calls (no phone) yield one identity and one person', async () => {
    const platformUserId = `5599${Date.now()}@s.whatsapp.net`;
    const displayName = `idem-race-${Date.now()}`; // unique — used to detect orphan persons
    const N = 8;

    const results = await Promise.all(
      Array.from({ length: N }, () =>
        personService.findOrCreateIdentity(
          {
            channel: 'whatsapp-baileys',
            instanceId,
            platformUserId,
            platformUsername: displayName,
          },
          {
            createPerson: true,
            displayName,
            // No matchByPhone — this is the orphan-prone phone-less path.
            matchByPlatformUserId: platformUserId,
            matchByChannel: 'whatsapp-baileys',
          },
        ),
      ),
    );

    // Nobody threw, everybody got a person and an identity.
    for (const r of results) {
      expect(r.identity).toBeDefined();
      expect(r.person).not.toBeNull();
    }

    // All callers converged on the SAME identity and the SAME person.
    const identityIds = new Set(results.map((r) => r.identity.id));
    const personIdSet = new Set(results.map((r) => r.person?.id));
    expect(identityIds.size).toBe(1);
    expect(personIdSet.size).toBe(1);

    // Exactly one identity row exists for the natural key.
    const identityRows = await db
      .select()
      .from(platformIdentities)
      .where(
        and(
          eq(platformIdentities.channel, 'whatsapp-baileys'),
          eq(platformIdentities.instanceId, instanceId),
          eq(platformIdentities.platformUserId, platformUserId),
        ),
      );
    expect(identityRows.length).toBe(1);
    expect(identityRows[0]?.personId).toBe([...personIdSet][0] ?? null);

    // Exactly one person carries the unique display name — no orphans. (Before
    // the fix, every writer that lost the race created its own phone-less person.)
    const [{ n } = { n: 0 }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(persons)
      .where(eq(persons.displayName, displayName))) as Array<{ n: number }>;
    expect(n).toBe(1);
  });

  test('a repeat call for an existing identity returns it without a duplicate person', async () => {
    const platformUserId = `5588${Date.now()}@s.whatsapp.net`;
    const displayName = `idem-seq-${Date.now()}`;

    const first = await personService.findOrCreateIdentity(
      { channel: 'whatsapp-baileys', instanceId, platformUserId, platformUsername: displayName },
      { createPerson: true, displayName },
    );
    const second = await personService.findOrCreateIdentity(
      { channel: 'whatsapp-baileys', instanceId, platformUserId, platformUsername: displayName },
      { createPerson: true, displayName },
    );

    expect(first.isNew).toBe(true);
    expect(second.isNew).toBe(false); // existing-identity fast path
    expect(second.identity.id).toBe(first.identity.id);
    expect(second.person?.id).toBe(first.person?.id);

    const [{ n } = { n: 0 }] = (await db
      .select({ n: sql<number>`count(*)::int` })
      .from(persons)
      .where(eq(persons.displayName, displayName))) as Array<{ n: number }>;
    expect(n).toBe(1);
  });
});
