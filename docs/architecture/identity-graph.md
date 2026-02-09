---
title: "Identity Graph (Omnipresence)"
created: 2025-01-29
updated: 2026-02-09
tags: [architecture, identity, persons]
status: current
---

# Identity Graph (Omnipresence)

> The Identity Graph is the foundation of Omni's omnipresence vision - one unified identity for a person across all messaging platforms.

> Related: [[overview|Architecture Overview]], [[event-system|Event System]]

## The Problem

In v1 and most messaging platforms:
- Each platform has its own user ID
- Same person on WhatsApp and Discord = two separate users
- Can't query "show me all messages from Mom" across channels
- Agent loses context when user switches platforms

## The Solution: Identity Graph

```
                    ┌──────────────────┐
                    │      PERSON      │
                    │   (Unified ID)   │
                    │                  │
                    │  id: uuid        │
                    │  name: "Mom"     │
                    │  email: ...      │
                    └────────┬─────────┘
                             │
          ┌──────────────────┼──────────────────┐
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
│ PLATFORM IDENTITY│ │ PLATFORM IDENTITY│ │ PLATFORM IDENTITY│
│   (WhatsApp)    │ │    (Discord)    │ │     (Slack)     │
│                 │ │                 │ │                 │
│ id: +15551234   │ │ id: 123456789   │ │ id: U0ABC123    │
│ name: Mom       │ │ name: Mom#1234  │ │ name: mom       │
│ instance: wa-1  │ │ instance: dc-1  │ │ instance: sl-1  │
└─────────────────┘ └─────────────────┘ └─────────────────┘
```

## Data Model

### Person (Unified Identity)

```typescript
// packages/core/src/identity/types.ts

/**
 * A Person represents a unified identity across all platforms.
 * One human = one Person, regardless of how many platform accounts they have.
 */
interface Person {
  id: string;                    // UUID - stable forever
  displayName?: string;          // Best known name
  primaryEmail?: string;         // Email if known
  primaryPhone?: string;         // Phone if known
  avatarUrl?: string;            // Best avatar
  metadata: Record<string, any>; // Extensible metadata
  createdAt: Date;
  updatedAt: Date;
}
```

### Platform Identity

```typescript
/**
 * A PlatformIdentity represents one account on one platform.
 * A Person can have many PlatformIdentities.
 */
interface PlatformIdentity {
  id: string;                    // UUID
  personId: string;              // FK to Person

  // Platform identification
  channel: ChannelType;          // 'whatsapp-baileys', 'discord', etc.
  platformUserId: string;        // Platform's native user ID
  platformUsername?: string;     // @handle, display name, etc.

  // Instance scoping (optional)
  instanceId?: string;           // Some identities are instance-specific

  // Profile data from platform
  profileData: {
    name?: string;
    avatar?: string;
    phone?: string;              // WhatsApp
    email?: string;              // Slack
    discriminator?: string;      // Discord
    [key: string]: any;          // Platform-specific
  };

  // Linking metadata
  confidence: number;            // 0.0 - 1.0, how sure are we?
  linkedBy: LinkMethod;          // How was this link established?
  linkedAt: Date;

  // Activity tracking
  lastSeenAt: Date;
  messageCount: number;
  firstMessageAt: Date;

  createdAt: Date;
  updatedAt: Date;
}

type LinkMethod =
  | 'auto_phone'       // Matched by phone number
  | 'auto_email'       // Matched by email
  | 'auto_username'    // Matched by username (lower confidence)
  | 'user_claimed'     // User said "this is me"
  | 'admin_linked'     // Admin manually linked
  | 'initial';         // First identity for this person
```

### Identity Link (Audit Trail)

```typescript
/**
 * Records why two identities were linked.
 * Enables unlinking if a mistake was made.
 */
interface IdentityLink {
  id: string;
  personId: string;
  identityId: string;

  // Link details
  linkType: LinkMethod;
  confidence: number;
  evidence: Record<string, any>;  // What data caused the link?

  // Attribution
  createdAt: Date;
  createdBy?: string;             // Admin ID or 'system'

  // If unlinked
  unlinkedAt?: Date;
  unlinkedBy?: string;
  unlinkReason?: string;
}
```

