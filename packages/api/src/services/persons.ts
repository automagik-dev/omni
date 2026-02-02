/**
 * Person service - manages identity graph
 */

import type { EventBus } from '@omni/core';
import { NotFoundError } from '@omni/core';
import type { ChannelType } from '@omni/core/types';
import type { Database } from '@omni/db';
import {
  type NewPerson,
  type NewPlatformIdentity,
  type Person,
  type PlatformIdentity,
  persons,
  platformIdentities,
} from '@omni/db';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';

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
   * List all persons with pagination
   */
  async list(options: { limit?: number; cursor?: string } = {}): Promise<{
    items: Person[];
    hasMore: boolean;
    cursor?: string;
  }> {
    const { limit = 20, cursor } = options;
    const fetchLimit = limit + 1; // Fetch one extra to check if there's more

    const conditions = [];
    if (cursor) {
      conditions.push(sql`${persons.createdAt} < ${cursor}`);
    }

    const items = await this.db
      .select()
      .from(persons)
      .where(conditions.length ? conditions[0] : undefined)
      .orderBy(desc(persons.createdAt))
      .limit(fetchLimit);

    const hasMore = items.length > limit;
    if (hasMore) {
      items.pop(); // Remove the extra item
    }

    const lastItem = items[items.length - 1];
    return {
      items,
      hasMore,
      cursor: lastItem?.createdAt.toISOString(),
    };
  }

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
   * Get platform identity for a person on a specific channel
   * Returns the most recently active identity if multiple exist (per DEC-2)
   */
  async getIdentityForChannel(personId: string, channel: string): Promise<PlatformIdentity | null> {
    const identities = await this.db.select().from(platformIdentities).where(eq(platformIdentities.personId, personId));

    // Filter by channel type
    const channelIdentities = identities.filter((i) => i.channel === channel);

    if (channelIdentities.length === 0) {
      return null;
    }

    // If multiple identities, return most recently active (per DEC-2)
    if (channelIdentities.length > 1) {
      // Sort by lastSeenAt descending, then by messageCount descending
      return (
        channelIdentities.sort((a, b) => {
          const aLastSeen = a.lastSeenAt?.getTime() ?? 0;
          const bLastSeen = b.lastSeenAt?.getTime() ?? 0;
          if (aLastSeen !== bLastSeen) {
            return bLastSeen - aLastSeen; // More recent first
          }
          return b.messageCount - a.messageCount; // Higher message count first
        })[0] ?? null
      );
    }

    return channelIdentities[0] ?? null;
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
   * Link options for identity creation
   */
  private async findPersonToLink(linkOptions: {
    matchByPhone?: string;
    matchByEmail?: string;
    createPerson?: boolean;
    displayName?: string;
  }): Promise<{ personId?: string; wasLinked: boolean }> {
    // Try matching by phone
    if (linkOptions.matchByPhone) {
      const [matchedPerson] = await this.db
        .select()
        .from(persons)
        .where(eq(persons.primaryPhone, linkOptions.matchByPhone))
        .limit(1);
      if (matchedPerson) {
        return { personId: matchedPerson.id, wasLinked: true };
      }
    }

    // Try matching by email if not matched by phone
    if (linkOptions.matchByEmail) {
      const [matchedPerson] = await this.db
        .select()
        .from(persons)
        .where(eq(persons.primaryEmail, linkOptions.matchByEmail))
        .limit(1);
      if (matchedPerson) {
        return { personId: matchedPerson.id, wasLinked: true };
      }
    }

    // Create a new person if requested and no match found
    if (linkOptions.createPerson) {
      const [newPerson] = await this.db
        .insert(persons)
        .values({
          displayName: linkOptions.displayName,
          primaryPhone: linkOptions.matchByPhone,
          primaryEmail: linkOptions.matchByEmail,
        })
        .returning();
      if (newPerson) {
        return { personId: newPerson.id, wasLinked: false };
      }
    }

    return { wasLinked: false };
  }

  /**
   * Update existing identity and return result
   */
  private async updateExistingIdentity(
    existing: PlatformIdentity,
    data: Omit<NewPlatformIdentity, 'id' | 'personId' | 'createdAt' | 'updatedAt'>,
  ): Promise<{ identity: PlatformIdentity; person: Person | null; isNew: boolean; wasLinked: boolean }> {
    const [updated] = await this.db
      .update(platformIdentities)
      .set({
        platformUsername: data.platformUsername ?? existing.platformUsername,
        profilePicUrl: data.profilePicUrl ?? existing.profilePicUrl,
        profileData: data.profileData ?? existing.profileData,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(platformIdentities.id, existing.id))
      .returning();

    if (!updated) {
      throw new Error('Failed to update identity');
    }

    let person: Person | null = null;
    if (updated.personId) {
      person = await this.getById(updated.personId);
    }

    return { identity: updated, person, isNew: false, wasLinked: false };
  }

  /**
   * Find or create a platform identity.
   * If the identity exists, updates it with new data.
   * If not, creates a new identity and optionally links it to an existing person.
   *
   * @param data - Identity data including channel, instanceId, platformUserId
   * @param linkOptions - Options for automatic linking
   * @returns The created/updated identity and whether it's new
   */
  async findOrCreateIdentity(
    data: Omit<NewPlatformIdentity, 'id' | 'personId' | 'createdAt' | 'updatedAt'> & {
      personId?: string;
    },
    linkOptions?: {
      matchByPhone?: string;
      matchByEmail?: string;
      createPerson?: boolean;
      displayName?: string;
    },
  ): Promise<{ identity: PlatformIdentity; person: Person | null; isNew: boolean; wasLinked: boolean }> {
    const instanceId = data.instanceId;
    if (!instanceId) {
      throw new Error('instanceId is required');
    }

    // Check if identity already exists
    const existing = await this.db
      .select()
      .from(platformIdentities)
      .where(
        and(
          eq(platformIdentities.channel, data.channel),
          eq(platformIdentities.instanceId, instanceId),
          eq(platformIdentities.platformUserId, data.platformUserId),
        ),
      )
      .limit(1);

    if (existing[0]) {
      return this.updateExistingIdentity(existing[0], data);
    }

    // Try to find a person to link to
    let personId: string | undefined = data.personId;
    let wasLinked = false;

    if (!personId && linkOptions) {
      const linkResult = await this.findPersonToLink(linkOptions);
      personId = linkResult.personId;
      wasLinked = linkResult.wasLinked;
    }

    // Create the identity
    const linkedBy = wasLinked ? 'phone_match' : personId ? 'initial' : undefined;
    const linkReason = wasLinked ? `Matched by ${linkOptions?.matchByPhone ? 'phone' : 'email'}` : undefined;

    const [created] = await this.db
      .insert(platformIdentities)
      .values({
        ...data,
        personId,
        linkedBy,
        confidence: wasLinked ? 90 : 100,
        linkReason,
      })
      .returning();

    if (!created) {
      throw new Error('Failed to create identity');
    }

    let person: Person | null = null;
    if (personId) {
      person = await this.getById(personId);
    }

    return { identity: created, person, isNew: true, wasLinked };
  }

  /**
   * Get identity by platform user ID
   */
  async getIdentityByPlatformId(
    channel: ChannelType,
    instanceId: string,
    platformUserId: string,
  ): Promise<PlatformIdentity | null> {
    const [identity] = await this.db
      .select()
      .from(platformIdentities)
      .where(
        and(
          eq(platformIdentities.channel, channel),
          eq(platformIdentities.instanceId, instanceId),
          eq(platformIdentities.platformUserId, platformUserId),
        ),
      )
      .limit(1);

    return identity || null;
  }

  /**
   * Link two identities to the same person
   */
  async linkIdentities(identityAId: string, identityBId: string): Promise<Person> {
    const [identityA, identityB] = await this.fetchIdentityPair(identityAId, identityBId);

    // If both already belong to the same person, nothing to do
    if (identityA.personId && identityA.personId === identityB.personId) {
      return this.getById(identityA.personId);
    }

    const targetPersonId = await this.resolveLinkTarget(identityA, identityB, identityAId, identityBId);
    await this.publishLinkEvents(targetPersonId, identityAId, identityBId);

    return this.getById(targetPersonId);
  }

  /**
   * Fetch a pair of identities and validate they exist
   */
  private async fetchIdentityPair(
    identityAId: string,
    identityBId: string,
  ): Promise<[PlatformIdentity, PlatformIdentity]> {
    const [identityAResult, identityBResult] = await Promise.all([
      this.db.select().from(platformIdentities).where(eq(platformIdentities.id, identityAId)).limit(1),
      this.db.select().from(platformIdentities).where(eq(platformIdentities.id, identityBId)).limit(1),
    ]);

    const identityA = identityAResult[0];
    const identityB = identityBResult[0];

    if (!identityA) throw new NotFoundError('PlatformIdentity', identityAId);
    if (!identityB) throw new NotFoundError('PlatformIdentity', identityBId);

    return [identityA, identityB];
  }

  /**
   * Resolve which person should be the link target and perform the linking
   */
  private async resolveLinkTarget(
    identityA: PlatformIdentity,
    identityB: PlatformIdentity,
    identityAId: string,
    identityBId: string,
  ): Promise<string> {
    const personIdA = identityA.personId;
    const personIdB = identityB.personId;

    // Both have persons - merge B into A
    if (personIdA && personIdB) {
      await this.db
        .update(platformIdentities)
        .set({ personId: personIdA, linkedBy: 'manual', updatedAt: new Date() })
        .where(eq(platformIdentities.personId, personIdB));
      await this.db.delete(persons).where(eq(persons.id, personIdB));
      return personIdA;
    }

    // Only A has a person - link B to A's person
    if (personIdA) {
      await this.db
        .update(platformIdentities)
        .set({ personId: personIdA, linkedBy: 'manual', updatedAt: new Date() })
        .where(eq(platformIdentities.id, identityBId));
      return personIdA;
    }

    // Only B has a person - link A to B's person
    if (personIdB) {
      await this.db
        .update(platformIdentities)
        .set({ personId: personIdB, linkedBy: 'manual', updatedAt: new Date() })
        .where(eq(platformIdentities.id, identityAId));
      return personIdB;
    }

    // Neither has a person - create one
    const [newPerson] = await this.db.insert(persons).values({}).returning();
    if (!newPerson) throw new Error('Failed to create person');

    await this.db
      .update(platformIdentities)
      .set({ personId: newPerson.id, linkedBy: 'manual', updatedAt: new Date() })
      .where(or(eq(platformIdentities.id, identityAId), eq(platformIdentities.id, identityBId)));

    return newPerson.id;
  }

  /**
   * Publish identity.linked events for both identities
   */
  private async publishLinkEvents(targetPersonId: string, identityAId: string, identityBId: string): Promise<void> {
    if (!this.eventBus) return;

    const [linkedIdentityA, linkedIdentityB] = await Promise.all([
      this.db.select().from(platformIdentities).where(eq(platformIdentities.id, identityAId)).limit(1),
      this.db.select().from(platformIdentities).where(eq(platformIdentities.id, identityBId)).limit(1),
    ]);

    const publishForIdentity = async (identity: PlatformIdentity | undefined, identityId: string) => {
      if (!identity) return;
      await this.eventBus?.publish('identity.linked', {
        personId: targetPersonId,
        platformIdentityId: identityId,
        channelType: identity.channel,
        platformUserId: identity.platformUserId,
        linkedBy: 'manual',
        confidence: 100,
      });
    };

    await Promise.all([
      publishForIdentity(linkedIdentityA[0], identityAId),
      publishForIdentity(linkedIdentityB[0], identityBId),
    ]);
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
