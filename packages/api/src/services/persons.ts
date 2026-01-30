/**
 * Person service - manages identity graph
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { Database } from '@omni/db';
import { type NewPerson, type Person, type PlatformIdentity, persons, platformIdentities } from '@omni/db';
import { eq, ilike, or } from 'drizzle-orm';

export interface PersonWithIdentities extends Person {
  identities: PlatformIdentity[];
}

export interface PersonPresence {
  person: Person;
  identities: PlatformIdentity[];
  summary: {
    totalIdentities: number;
    activeChannels: string[];
    totalMessages: number;
    lastSeenAt: Date | null;
    firstSeenAt: Date | null;
  };
}

export class PersonService {
  constructor(
    private db: Database,
    private eventBus: EventBus | null,
  ) {}

  /**
   * Search persons by name, email, or phone
   */
  async search(query: string, limit = 20): Promise<Person[]> {
    const searchPattern = `%${query}%`;

    return this.db
      .select()
      .from(persons)
      .where(
        or(
          ilike(persons.displayName, searchPattern),
          ilike(persons.primaryEmail, searchPattern),
          ilike(persons.primaryPhone, searchPattern),
        ),
      )
      .limit(limit);
  }

  /**
   * Get person by ID
   */
  async getById(id: string): Promise<Person> {
    const [result] = await this.db.select().from(persons).where(eq(persons.id, id)).limit(1);

    if (!result) {
      throw new NotFoundError('Person', id);
    }

    return result;
  }

  /**
   * Get person with all identities
   */
  async getWithIdentities(id: string): Promise<PersonWithIdentities> {
    const person = await this.getById(id);

    const identities = await this.db.select().from(platformIdentities).where(eq(platformIdentities.personId, id));

    return { ...person, identities };
  }

  /**
   * Get person presence (cross-channel summary)
   */
  async getPresence(id: string): Promise<PersonPresence> {
    const person = await this.getById(id);

    const identities = await this.db.select().from(platformIdentities).where(eq(platformIdentities.personId, id));

    const channels = [...new Set(identities.map((i) => i.channel))];
    const totalMessages = identities.reduce((sum, i) => sum + i.messageCount, 0);
    const lastSeenDates = identities.map((i) => i.lastSeenAt).filter(Boolean) as Date[];
    const firstSeenDates = identities.map((i) => i.firstSeenAt).filter(Boolean) as Date[];

    return {
      person,
      identities,
      summary: {
        totalIdentities: identities.length,
        activeChannels: channels,
        totalMessages,
        lastSeenAt: lastSeenDates.length ? new Date(Math.max(...lastSeenDates.map((d) => d.getTime()))) : null,
        firstSeenAt: firstSeenDates.length ? new Date(Math.min(...firstSeenDates.map((d) => d.getTime()))) : null,
      },
    };
  }

  /**
   * Create a new person
   */
  async create(data: NewPerson): Promise<Person> {
    const [created] = await this.db.insert(persons).values(data).returning();

    if (!created) {
      throw new Error('Failed to create person');
    }

    return created;
  }

  /**
   * Update a person
   */
  async update(id: string, data: Partial<NewPerson>): Promise<Person> {
    const [updated] = await this.db
      .update(persons)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(persons.id, id))
      .returning();

    if (!updated) {
      throw new NotFoundError('Person', id);
    }

    return updated;
  }

  /**
   * Link two identities to the same person
   */
  async linkIdentities(identityAId: string, identityBId: string): Promise<Person> {
    // Get both identities
    const [identityAResult, identityBResult] = await Promise.all([
      this.db.select().from(platformIdentities).where(eq(platformIdentities.id, identityAId)).limit(1),
      this.db.select().from(platformIdentities).where(eq(platformIdentities.id, identityBId)).limit(1),
    ]);

    const identityA = identityAResult[0];
    const identityB = identityBResult[0];

    if (!identityA) {
      throw new NotFoundError('PlatformIdentity', identityAId);
    }
    if (!identityB) {
      throw new NotFoundError('PlatformIdentity', identityBId);
    }

    const personIdA = identityA.personId;
    const personIdB = identityB.personId;

    // If both already belong to the same person, nothing to do
    if (personIdA && personIdA === personIdB) {
      return this.getById(personIdA);
    }

    // Determine which person to keep (prefer one with more data)
    let targetPersonId: string;

    if (personIdA && personIdB) {
      // Merge: move all identities from B's person to A's person
      await this.db
        .update(platformIdentities)
        .set({ personId: personIdA, linkedBy: 'manual', updatedAt: new Date() })
        .where(eq(platformIdentities.personId, personIdB));

      // Delete the orphaned person
      await this.db.delete(persons).where(eq(persons.id, personIdB));

      targetPersonId = personIdA;
    } else if (personIdA) {
      // Link identity B to A's person
      await this.db
        .update(platformIdentities)
        .set({ personId: personIdA, linkedBy: 'manual', updatedAt: new Date() })
        .where(eq(platformIdentities.id, identityBId));

      targetPersonId = personIdA;
    } else if (personIdB) {
      // Link identity A to B's person
      await this.db
        .update(platformIdentities)
        .set({ personId: personIdB, linkedBy: 'manual', updatedAt: new Date() })
        .where(eq(platformIdentities.id, identityAId));

      targetPersonId = personIdB;
    } else {
      // Neither has a person - create one
      const [newPerson] = await this.db.insert(persons).values({}).returning();

      if (!newPerson) {
        throw new Error('Failed to create person');
      }

      await this.db
        .update(platformIdentities)
        .set({ personId: newPerson.id, linkedBy: 'manual', updatedAt: new Date() })
        .where(or(eq(platformIdentities.id, identityAId), eq(platformIdentities.id, identityBId)));

      targetPersonId = newPerson.id;
    }

    if (this.eventBus) {
      // Get the identity details for proper event payloads
      const [linkedIdentityA, linkedIdentityB] = await Promise.all([
        this.db.select().from(platformIdentities).where(eq(platformIdentities.id, identityAId)).limit(1),
        this.db.select().from(platformIdentities).where(eq(platformIdentities.id, identityBId)).limit(1),
      ]);

      if (linkedIdentityA[0]) {
        await this.eventBus.publish('identity.linked', {
          personId: targetPersonId,
          platformIdentityId: identityAId,
          channelType: linkedIdentityA[0].channel,
          platformUserId: linkedIdentityA[0].platformUserId,
          linkedBy: 'manual',
          confidence: 100,
        });
      }

      if (linkedIdentityB[0]) {
        await this.eventBus.publish('identity.linked', {
          personId: targetPersonId,
          platformIdentityId: identityBId,
          channelType: linkedIdentityB[0].channel,
          platformUserId: linkedIdentityB[0].platformUserId,
          linkedBy: 'manual',
          confidence: 100,
        });
      }
    }

    return this.getById(targetPersonId);
  }

  /**
   * Unlink an identity from its person
   */
  async unlinkIdentity(identityId: string, reason: string): Promise<{ person: Person; identity: PlatformIdentity }> {
    const [identityResult] = await this.db
      .select()
      .from(platformIdentities)
      .where(eq(platformIdentities.id, identityId))
      .limit(1);

    if (!identityResult) {
      throw new NotFoundError('PlatformIdentity', identityId);
    }

    if (!identityResult.personId) {
      throw new Error('Identity is not linked to any person');
    }

    // Create a new person for this identity
    const [newPerson] = await this.db.insert(persons).values({}).returning();

    if (!newPerson) {
      throw new Error('Failed to create person');
    }

    // Update the identity
    const [updatedIdentity] = await this.db
      .update(platformIdentities)
      .set({
        personId: newPerson.id,
        linkedBy: 'manual',
        linkReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(platformIdentities.id, identityId))
      .returning();

    if (!updatedIdentity) {
      throw new Error('Failed to update identity');
    }

    if (this.eventBus) {
      await this.eventBus.publish('identity.unlinked', {
        personId: identityResult.personId,
        platformIdentityId: identityId,
        reason,
      });
    }

    return { person: newPerson, identity: updatedIdentity };
  }

  /**
   * Merge two persons
   */
  async mergePersons(
    sourcePersonId: string,
    targetPersonId: string,
    reason?: string,
  ): Promise<{ person: Person; mergedIdentityIds: string[]; deletedPersonId: string }> {
    // Get identities from source person
    const sourceIdentities = await this.db
      .select()
      .from(platformIdentities)
      .where(eq(platformIdentities.personId, sourcePersonId));

    if (!sourceIdentities.length) {
      throw new NotFoundError('Person', sourcePersonId);
    }

    const identityIds = sourceIdentities.map((i) => i.id);

    // Move all identities to target person
    await this.db
      .update(platformIdentities)
      .set({
        personId: targetPersonId,
        linkedBy: 'manual',
        linkReason: reason ?? 'Person merge',
        updatedAt: new Date(),
      })
      .where(eq(platformIdentities.personId, sourcePersonId));

    // Delete source person
    await this.db.delete(persons).where(eq(persons.id, sourcePersonId));

    const person = await this.getById(targetPersonId);

    return {
      person,
      mergedIdentityIds: identityIds,
      deletedPersonId: sourcePersonId,
    };
  }
}
