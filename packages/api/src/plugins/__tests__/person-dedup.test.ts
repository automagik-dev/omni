/**
 * Person Deduplication Tests
 *
 * Verifies identity resolution fixes from the person-dedup wish:
 * - LID sender with resolvedSenderPhone links to existing person (Group 1)
 * - LID sender without resolvedSenderPhone creates new person (Group 1)
 * - Cross-instance same platformUserId links to same person (Group 2)
 * - Different platformUserId creates different persons (Group 2)
 * - Sync worker skips LID-format phone (Group 3)
 * - Sync worker preserves real phone (Group 3)
 */

import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { Database, Person, PlatformIdentity } from '@omni/db';
import { persons, platformIdentities } from '@omni/db';
import { PersonService } from '../../services/persons';
import { isLidFormat, isValidE164Phone, validateContactPhone } from '../../utils/phone';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: 'person-1',
    tenantId: null,
    displayName: 'Example User',
    primaryPhone: null,
    primaryEmail: null,
    avatarUrl: null,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<PlatformIdentity> = {}): PlatformIdentity {
  return {
    id: 'identity-1',
    tenantId: null,
    personId: 'person-1',
    agentId: null,
    channel: 'whatsapp-baileys',
    instanceId: 'instance-A',
    platformUserId: '5512982298888@s.whatsapp.net',
    platformUsername: 'Example User',
    profilePicUrl: null,
    profileData: null,
    messageCount: 0,
    lastSeenAt: null,
    firstSeenAt: new Date(),
    linkedBy: 'auto',
    confidence: 100,
    linkReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

interface MockDbOpts {
  /** First SELECT from platformIdentities — check existing identity */
  existingIdentity?: PlatformIdentity | null;
  /** SELECT from persons WHERE primaryPhone — phone match */
  personByPhone?: Person | null;
  /** Second SELECT from platformIdentities — cross-instance match */
  crossInstanceMatch?: { personId: string } | null;
  /** Person returned by getById after linking */
  linkedPerson?: Person | null;
  /** Person returned by INSERT ... RETURNING (new person creation) */
  createdPerson?: Person | null;
}

function toRows(value: unknown) {
  return value ? [value] : [];
}

function chain(rows: unknown[]) {
  return {
    where: mock(() => ({ limit: mock(() => Promise.resolve(rows)) })),
    orderBy: mock(() => ({ limit: mock(() => Promise.resolve(rows)) })),
    limit: mock(() => Promise.resolve(rows)),
  };
}

function resolveIdentitySelect(opts: MockDbOpts, callIndex: number) {
  if (callIndex === 1) return chain(toRows(opts.existingIdentity));
  return chain(toRows(opts.crossInstanceMatch));
}

function resolvePersonSelect(opts: MockDbOpts, callIndex: number) {
  if (callIndex === 1 && opts.personByPhone) return chain([opts.personByPhone]);
  if (opts.linkedPerson) return chain([opts.linkedPerson]);
  if (opts.createdPerson) return chain([opts.createdPerson]);
  return chain([]);
}

function mockPersonInsert(opts: MockDbOpts) {
  return {
    values: mock(() => ({
      onConflictDoNothing: mock(() => ({
        returning: mock(() => Promise.resolve(toRows(opts.createdPerson))),
      })),
      returning: mock(() => Promise.resolve([])),
    })),
  };
}

function mockIdentityInsert() {
  const buildRows = (data: Record<string, unknown>) => [
    makeIdentity({
      id: `new-identity-${Date.now()}`,
      personId: data.personId as string | undefined,
      channel: data.channel as PlatformIdentity['channel'],
      instanceId: data.instanceId as string,
      platformUserId: data.platformUserId as string,
      platformUsername: data.platformUsername as string | null,
      linkedBy: data.linkedBy as string | null,
      confidence: (data.confidence as number) ?? 100,
      linkReason: data.linkReason as string | null,
    }),
  ];
  return {
    // findOrCreateIdentity secures the identity with onConflictDoNothing (idempotent
    // upsert). The mock models the winning insert: it always returns a row.
    values: mock((data: Record<string, unknown>) => ({
      onConflictDoNothing: mock(() => ({ returning: mock(() => Promise.resolve(buildRows(data))) })),
      returning: mock(() => Promise.resolve(buildRows(data))),
    })),
  };
}

/**
 * Build a mock Drizzle-like DB for PersonService.
 *
 * Uses table-reference comparison to route queries to the right data.
 * Tracks per-table call counts to distinguish first-vs-subsequent selects
 * on the same table (e.g. "check existing identity" vs "cross-instance match").
 */
function createMockDb(opts: MockDbOpts) {
  let identitySelectCount = 0;
  let personSelectCount = 0;

  const db = {
    select: mock((..._args: unknown[]) => ({
      from: mock((table: unknown) => {
        if (table === platformIdentities) return resolveIdentitySelect(opts, ++identitySelectCount);
        if (table === persons) return resolvePersonSelect(opts, ++personSelectCount);
        return chain([]);
      }),
    })),
    insert: mock((table: unknown) => {
      if (table === persons) return mockPersonInsert(opts);
      return mockIdentityInsert();
    }),
    update: mock(() => ({
      set: mock(() => ({
        where: mock(() => ({
          returning: mock(() => Promise.resolve([])),
        })),
      })),
    })),
  };

  // findOrCreateIdentity now secures the identity + defers person creation inside
  // a single transaction. The mock runs the callback against the same handle.
  (db as { transaction?: unknown }).transaction = mock((cb: (tx: unknown) => unknown) => cb(db));

  return db as unknown as Database;
}

function createMockEventBus() {
  return { publish: mock(async () => ({})) } as unknown as EventBus;
}

// ===========================================================================
// Tests
// ===========================================================================

describe('Person deduplication', () => {
  let eventBus: EventBus;

  beforeEach(() => {
    eventBus = createMockEventBus();
  });

  // -------------------------------------------------------------------------
  // Group 1: LID resolved phone linking
  // -------------------------------------------------------------------------

  describe('LID sender with resolvedSenderPhone', () => {
    test('links to existing person matched by phone', async () => {
      const existingPerson = makePerson({
        id: 'person-felipe',
        displayName: 'Example User',
        primaryPhone: '+5512982298888',
      });

      const db = createMockDb({
        existingIdentity: null,
        personByPhone: existingPerson,
        linkedPerson: existingPerson,
      });

      const service = new PersonService(db, eventBus);

      // Simulate what processSenderIdentity does for a LID sender with resolvedSenderPhone:
      // matchByPhone is set to `+${resolvedSenderPhone}` = "+5512982298888"
      const result = await service.findOrCreateIdentity(
        {
          channel: 'whatsapp-baileys',
          instanceId: 'instance-A',
          platformUserId: '54958418317348@lid',
          platformUsername: 'Example User',
        },
        {
          createPerson: true,
          displayName: 'Example User',
          matchByPhone: '+5512982298888', // from resolvedSenderPhone
          matchByPlatformUserId: '54958418317348@lid',
          matchByChannel: 'whatsapp-baileys',
        },
      );

      expect(result.isNew).toBe(true);
      expect(result.wasLinked).toBe(true);
      expect(result.person).not.toBeNull();
      expect(result.person?.id).toBe('person-felipe');
      expect(result.identity.personId).toBe('person-felipe');
    });
  });

  describe('LID sender without resolvedSenderPhone', () => {
    test('creates a new person when no match exists', async () => {
      const newPerson = makePerson({ id: 'person-new', displayName: 'LID User' });

      const db = createMockDb({
        existingIdentity: null,
        crossInstanceMatch: null,
        createdPerson: newPerson,
        linkedPerson: newPerson,
      });

      const service = new PersonService(db, eventBus);

      // Without resolvedSenderPhone, matchByPhone is undefined
      const result = await service.findOrCreateIdentity(
        {
          channel: 'whatsapp-baileys',
          instanceId: 'instance-A',
          platformUserId: '54958418317348@lid',
          platformUsername: 'LID User',
        },
        {
          createPerson: true,
          displayName: 'LID User',
          matchByPhone: undefined, // no resolvedSenderPhone available
          matchByPlatformUserId: '54958418317348@lid',
          matchByChannel: 'whatsapp-baileys',
        },
      );

      expect(result.isNew).toBe(true);
      // No existing person to link to — a new person was created
      expect(result.wasLinked).toBe(false);
      expect(result.person).not.toBeNull();
      expect(result.person?.id).toBe('person-new');
    });
  });

  // -------------------------------------------------------------------------
  // Group 2: Cross-instance person matching
  // -------------------------------------------------------------------------

  describe('Cross-instance same platformUserId', () => {
    test('links to same person across instances', async () => {
      const sharedPerson = makePerson({ id: 'person-shared', displayName: 'Example User' });

      const db = createMockDb({
        existingIdentity: null,
        personByPhone: null,
        crossInstanceMatch: { personId: 'person-shared' },
        linkedPerson: sharedPerson,
      });

      const service = new PersonService(db, eventBus);

      // Instance B receives a message from same platformUserId as instance A
      const result = await service.findOrCreateIdentity(
        {
          channel: 'whatsapp-baileys',
          instanceId: 'instance-B',
          platformUserId: '54958418317348@s.whatsapp.net',
          platformUsername: 'Example User',
        },
        {
          createPerson: true,
          displayName: 'Example User',
          matchByPlatformUserId: '54958418317348@s.whatsapp.net',
          matchByChannel: 'whatsapp-baileys',
        },
      );

      expect(result.isNew).toBe(true);
      expect(result.wasLinked).toBe(true);
      expect(result.person?.id).toBe('person-shared');
      expect(result.identity.personId).toBe('person-shared');
    });
  });

  describe('Different platformUserId', () => {
    test('creates different persons for different users', async () => {
      const personA = makePerson({ id: 'person-A', displayName: 'User A' });
      const personB = makePerson({ id: 'person-B', displayName: 'User B' });

      // First user
      const dbA = createMockDb({
        existingIdentity: null,
        crossInstanceMatch: null,
        createdPerson: personA,
        linkedPerson: personA,
      });

      const serviceA = new PersonService(dbA, eventBus);
      const resultA = await serviceA.findOrCreateIdentity(
        {
          channel: 'whatsapp-baileys',
          instanceId: 'instance-A',
          platformUserId: 'user-111@s.whatsapp.net',
          platformUsername: 'User A',
        },
        {
          createPerson: true,
          displayName: 'User A',
          matchByPlatformUserId: 'user-111@s.whatsapp.net',
          matchByChannel: 'whatsapp-baileys',
        },
      );

      // Second user — separate DB mock with no matches
      const dbB = createMockDb({
        existingIdentity: null,
        crossInstanceMatch: null,
        createdPerson: personB,
        linkedPerson: personB,
      });

      const serviceB = new PersonService(dbB, eventBus);
      const resultB = await serviceB.findOrCreateIdentity(
        {
          channel: 'whatsapp-baileys',
          instanceId: 'instance-A',
          platformUserId: 'user-222@s.whatsapp.net',
          platformUsername: 'User B',
        },
        {
          createPerson: true,
          displayName: 'User B',
          matchByPlatformUserId: 'user-222@s.whatsapp.net',
          matchByChannel: 'whatsapp-baileys',
        },
      );

      // Each got their own new person
      expect(resultA.wasLinked).toBe(false);
      expect(resultB.wasLinked).toBe(false);
      expect(resultA.person?.id).toBe('person-A');
      expect(resultB.person?.id).toBe('person-B');
      expect(resultA.person?.id).not.toBe(resultB.person?.id);
    });
  });

  // -------------------------------------------------------------------------
  // Group 3: Sync worker LID guard (phone validation)
  // -------------------------------------------------------------------------

  describe('Sync worker phone validation', () => {
    test('skips LID-format phone — person created WITHOUT primaryPhone', () => {
      // Contact sync: platformUserId is LID-format, phone matches the LID
      const phone = validateContactPhone('54958418317348', '54958418317348');
      expect(phone).toBeUndefined();

      // Also with + prefix
      const phone2 = validateContactPhone('+54958418317348', '54958418317348');
      expect(phone2).toBeUndefined();

      // Also with @lid suffix on platformUserId
      const phone3 = validateContactPhone('54958418317348', '54958418317348@lid');
      expect(phone3).toBeUndefined();
    });

    test('preserves real phone — person created WITH primaryPhone', () => {
      // Real WhatsApp contact: platformUserId is JID, phone is E.164
      const phone = validateContactPhone('+5512982298888', '5512982298888@s.whatsapp.net');
      expect(phone).toBe('+5512982298888');
    });
  });

  // -------------------------------------------------------------------------
  // Additional coverage: phone utility edge cases
  // -------------------------------------------------------------------------

  describe('Phone utility helpers', () => {
    test('isValidE164Phone accepts valid phones', () => {
      expect(isValidE164Phone('+5512982298888')).toBe(true);
      expect(isValidE164Phone('5512982298888')).toBe(true);
      expect(isValidE164Phone('+1234567')).toBe(true); // 7 digits, minimum
    });

    test('isValidE164Phone rejects invalid phones', () => {
      expect(isValidE164Phone('+123456')).toBe(false); // 6 digits, too short
      expect(isValidE164Phone('+1234567890123456')).toBe(false); // 16 digits, too long
      expect(isValidE164Phone('abc')).toBe(false);
    });

    test('isLidFormat detects LID numbers (14+ digits)', () => {
      expect(isLidFormat('54958418317348')).toBe(true); // 14 digits
      expect(isLidFormat('54958418317348@lid')).toBe(true); // with @lid suffix
      expect(isLidFormat('549584183173481')).toBe(true); // 15 digits
    });

    test('isLidFormat rejects normal phone numbers', () => {
      expect(isLidFormat('5512982298888')).toBe(false); // 13 digits
      expect(isLidFormat('5512982298888@s.whatsapp.net')).toBe(false);
      expect(isLidFormat('abc123')).toBe(false);
    });

    test('validateContactPhone blocks LID-as-phone in various formats', () => {
      // LID platformUserId with phone matching the LID digits
      expect(validateContactPhone('+54958418317348', '54958418317348')).toBeUndefined();
      expect(validateContactPhone('54958418317348', '54958418317348@lid')).toBeUndefined();

      // Real phone where platformUserId is NOT LID-format
      expect(validateContactPhone('+5511999001234', '5511999001234@s.whatsapp.net')).toBe('+5511999001234');

      // No phone provided
      expect(validateContactPhone(undefined, '54958418317348')).toBeUndefined();

      // Invalid phone format
      expect(validateContactPhone('not-a-phone', '5512982298888@s.whatsapp.net')).toBeUndefined();
    });
  });
});