## Database Schema

```typescript
// packages/core/src/db/schema.ts

import { pgTable, uuid, text, timestamp, decimal, jsonb, index, unique } from 'drizzle-orm/pg-core';

export const persons = pgTable('persons', {
  id: uuid('id').primaryKey().defaultRandom(),
  displayName: text('display_name'),
  primaryEmail: text('primary_email'),
  primaryPhone: text('primary_phone'),
  avatarUrl: text('avatar_url'),
  metadata: jsonb('metadata').default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  emailIdx: index('idx_persons_email').on(table.primaryEmail),
  phoneIdx: index('idx_persons_phone').on(table.primaryPhone),
}));

export const platformIdentities = pgTable('platform_identities', {
  id: uuid('id').primaryKey().defaultRandom(),
  personId: uuid('person_id').references(() => persons.id, { onDelete: 'cascade' }).notNull(),

  channel: text('channel').notNull(),
  platformUserId: text('platform_user_id').notNull(),
  platformUsername: text('platform_username'),
  instanceId: uuid('instance_id').references(() => instances.id),

  profileData: jsonb('profile_data').default({}).notNull(),

  confidence: decimal('confidence', { precision: 3, scale: 2 }).default('1.00').notNull(),
  linkedBy: text('linked_by').default('initial').notNull(),
  linkedAt: timestamp('linked_at').defaultNow().notNull(),

  lastSeenAt: timestamp('last_seen_at'),
  messageCount: integer('message_count').default(0).notNull(),
  firstMessageAt: timestamp('first_message_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Unique identity per channel + platform ID + instance
  uniqueIdentity: unique().on(table.channel, table.platformUserId, table.instanceId),
  // Fast lookups
  personIdx: index('idx_identities_person').on(table.personId),
  lookupIdx: index('idx_identities_lookup').on(table.channel, table.platformUserId),
  lastSeenIdx: index('idx_identities_last_seen').on(table.lastSeenAt),
}));

export const identityLinks = pgTable('identity_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  personId: uuid('person_id').references(() => persons.id, { onDelete: 'cascade' }).notNull(),
  identityId: uuid('identity_id').references(() => platformIdentities.id, { onDelete: 'cascade' }).notNull(),

  linkType: text('link_type').notNull(),
  confidence: decimal('confidence', { precision: 3, scale: 2 }).notNull(),
  evidence: jsonb('evidence').default({}).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  createdBy: text('created_by'),

  unlinkedAt: timestamp('unlinked_at'),
  unlinkedBy: text('unlinked_by'),
  unlinkReason: text('unlink_reason'),
}, (table) => ({
  personIdx: index('idx_links_person').on(table.personId),
  identityIdx: index('idx_links_identity').on(table.identityId),
}));
```

## Identity Service

```typescript
// packages/core/src/identity/service.ts

export class IdentityService {
  constructor(
    private db: Database,
    private eventBus: EventBus,
    private config: IdentityConfig
  ) {}

  /**
   * Resolve identity for an incoming message.
   * This is the main entry point - called on every message.
   */
  async resolveIdentity(params: {
    channel: ChannelType;
    platformUserId: string;
    instanceId?: string;
    profileData?: Record<string, any>;
  }): Promise<IdentityResolution> {
    const { channel, platformUserId, instanceId, profileData } = params;

    // 1. Try to find existing identity
    let identity = await this.findIdentity(channel, platformUserId, instanceId);

    if (identity) {
      // Update profile and activity
      identity = await this.updateIdentity(identity.id, {
        profileData: this.mergeProfileData(identity.profileData, profileData),
        lastSeenAt: new Date(),
        messageCount: sql`${platformIdentities.messageCount} + 1`,
      });

      const person = await this.getPerson(identity.personId);

      return {
        person: person!,
        identity,
        isNewPerson: false,
        isNewIdentity: false,
      };
    }

    // 2. No existing identity - try to find matching person
    const matchResult = await this.findMatchingPerson(params);

    // 3. Create person if needed
    const person = matchResult?.person ?? await this.createPerson({
      displayName: profileData?.name,
      primaryPhone: this.extractPhone(channel, platformUserId, profileData),
      primaryEmail: profileData?.email,
    });

    // 4. Create identity
    identity = await this.createIdentity({
      personId: person.id,
      channel,
      platformUserId,
      instanceId,
      profileData: profileData ?? {},
      confidence: matchResult?.confidence ?? 1.0,
      linkedBy: matchResult?.linkMethod ?? 'initial',
    });

    // 5. Emit event
    await this.eventBus.publish({
      type: 'identity.resolved',
      payload: {
        personId: person.id,
        identityId: identity.id,
        channel,
        platformUserId,
        isNewPerson: !matchResult,
        isNewIdentity: true,
        confidence: identity.confidence,
      },
    });

    return {
      person,
      identity,
      isNewPerson: !matchResult,
      isNewIdentity: true,
    };
  }

  /**
   * Find an existing identity.
   */
  private async findIdentity(
    channel: ChannelType,
    platformUserId: string,
    instanceId?: string
  ): Promise<PlatformIdentity | null> {
    const result = await this.db.query.platformIdentities.findFirst({
      where: and(
        eq(platformIdentities.channel, channel),
        eq(platformIdentities.platformUserId, platformUserId),
        instanceId
          ? eq(platformIdentities.instanceId, instanceId)
          : isNull(platformIdentities.instanceId)
      ),
    });

    return result ?? null;
  }

  /**
   * Try to find an existing person based on shared attributes.
   * This is where cross-channel linking happens.
   */
  private async findMatchingPerson(params: {
    channel: ChannelType;
    platformUserId: string;
    profileData?: Record<string, any>;
  }): Promise<{ person: Person; confidence: number; linkMethod: LinkMethod } | null> {
    const { channel, platformUserId, profileData } = params;

    // Strategy 1: Match by phone number (highest confidence)
    const phone = this.extractPhone(channel, platformUserId, profileData);
    if (phone) {
      // Check if any identity has this phone
      const match = await this.db.query.platformIdentities.findFirst({
        where: or(
          sql`${platformIdentities.profileData}->>'phone' = ${phone}`,
          // WhatsApp uses phone as platformUserId
          and(
            eq(platformIdentities.channel, 'whatsapp-baileys'),
            eq(platformIdentities.platformUserId, phone.replace(/[^0-9]/g, ''))
          ),
          and(
            eq(platformIdentities.channel, 'whatsapp-cloud'),
            eq(platformIdentities.platformUserId, phone.replace(/[^0-9]/g, ''))
          )
        ),
        with: { person: true },
      });

      if (match) {
        await this.recordLinkEvidence(match.personId, 'auto_phone', { phone });
        return {
          person: match.person,
          confidence: 0.95,
          linkMethod: 'auto_phone',
        };
      }

      // Also check Person's primaryPhone
      const personMatch = await this.db.query.persons.findFirst({
        where: eq(persons.primaryPhone, phone),
      });

      if (personMatch) {
        await this.recordLinkEvidence(personMatch.id, 'auto_phone', { phone });
        return {
          person: personMatch,
          confidence: 0.95,
          linkMethod: 'auto_phone',
        };
      }
    }

    // Strategy 2: Match by email (high confidence)
    const email = profileData?.email?.toLowerCase();
    if (email) {
      const match = await this.db.query.platformIdentities.findFirst({
        where: sql`LOWER(${platformIdentities.profileData}->>'email') = ${email}`,
        with: { person: true },
      });

      if (match) {
        await this.recordLinkEvidence(match.personId, 'auto_email', { email });
        return {
          person: match.person,
          confidence: 0.90,
          linkMethod: 'auto_email',
        };
      }

      const personMatch = await this.db.query.persons.findFirst({
        where: eq(persons.primaryEmail, email),
      });

      if (personMatch) {
        await this.recordLinkEvidence(personMatch.id, 'auto_email', { email });
        return {
          person: personMatch,
          confidence: 0.90,
          linkMethod: 'auto_email',
        };
      }
    }

    // Strategy 3: Match by username (lower confidence, configurable)
    if (this.config.enableUsernameMatching && profileData?.name) {
      // Only match if the username is fairly unique
      const username = profileData.name.toLowerCase();
      if (username.length >= 5) {
        const matches = await this.db.query.platformIdentities.findMany({
          where: sql`LOWER(${platformIdentities.platformUsername}) = ${username}`,
          with: { person: true },
        });

        // Only link if exactly one match (avoid ambiguity)
        if (matches.length === 1) {
          await this.recordLinkEvidence(matches[0].personId, 'auto_username', {
            username,
            matchedChannel: matches[0].channel,
          });
          return {
            person: matches[0].person,
            confidence: 0.60,  // Lower confidence
            linkMethod: 'auto_username',
          };
        }
      }
    }

    return null;
  }

  /**
   * Manually link two identities (admin action).
   */
  async linkIdentities(
    identityIdA: string,
    identityIdB: string,
    adminId: string
  ): Promise<Person> {
    const [identityA, identityB] = await Promise.all([
      this.db.query.platformIdentities.findFirst({
        where: eq(platformIdentities.id, identityIdA),
        with: { person: true },
      }),
      this.db.query.platformIdentities.findFirst({
        where: eq(platformIdentities.id, identityIdB),
        with: { person: true },
      }),
    ]);

    if (!identityA || !identityB) {
      throw new Error('One or both identities not found');
    }

    if (identityA.personId === identityB.personId) {
      throw new Error('Identities are already linked to the same person');
    }

    // Decide which person to keep (older one)
    const targetPerson = identityA.person.createdAt < identityB.person.createdAt
      ? identityA.person
      : identityB.person;
    const sourcePerson = targetPerson.id === identityA.personId
      ? identityB.person
      : identityA.person;

    // Move all identities from source to target
    const movedIdentities = await this.db.update(platformIdentities)
      .set({
        personId: targetPerson.id,
        linkedBy: 'admin_linked',
        linkedAt: new Date(),
        confidence: sql`1.0`,
      })
      .where(eq(platformIdentities.personId, sourcePerson.id))
      .returning();

    // Record links
    for (const identity of movedIdentities) {
      await this.db.insert(identityLinks).values({
        personId: targetPerson.id,
        identityId: identity.id,
        linkType: 'admin_linked',
        confidence: 1.0,
        evidence: {
          sourcePersonId: sourcePerson.id,
          linkedWith: identityA.personId === targetPerson.id ? identityIdA : identityIdB,
        },
        createdBy: adminId,
      });
    }

    // Merge person data
    await this.db.update(persons)
      .set({
        displayName: targetPerson.displayName ?? sourcePerson.displayName,
        primaryEmail: targetPerson.primaryEmail ?? sourcePerson.primaryEmail,
        primaryPhone: targetPerson.primaryPhone ?? sourcePerson.primaryPhone,
        metadata: {
          ...sourcePerson.metadata,
          ...targetPerson.metadata,
          mergedFrom: sourcePerson.id,
        },
        updatedAt: new Date(),
      })
      .where(eq(persons.id, targetPerson.id));

    // Delete orphaned person
    await this.db.delete(persons).where(eq(persons.id, sourcePerson.id));

    // Emit event
    await this.eventBus.publish({
      type: 'identity.merged',
      payload: {
        targetPersonId: targetPerson.id,
        sourcePersonId: sourcePerson.id,
        mergedIdentityIds: movedIdentities.map(i => i.id),
        reason: 'admin_linked',
        mergedBy: adminId,
      },
    });

    return await this.getPerson(targetPerson.id);
  }

  /**
   * Unlink an identity from its person, creating a new person for it.
   */
  async unlinkIdentity(
    identityId: string,
    adminId: string,
    reason: string
  ): Promise<{ person: Person; identity: PlatformIdentity }> {
    const identity = await this.db.query.platformIdentities.findFirst({
      where: eq(platformIdentities.id, identityId),
      with: { person: true },
    });

    if (!identity) {
      throw new Error('Identity not found');
    }

    // Check if this is the only identity for the person
    const siblingCount = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(platformIdentities)
      .where(eq(platformIdentities.personId, identity.personId));

    if (siblingCount[0].count === 1) {
      throw new Error('Cannot unlink the only identity of a person');
    }

    // Create new person for this identity
    const newPerson = await this.createPerson({
      displayName: identity.profileData?.name ?? identity.platformUsername,
      primaryPhone: identity.profileData?.phone,
      primaryEmail: identity.profileData?.email,
    });

    // Update identity
    const [updatedIdentity] = await this.db.update(platformIdentities)
      .set({
        personId: newPerson.id,
        linkedBy: 'initial',
        linkedAt: new Date(),
        confidence: sql`1.0`,
      })
      .where(eq(platformIdentities.id, identityId))
      .returning();

    // Record unlink in audit trail
    await this.db.update(identityLinks)
      .set({
        unlinkedAt: new Date(),
        unlinkedBy: adminId,
        unlinkReason: reason,
      })
      .where(eq(identityLinks.identityId, identityId));

    return { person: newPerson, identity: updatedIdentity };
  }

  /**
   * Get a person's presence across all channels.
   */
  async getPersonPresence(personId: string): Promise<PersonPresence> {
    const person = await this.db.query.persons.findFirst({
      where: eq(persons.id, personId),
      with: {
        identities: {
          with: { instance: true },
          orderBy: desc(platformIdentities.lastSeenAt),
        },
      },
    });

    if (!person) {
      throw new Error('Person not found');
    }

    const identities = person.identities;
    const channels = [...new Set(identities.map(i => i.channel))];
    const totalMessages = identities.reduce((sum, i) => sum + i.messageCount, 0);
    const lastSeenAt = identities.length > 0
      ? new Date(Math.max(...identities.map(i => i.lastSeenAt?.getTime() ?? 0)))
      : null;
    const firstSeenAt = identities.length > 0
      ? new Date(Math.min(...identities.filter(i => i.firstMessageAt).map(i => i.firstMessageAt!.getTime())))
      : null;

    return {
      person,
      identities,
      summary: {
        totalIdentities: identities.length,
        activeChannels: channels,
        totalMessages,
        lastSeenAt,
        firstSeenAt,
      },
      byChannel: channels.reduce((acc, channel) => {
        const channelIdentities = identities.filter(i => i.channel === channel);
        acc[channel] = {
          identities: channelIdentities,
          messageCount: channelIdentities.reduce((sum, i) => sum + i.messageCount, 0),
          lastSeenAt: new Date(Math.max(...channelIdentities.map(i => i.lastSeenAt?.getTime() ?? 0))),
        };
        return acc;
      }, {} as Record<string, ChannelPresence>),
    };
  }

  /**
   * Search for persons by name, email, or phone.
   */
  async searchPersons(query: string, options?: SearchOptions): Promise<Person[]> {
    const searchTerm = `%${query.toLowerCase()}%`;

    const results = await this.db.query.persons.findMany({
      where: or(
        ilike(persons.displayName, searchTerm),
        ilike(persons.primaryEmail, searchTerm),
        ilike(persons.primaryPhone, searchTerm),
      ),
      limit: options?.limit ?? 20,
      orderBy: desc(persons.updatedAt),
    });

    return results;
  }

  // Helper methods

  private extractPhone(
    channel: ChannelType,
    platformUserId: string,
    profileData?: Record<string, any>
  ): string | null {
    // WhatsApp uses phone number as user ID
    if (channel.startsWith('whatsapp')) {
      const digits = platformUserId.replace(/[^0-9]/g, '');
      if (digits.length >= 10) {
        return '+' + digits;
      }
    }

    // Check profile data
    if (profileData?.phone) {
      return this.normalizePhone(profileData.phone);
    }

    return null;
  }

  private normalizePhone(phone: string): string {
    // Remove all non-digits except leading +
    let normalized = phone.replace(/[^0-9+]/g, '');

    // Ensure + prefix
    if (!normalized.startsWith('+')) {
      normalized = '+' + normalized;
    }

    return normalized;
  }

  private mergeProfileData(
    existing: Record<string, any>,
    incoming?: Record<string, any>
  ): Record<string, any> {
    if (!incoming) return existing;

    return {
      ...existing,
      ...incoming,
      // Keep arrays merged, not replaced
      ...Object.fromEntries(
        Object.entries(incoming)
          .filter(([_, v]) => Array.isArray(v))
          .map(([k, v]) => [k, [...new Set([...(existing[k] ?? []), ...v])]])
      ),
    };
  }
}
```

## Cross-Channel Timeline API

```typescript
// packages/api/src/routes/identity.ts

// GET /api/v1/persons/:personId/timeline
router.get('/persons/:personId/timeline', async (c) => {
  const personId = c.req.param('personId');
  const query = z.object({
    channels: z.array(z.string()).optional(),
    since: z.string().datetime().optional(),
    until: z.string().datetime().optional(),
    contentTypes: z.array(z.string()).optional(),
    limit: z.coerce.number().min(1).max(200).default(50),
    cursor: z.string().optional(),
  }).parse(c.req.query());

  const db = c.get('db');

  // Build query
  let conditions = [eq(omniEvents.personId, personId)];

  if (query.channels?.length) {
    conditions.push(inArray(omniEvents.channel, query.channels));
  }
  if (query.since) {
    conditions.push(gte(omniEvents.receivedAt, new Date(query.since)));
  }
  if (query.until) {
    conditions.push(lte(omniEvents.receivedAt, new Date(query.until)));
  }
  if (query.contentTypes?.length) {
    conditions.push(inArray(omniEvents.contentType, query.contentTypes));
  }

  const events = await db
    .select({
      event: omniEvents,
      identity: platformIdentities,
    })
    .from(omniEvents)
    .innerJoin(platformIdentities, eq(omniEvents.identityId, platformIdentities.id))
    .where(and(...conditions))
    .orderBy(desc(omniEvents.receivedAt))
    .limit(query.limit);

  return c.json({
    personId,
    events: events.map(({ event, identity }) => ({
      id: event.id,
      type: event.eventType,
      channel: event.channel,
      identity: {
        id: identity.id,
        username: identity.platformUsername,
        avatar: identity.profileData?.avatar,
      },
      content: {
        type: event.contentType,
        text: event.textContent,
        transcription: event.transcription,
        imageDescription: event.imageDescription,
      },
      timestamp: event.receivedAt,
    })),
    cursor: events.length === query.limit
      ? encodeCursor(events[events.length - 1].event)
      : null,
  });
});

// GET /api/v1/persons/:personId/presence
router.get('/persons/:personId/presence', async (c) => {
  const personId = c.req.param('personId');
  const identityService = c.get('identityService');

  const presence = await identityService.getPersonPresence(personId);

  return c.json(presence);
});

// POST /api/v1/persons/search
router.post('/persons/search', async (c) => {
  const body = await c.req.json();
  const { query, limit } = z.object({
    query: z.string().min(2),
    limit: z.number().optional(),
  }).parse(body);

  const identityService = c.get('identityService');
  const results = await identityService.searchPersons(query, { limit });

  return c.json({ results });
});

// POST /api/v1/identities/link
router.post('/identities/link', async (c) => {
  const body = await c.req.json();
  const { identityA, identityB } = z.object({
    identityA: z.string().uuid(),
    identityB: z.string().uuid(),
  }).parse(body);

  const adminId = c.get('userId');  // From auth middleware
  const identityService = c.get('identityService');

  const person = await identityService.linkIdentities(identityA, identityB, adminId);

  return c.json({
    success: true,
    person,
    message: 'Identities linked successfully',
  });
});
```

## UI Integration

The React UI can display a unified conversation view:

```tsx
// Conceptual component for cross-channel conversation
function PersonConversation({ personId }: { personId: string }) {
  const { data: presence } = useQuery(['person-presence', personId], () =>
    api.persons.getPresence(personId)
  );

  const { data: timeline } = useQuery(['person-timeline', personId], () =>
    api.persons.getTimeline(personId, { limit: 100 })
  );

  return (
    <div>
      {/* Person header with all channels */}
      <PersonHeader person={presence?.person} />

      {/* Channel pills showing presence */}
      <div className="flex gap-2">
        {presence?.summary.activeChannels.map(channel => (
          <ChannelBadge
            key={channel}
            channel={channel}
            messageCount={presence.byChannel[channel].messageCount}
          />
        ))}
      </div>

      {/* Unified timeline */}
      <Timeline>
        {timeline?.events.map(event => (
          <TimelineEvent
            key={event.id}
            event={event}
            showChannel  // Shows WhatsApp/Discord/Slack badge
          />
        ))}
      </Timeline>
    </div>
  );
}
```
