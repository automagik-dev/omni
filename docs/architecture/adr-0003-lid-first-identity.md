<!-- adr_topic: lid_first_identity -->
---
title: "ADR-0003 — LID-first + phone-as-bridge, multi-signal identity"
created: 2026-08-14
updated: 2026-08-14
tags: [architecture, identity, persons, whatsapp, lid]
status: proposed
---

# ADR-0003 — LID-first + phone-as-bridge, multi-signal identity

> Reworks how inbound events are resolved to a `person` so that a single human
> is one `person` regardless of which native handle (WhatsApp `@lid`,
> `@s.whatsapp.net`, Meta Cloud `wa_id`, Discord snowflake, …) a given event
> carries — without ever minting a phone-less duplicate or bleeding identities
> across tenants.

> Related: [[identity-graph|Identity Graph (Omnipresence)]], ADR-0002
> (person / platform-identity split), ADR-0008 (async-storage cache context /
> G5 tenant scoping).

> **ADR numbering note.** The `omni-full-multitenancy` wish maintains its own
> `ADR-000N` series under `brain/wishes/.../adrs/` (currently through ADR-0010).
> This is the first ADR to live under `docs/architecture/`, where `0003` is
> free. The number here is local to `docs/architecture/`; where this doc says
> "ADR-0002" / "ADR-0008" it means the multitenancy-wish ADRs of those numbers.

---

## 1. Status / Context

**Status:** proposed.

### Why now

1. **WhatsApp went LID-first.** Baileys now routinely addresses senders by
   `@lid` (Linked Device ID) instead of `@s.whatsapp.net`. The channel layer
   already embraced this: `resolveChatId` / `resolveCanonicalJid` keep `@lid`
   as the canonical chat id and no longer down-convert to phone
   (`packages/channel-whatsapp/src/handlers/messages.ts:853-885`). The identity
   layer did **not** follow — it still keys on the raw handle and treats phone
   as the only unifier — so the same human now fragments into multiple persons.
2. **The hub needs identity certainty.** Cross-channel timelines, access rules,
   agent routing, and per-person memory all assume "one human = one `person`".
   Every duplicate or phone-less orphan degrades all of them at once.
3. **Multi-tenancy is landing.** ADR-0002 makes `persons` tenant-owned and
   forbids cross-tenant merges; the current global phone-unique index actively
   contradicts that direction and must be reconciled as part of this rework.

### The domain model today

- **`persons`** (`packages/db/src/schema.ts:1188-1212`) — one row per human:
  `id`, `displayName`, `primaryPhone` (E.164), `primaryEmail`, `metadata`,
  nullable `tenantId`. A **global** unique index `persons_phone_idx` on
  `primaryPhone` with **no tenant predicate** (`:1208`) is the current
  cross-tenant hazard; the tenant-scoped partial unique
  `persons_tenant_phone_uq` (`:1205-1207`) is inert because `tenant_id` is NULL
  everywhere in the additive phase.
- **`platform_identities`** (`:1224-1271`) — a person's presence on one
  channel/instance: nullable `personId` (XOR with `agentId`, enforced by
  `platform_identities_actor_xor` `:1269`), `channel`, `instanceId`,
  `platformUserId` (the **raw** native handle — JID / `@lid` / `wa_id`),
  `platformUsername`, `linkedBy`, `confidence` (0-100), `linkReason`. The
  natural key is `platform_identities_channel_user_idx` unique on
  `(channel, instanceId, platformUserId)` (`:1264-1268`) — i.e. keyed on the
  **raw handle per instance**.
- **`chat_id_mappings`** (`:2164-2186`) — WhatsApp `@lid` ↔ `@s.whatsapp.net`
  map, unique on `(instanceId, lidId)` (`:2183`), plus a non-unique index on
  `(instanceId, phoneId)` (`:2184`).

### Inbound resolution today

`message.received` →
`processSenderIdentity` (`packages/api/src/plugins/message-persistence.ts:354`)
→ `PersonService.findOrCreateIdentity` (`packages/api/src/services/persons.ts:429`).

- Phone extraction: `extractPhoneFromSender` (`message-persistence.ts:327-340`)
  returns `undefined` for any non-`whatsapp*` channel and for anything that is
  not 7-15 bare digits.
- LID senders are detected via `addressingMode === 'lid'` or
  `senderIsLid === true`, and the phone (if any) is read from
  `rawPayload.resolvedSenderPhone` (`message-persistence.ts:376-382`), which the
  channel populated from `remoteJidAlt` / `participantAlt` / the in-memory LID
  cache (`messages.ts:924-943`).
- `findOrCreateIdentity` first SELECTs the identity by the raw natural key
  (`persons.ts:448-458`); on miss it calls `findPersonToLink`
  (`persons.ts:300-351`) — phone → email → cross-instance
  `(channel, platformUserId)` — else INSERTs a fresh identity **and** (via
  `createPersonWithConflictHandling`, `persons.ts:357-387`) a fresh person.

### Verified defects this ADR must solve

| # | Defect | Evidence |
|---|--------|----------|
| **D1** | **LID→PN split.** Identity is keyed on the raw `platformUserId`, so the same contact seen first as `@lid` then as `@s.whatsapp.net` becomes **two** identities, unified only if both independently resolve to the same `primaryPhone`. When phone can't be resolved, a **new phone-less person is minted**. | `persons.ts:448-458` (raw-key SELECT), `persons.ts:472-479` (best-effort `resolvePhoneFromLid`), `persons.ts:357-387`, `persons.ts:491-500` (unconditional person+identity INSERT). Encoded as *expected* in `packages/api/src/plugins/__tests__/person-dedup.test.ts:229-265`. |
| **D2** | **Cross-channel only via phone; non-WhatsApp never links.** `extractPhoneFromSender` bails for non-`whatsapp*` channels (`message-persistence.ts:328`), and the cross-instance matcher requires the **same** channel (`persons.ts:328-345`). Two channels only ever unify through `persons.primaryPhone`. | `message-persistence.ts:327-340`, `persons.ts:328-345` |
| **D3** | **Race on lookup-or-create → orphans / null FKs.** The identity INSERT has **no** `onConflictDoNothing/Update` on its natural key (`persons.ts:491-500`); the person is created before the identity is secured. Concurrent first-contact events for the same sender race to create duplicate persons and identities. | `persons.ts:357-387` (person insert with `onConflictDoNothing` only on the phone unique), `persons.ts:491-500` (bare identity insert) |
| **D4** | **Cross-tenant identity bleed.** `persons_phone_idx` is a **global** phone unique with no tenant predicate; lookups (`findPersonByPhone`, `persons.ts:292-295`) are not tenant-scoped. ADR-0002 flags the tenant-owned `persons` direction as still "proposed (G0)". | `schema.ts:1208`, `persons.ts:292-295`; ADR-0002 §Decision |
| **D5** | **Missing audit + lossy merge.** The `identity_links` table and `identity.resolved` event specified in `identity-graph.md:123-221` were never built. `linkIdentities` / `resolveLinkTarget` (`persons.ts:643-695`) and `mergePersons` (`persons.ts:785-824`) **delete the source person** (`persons.ts:658`, `:815`) **without coalescing** its `primaryPhone` / `primaryEmail` / `displayName` / `metadata`. | `persons.ts:643-695`, `persons.ts:785-824` |
| **D6** | **Handle key-fragmentation (normalization defect, independent of LID).** The same number is keyed BOTH as bare digits and as `<n>@s.whatsapp.net` (and device-suffixed `:NN`) in the same instance, producing distinct `platform_identities` rows → distinct persons. `platformUserId` is stored raw with no canonicalisation before keying. | `persons.ts:448-458` (raw-key SELECT), `message-persistence.ts:371` (`platformUserId = truncate(payload.from, 255)`) |

### Per-message LID↔PN persistence — what the code actually does (correction)

An earlier draft of this ADR claimed per-message LID↔PN persistence "does not
happen today". **That was wrong.** There are **two independent** persistence
paths, and the live data (below) shows the message-driven one is the *only* one
firing:

1. **Message-driven (active).** `message-persistence.persistLidMappings`
   (`message-persistence.ts:526-573`) and `resolveOrCreateChat`
   (`message-persistence.ts:723-753`) call
   `ChatService.upsertLidMapping` (`packages/api/src/services/chats.ts:582-595`),
   which upserts into `chat_id_mappings` with **`discoveredFrom: 'message_key'`**
   and `onConflictDoUpdate` on `(instanceId, lidId)`. It fires on any inbound
   whose chat is `@lid` with a `resolvedPhoneJid` (or legacy `originalLidJid`) in
   `rawPayload`. This survives restart.
2. **Contacts-sync / in-memory (dormant here).** The channel plugin's
   `storeLidMapping` (`plugin.ts:489-498`) writes only an **in-memory** cache;
   it reaches the DB only when `publishLidMappings` (`plugin.ts:3718-3734`, called
   from the contacts-sync path `plugin.ts:3682`) emits a batch that the listener
   persists with `discoveredFrom: 'contacts_sync'`
   (`event-listeners.ts:183-213`).

**The real residual gaps** (what P3 must actually address) are narrower than
"add persistence": (a) path 1 is **chat-scoped** — it keys the mapping on the
*chat* JID, so a **group-participant** LID→PN reveal (chat is `@g.us`, not `@lid`)
is **not** persisted by it; (b) the *sender-identity* resolver
(`processSenderIdentity`) only **reads** `chat_id_mappings` via
`resolvePhoneFromLid` (`persons.ts:280-287`) and never writes the
sender-level `resolvedSenderPhone`; and (c) the code must be confirmed to run on
the `dev` codebase (the remote may run a newer build).

### Live evidence (a production omni instance, read-only, 2026-08-15)

Snapshot: **3743** `persons`, **3561** `platform_identities`, **~177k**
`messages`. The numbers below are what sharpen the phasing — they turn the
qualitative defects into ranked, measured work.

| Metric | Value | Implication |
|---|---|---|
| **Phone-less persons** | **2194 / 3743 (59%)** | A phone-less person is the *norm*, not an edge case. The model MUST treat a LID-/handle-only person as first-class (principle 3) rather than an anomaly to eliminate. |
| **LID↔PN reveal density** | **279 / 307 LID identities (91%)** have a persisted `chat_id_mappings` row | The bridge phone is *usually recoverable* — enrichment (§4a) will converge most LID-only persons. High-value, low-risk. |
| **Persistence provenance** | **281 / 281 mappings** learned via `discovered_from='message_key'`; **0** via `contacts_sync` | Confirms the correction above: the message-driven path (path 1) is the live one; the contacts-sync path is dormant. P3 = *confirm/repair* path 1 on `dev`, not build a new one. |
| **Confirmed splits (D1)** | **94** LID identities whose revealed phone belongs to a **different** person already holding that phone (~**32%** split rate of the 296 resolvable LIDs; 202 correctly same-person, 22 phone→no person) | ~1 in 3 resolvable LIDs is a live duplicate today. This is the primary backfill payload for P6. |
| **Trivially backfillable now** | **60** phone-less persons already have a known phone via an existing mapping | Concrete first backfill target in P6 — enrich in place with zero ambiguity before any merge logic runs. |
| **Key-fragmentation (D6)** | **1164** cases: same number stored BOTH as bare digits AND `<n>@s.whatsapp.net` in the same instance | A *larger* duplicate source than LID/PN, and independent of it. Warrants an explicit early normalization phase (P0). |

---

## 2. Decision

Adopt a **LID-first + phone-as-bridge, multi-signal** identity model.

### 2.1 Principles

1. **Anchor on the most stable native handle per channel.** For WhatsApp
   Baileys the anchor is the **LID**; for WhatsApp Business / Meta Cloud it is
   the opaque **BSUID `user_id`** (Meta's stable non-phone id, live since
   ~Apr 2026), with `wa_id`/phone treated as **optional** — `msg.from` today
   carries the `wa_id` (`packages/channel-whatsapp-business/src/plugin.ts:632,
   644-645`), but WhatsApp Usernames now let users hide the phone, so `wa_id`
   can be **absent** from webhooks. Never re-key an identity when a *less*
   stable handle later appears for the same human.
2. **Key asymmetry, and phone is not guaranteed.** The LID is the durable
   anchor **within** Baileys; the **phone is the cross-channel bridge** — the
   only signal that links Baileys ↔ Meta ↔ Twilio ↔ other channels. Both are
   first-class signals; **neither is the sole canonical key**. Crucially, the
   bridge phone **may never appear** (username-hidden Meta contacts, LID-only
   Baileys contacts), so **cross-channel unification is best-effort, not
   guaranteed**. Do NOT architect anything that *requires* a single global
   person-key spanning channels.
2a. **PN is opportunistic enrichment; never hard-depend on it.** A person is
   valid with zero phone. Phone is attached when volunteered/revealed and used
   to *bridge and enrich*, never as a precondition for creating, routing, or
   resolving an identity.
3. **A LID-only person is valid.** When its phone is later revealed (via
   `chat_id_mappings` / `remoteJidAlt` / `participantAlt`) we **enrich** the
   existing person, never **fork** a second one. This is the explicit reversal
   of D1 / `person-dedup.test.ts:229`.
4. **Persist the LID↔PN mapping authoritatively** the moment WhatsApp reveals
   it (per message), not only on contacts sync, and not only in memory.
5. **Links are typed signals with confidence + provenance** recorded in a real
   `identity_links` audit table, so every person↔identity attachment is
   explainable and reversible.
6. **Merge is monotonic + reversible** — coalesce fields (never silently drop a
   phone/email/name), pick a deterministic survivor (oldest `person`), keep a
   full audit, emit an event.
7. **Tenant scoping is respected** so identities never bleed across tenants
   (align with ADR-0002).
8. **Anchors can rotate; reconcile, don't fork.** A WhatsApp LID is
   global-per-account and stable across chats/groups, **but** re-registration /
   number-change is community-reported to mint a **new** LID (not officially
   documented), and the PN behind it is often unrecoverable. Likewise a Meta
   **BSUID regenerates on number change** and is emitted via a *number-change
   system webhook*. The design therefore keeps an **anchor history** and a
   **reconciliation fallback**: when a new anchor's later-revealed phone (+ a
   corroborating `pushName`/profile) matches an existing person, **re-link** the
   rotated anchor to that person rather than stranding a duplicate. Rotation is
   an expected event, handled by enrichment + merge (§4a/§4b), never by forking.

### 2.2 Per-channel anchor matrix (verified against channel code)

Each row was verified by reading the channel's inbound sender extraction (the
`from` it emits into `message.received`). The *anchor* is the identity's natural
key **within its channel/instance**; the *bridge* is what may attach that
identity to a `person` already known on **another** channel.

| Channel | Native stable anchor (emitted `from`) | Opaque / stable? | Scope | Phone available? | Cross-channel bridge |
|---|---|---|---|---|---|
| `whatsapp-baileys` | **LID** `<id>@lid` when LID-addressed; else phone JID `<n>@s.whatsapp.net` (`channel-whatsapp/src/handlers/messages.ts:984-989`) | opaque; stable per-account, **rotates on re-register** | per-account, resolved per-instance | opportunistic (LID↔PN map, `remoteJidAlt`/`participantAlt`) | **phone** |
| `whatsapp-business` (Meta Cloud) | **`user_id` (BSUID)**, `wa_id` optional; today `msg.from` = `wa_id` (`channel-whatsapp-business/src/plugin.ts:632, 644-645`) | opaque; **regenerates on number change**; BSUID ≠ Baileys LID | **per business portfolio** | often — but **can be hidden** (WhatsApp Usernames) | **phone** (when present) |
| `hermes` (Cloud-style BSP) | `msg.from` = `wa_id` (`channel-hermes/src/plugin.ts:428, 440-441`) | phone-derived, stable | per-instance | yes (`wa_id`) | **phone** |
| `twilio-whatsapp` | `normalizeTwilioWhatsAppAddress(params.From)` → `whatsapp:+E164` (`channel-twilio-whatsapp/src/handlers/webhooks.ts:169-192`, `utils/identity.ts:8-29`) | phone-derived, stable | per-instance | yes (E.164, `whatsapp:`-prefixed — a **normalization concern**, see below) | **phone** |
| `gupshup` | inbound `sender`/`from` = phone (`channel-gupshup/src/handlers/webhooks.ts:34, 64`; `utils/identity.ts` `toGupshupPhone`) | phone-derived, stable | per-instance | yes | **phone** |
| `telegram` | numeric **user_id** `String(from.id)` (`channel-telegram/src/handlers/messages.ts:117-121`, `utils/identity.ts:12-14`) | opaque numeric; **global & stable** | global | rarely (only if contact shared) | email/username (weak) |
| `discord` | **snowflake** `msg.author.id` (`channel-discord/src/plugin.ts:1169`, `1232`) | opaque; **global & stable** | global | no | email / explicit claim |
| `slack` | **user_id** `U…` (`channel-slack/src/plugin.ts:1046, 1691`) paired with **team_id** (`connection.teamId`, `plugin.ts:827`) | opaque; stable | **per team/workspace** | no | email (via `users.info`, `plugin.ts:838-868`) |
| `a2a` | `executionContext.identity.userId` else `a2a:<contextId>` (`channel-a2a/src/a2a-handler.ts:211-216`) | agent/service subject | per context | no | — (system/agent, usually NOT a human) |
| `internal` | `from = sourceInstanceId` (`channel-internal/src/plugin.ts:88-93`) | **an instance id, not a person** | per-instance | no | — (system routing; should NOT mint a human person) |

**Implication.** The LID/PN fragmentation problem is **WhatsApp-specific**:
non-WhatsApp channels (Telegram, Discord, Slack) already emit **strong, stable,
opaque native anchors**, so they need normalization/idempotency (D3/D6) but not
LID reconciliation. The **WhatsApp family** — baileys, business, hermes, twilio,
gupshup — shares **phone as its internal bridge**, which is what lets a human be
one person across those five. **Cross-family** unification (WhatsApp ↔
Telegram/Discord/Slack) only works when the human **volunteers** phone or email,
and must degrade gracefully to "separate persons" when they don't (principle 2).
Two anchors are **not human identities at all**: `internal` keys on a *source
instance id* and `a2a` on an *agent/service subject* — both must be excluded
from the person graph (route to `agentId`, not `personId`, consistent with the
existing `platform_identities_actor_xor` guard, `schema.ts:1269`).

**Normalization note (feeds D6/P0).** `twilio-whatsapp` emits the phone
**with** a `whatsapp:` prefix and `whatsapp-baileys` emits it **with** an
`@s.whatsapp.net` suffix or **bare**; `extractPhoneFromSender`
(`message-persistence.ts:328`) only matches `channel.startsWith('whatsapp')`, so
`twilio-whatsapp` never phone-matches today either. A single canonicalizer
(strip `whatsapp:` / JID suffix / device `:NN`, normalize to E.164) must run
**before** keying, across the whole WhatsApp family.

### 2.3 Signal taxonomy (with confidence semantics)

Every attachment of an identity to a person is one **link signal**. `confidence`
stays on the existing 0-100 integer scale (matching
`platform_identities.confidence`).

| Signal (`link_type`) | Meaning | Confidence | Reversible |
|---|---|---|---|
| `initial` | First identity for a brand-new person; nothing to match against. | 100 | n/a |
| `lid_match` | Same LID anchor already present for this channel/instance. | 100 | no (same handle) |
| `verified_phone_match` | Bridged to an existing person by a **trusted** phone (E.164, not LID-shaped) — Meta `wa_id`, or a Baileys LID whose PN is confirmed via `chat_id_mappings` / `remoteJidAlt`. | 95 | yes |
| `pn_alt_reveal` | A LID-only identity's phone was later revealed; person enriched, not forked. | 95 | yes |
| `same_pn_cross_instance` | Same phone-based handle seen on a **different instance** of the **same** channel. | 90 | yes |
| `email_match` | Bridged to an existing person by shared verified email (Slack/Discord). | 90 | yes |
| `manual` | Operator linked/merged explicitly. | 100 | yes |
| `username_match` *(future, off by default)* | Weak match on unique-ish username; never auto-merges. | ≤60 | yes |

Confidence gates behaviour: **≥90 may auto-attach**; **<90 is advisory** (record
the signal, do not auto-merge). `verified_phone_match` requires the phone to
pass `isValidE164Phone` **and not** `isLidFormat` (`packages/api/src/utils/phone.ts`)
— this is what stops a LID-shaped 14-digit number from ever acting as a bridge.

---

## 3. Target data model (Drizzle deltas)

All schema edits land **with** their generated migration in the same commit
(AGENTS.md; `.claude/CLAUDE.md` §Database). The latest migration is
`packages/db/drizzle/0051_message_pin_star.sql`; the first new file here is
`0052_identity_links.sql` (generate with `bunx drizzle-kit generate`, **never**
`drizzle-kit push`). No already-deployed migration is edited.

### 3.1 `platform_identities` — add a stable *anchor* concept, keep the raw handle

Keep `platformUserId` as the **raw** handle exactly as received (unchanged
natural key, so no existing row moves). Add an explicit anchor so resolution no
longer conflates "the handle on this event" with "the stable key for this
human on this channel".

```ts
// packages/db/src/schema.ts — platformIdentities additions
anchorType: varchar('anchor_type', { length: 20 }).$type<
  'lid' | 'phone' | 'wa_id' | 'bsuid' | 'snowflake' | 'slack_uid' | 'tg_uid' | 'other'
>(),                                    // which kind of handle anchors this identity
anchorId: varchar('anchor_id', { length: 255 }),   // the stable anchor value (e.g. "<id>@lid", BSUID)
phoneE164: varchar('phone_e164', { length: 50 }),  // bridge phone once known/verified (nullable)
phoneVerified: boolean('phone_verified').notNull().default(false),
// anchor rotation history: prior LIDs / prior BSUIDs for this identity so a
// rotated anchor (re-register, number change) reconciles instead of forking.
priorAnchors: jsonb('prior_anchors').$type<{ type: string; id: string; retiredAt: string }[]>(),
```

`bsuid` covers the Meta Cloud opaque `user_id`; because a BSUID **regenerates on
number change**, the *number-change system webhook* migrates `anchor_id`
old→new and appends the old value to `priorAnchors` (§4, `onNumberChange`), so
history is preserved and lookups by the retired BSUID still resolve. The same
`priorAnchors` array holds a Baileys LID retired by re-registration.

New indexes (added in the `(table) => ({...})` block):

```ts
// stable per-channel/instance anchor — the NEW resolution key
anchorIdx: uniqueIndex('platform_identities_anchor_idx')
  .on(table.channel, table.instanceId, table.anchorType, table.anchorId)
  .where(sql`${table.anchorId} IS NOT NULL`),
// fast phone bridge lookups within a channel
phoneIdx: index('platform_identities_phone_idx').on(table.channel, table.phoneE164),
```

The existing `platform_identities_channel_user_idx` on
`(channel, instanceId, platformUserId)` (`schema.ts:1264-1268`) **stays** and
remains the idempotency target for the raw-handle upsert (§4). `anchorId`
defaults to `platformUserId` at backfill so a legacy row's anchor is well-defined
even before the resolver runs (§5).

### 3.2 New table `identity_links` (audit / provenance)

Realises `identity-graph.md:202-221`, adapted to real column names and the
0-100 confidence scale.

```ts
export const identityLinks = pgTable(
  'identity_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    personId: uuid('person_id')
      .notNull()
      .references(() => persons.id, { onDelete: 'cascade' }),
    platformIdentityId: uuid('platform_identity_id')
      .notNull()
      .references(() => platformIdentities.id, { onDelete: 'cascade' }),
    linkType: varchar('link_type', { length: 40 }).notNull(),   // §2.3 taxonomy
    confidence: integer('confidence').notNull().default(100),   // 0-100
    evidence: jsonb('evidence').$type<Record<string, unknown>>(), // matched phone/email/lid, source event id
    createdBy: varchar('created_by', { length: 100 }),          // 'system' | operator id
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // reversal
    unlinkedAt: timestamp('unlinked_at', { withTimezone: true }),
    unlinkedBy: varchar('unlinked_by', { length: 100 }),
    unlinkReason: text('unlink_reason'),
    // G2 additive tenant ownership, mirroring persons/platform_identities
    tenantId: uuid('tenant_id').references((): AnyPgColumn => tenants.id, { onDelete: 'restrict' }),
  },
  (table) => ({
    tenantIdx: index('identity_links_tenant_idx').on(table.tenantId),
    personIdx: index('identity_links_person_idx').on(table.personId),
    identityIdx: index('identity_links_identity_idx').on(table.platformIdentityId),
    // one live link per (person, identity, type); reversal sets unlinkedAt, not delete
    liveLinkUq: uniqueIndex('identity_links_live_uq')
      .on(table.personId, table.platformIdentityId, table.linkType)
      .where(sql`${table.unlinkedAt} IS NULL`),
  }),
);
```

**DDL shape (illustrative — the real SQL is drizzle-generated):**

```sql
CREATE TABLE identity_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES persons(id) ON DELETE CASCADE,
  platform_identity_id uuid NOT NULL REFERENCES platform_identities(id) ON DELETE CASCADE,
  link_type varchar(40) NOT NULL,
  confidence integer NOT NULL DEFAULT 100,
  evidence jsonb,
  created_by varchar(100),
  created_at timestamptz NOT NULL DEFAULT now(),
  unlinked_at timestamptz,
  unlinked_by varchar(100),
  unlink_reason text,
  tenant_id uuid REFERENCES tenants(id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX identity_links_live_uq
  ON identity_links (person_id, platform_identity_id, link_type)
  WHERE unlinked_at IS NULL;
```

### 3.3 `persons` — no structural change; retire the global phone unique later

`persons` needs no new columns. The change is to **stop treating
`persons_phone_idx` (`schema.ts:1208`) as the identity key** and, once
`persons.tenant_id` is backfilled non-null (ADR-0002 / G6), **drop the global
`persons_phone_idx`** in favour of the already-present tenant-scoped
`persons_tenant_phone_uq` (`schema.ts:1205-1207`). Dropping it earlier would
remove the only guard against duplicate phones while `tenant_id` is still NULL,
so this is sequenced into the phased plan (Phase 5), not the first migration.

### 3.4 `chat_id_mappings` — already authoritative for DMs; close the residual gaps

No column change. **Contrary to this ADR's first draft, per-message persistence
already works**: `ChatService.upsertLidMapping` (`chats.ts:582-595`) upserts with
`discoveredFrom: 'message_key'` and `onConflictDoUpdate` on `(instanceId, lidId)`,
driven from `message-persistence.persistLidMappings` (`message-persistence.ts:526-573`)
and `resolveOrCreateChat` (`message-persistence.ts:723-753`). Live data confirms
this is the *only* active path (281/281 mappings are `message_key`, §Live evidence).

The Phase 3 work is therefore **confirm + repair**, not "add":
1. Verify the `message_key` path is present and firing on the **`dev`** codebase
   (the remote may run a newer build).
2. Close the **group-participant** gap: the current path keys on the *chat* JID,
   so a participant LID→PN revealed inside a `@g.us` chat is not persisted. Have
   the sender resolver persist `resolvedSenderPhone` (`messages.ts:924-943`) via
   `upsertLidMapping` keyed on the **sender** LID.
3. Keep the dormant contacts-sync path as a secondary source; do not rely on it.

`chat_id_mappings` thus stays the durable source of truth for LID↔PN, and
`PersonService.resolvePhoneFromLid` (`persons.ts:280-287`) — already reliable for
DMs — becomes reliable for group senders too.

---

## 4. Resolution algorithm (new inbound path)

Replaces `findOrCreateIdentity` (`persons.ts:429-512`) +
`findPersonToLink` (`persons.ts:300-351`). Runs inside the sender's own tenant
work-item scope exactly as today (`resolveSenderIdentityForWorkItem`,
`message-persistence.ts:442-465`; ADR-0008 / G5).

```
resolveIdentity(evt):                       # evt: {channel, instanceId, rawHandle, addressingMode,
                                            #        senderIsLid, resolvedSenderPhone, name, email, tenantId}

  # ── 0. Pick the anchor for this channel (never re-key on a less-stable handle)
  (anchorType, anchorId) = selectAnchor(evt)                     # §2.2 matrix
      #   baileys   → ('lid', <id>@lid) if LID-addressed, else ('phone', E164)
      #   business  → ('bsuid', user_id) if present, else ('wa_id', E164)
      #   hermes/twilio/gupshup → ('phone', canonicalE164(from))    # strip whatsapp:/@suffix/:NN  (D6)
      #   telegram  → ('tg_uid', id)  discord → ('snowflake', id)  slack → ('slack_uid', team_id:user_id)
      #   internal/a2a → NOT a human: route to agentId, skip the person graph entirely
  rawHandle = canonicalize(evt.rawHandle, evt.channel)          # normalize suffix/prefix/device before keying (D6)
  phone = trustedPhone(evt)                                      # E.164 & !isLidFormat, else null   (D4/D2 guard)

  # ── 1. Idempotent identity upsert on the RAW natural key (fixes D3 race)
  identity = INSERT platform_identities
               (channel, instanceId, platformUserId=rawHandle,
                anchorType, anchorId, phoneE164=phone, username=name, ...)
             ON CONFLICT (channel, instanceId, platform_user_id)          # existing unique :1264-1268
             DO UPDATE SET last_seen_at=now(),
                           anchor_type=COALESCE(excluded.anchor_type, anchor_type),
                           anchor_id  =COALESCE(excluded.anchor_id,  anchor_id),
                           phone_e164 =COALESCE(platform_identities.phone_e164, excluded.phone_e164),
                           username   =COALESCE(excluded.username, platform_identities.username)
             RETURNING *                                          # exactly one row, no orphan window

  if identity.personId is not null:
      # already attached; opportunistically back-reconcile a newly-revealed phone (§4a)
      maybeEnrichPhone(identity, phone); return identity.personId

  # ── 2. No person yet → find one to bridge to (multi-signal, tenant-scoped)  (D2)
  candidate =
        findPersonByAnchorSibling(identity)          # another identity, same channel+anchor, different instance
     ?? (phone && findPersonByTrustedPhone(phone, evt.tenantId))     # verified_phone_match / same_pn_cross_instance
     ?? (phone && findPersonByLidMap(evt))           # LID → chat_id_mappings → phone → person   (pn_alt_reveal)
     ?? (evt.email && findPersonByEmail(evt.email, evt.tenantId))    # email_match (non-WhatsApp bridge)  (D2)

  # ── 3. Attach — DO NOT MINT A PHONE-LESS DUPLICATE  (replaces D1 behaviour)
  if candidate:
      person = candidate.person; signal = candidate.signal          # confidence ≥ 90
  else:
      # No bridge. A LID-only (or handle-only) person is VALID and first-class.
      person = INSERT persons (tenantId=evt.tenantId,
                               primaryPhone = phone,   # null is fine; NOT a fake LID phone
                               displayName = name)
               ON CONFLICT (tenant_id, primary_phone) WHERE ...  DO NOTHING   # tenant-scoped, race-safe
               ?? reselect                                        # lost race → use the winner
      signal = phone ? verified_phone_match : initial

  UPDATE platform_identities SET person_id = person.id,
                                 linked_by = signal.linkedBy,
                                 confidence = signal.confidence
        WHERE id = identity.id AND person_id IS NULL              # guard: don't stomp a concurrent attach
  INSERT identity_links (person, identity, link_type=signal, confidence, evidence, createdBy='system')
  publish 'identity.resolved' { personId, identityId, channel, signal, confidence, isNewPerson }
  return person.id
```

### 4a. LID→PN enrichment / back-reconcile (the anti-fork core)

When a message reveals a phone for an identity that is already attached to a
LID-only person:

```
maybeEnrichPhone(identity, phone):
  if phone is null or not trusted: return
  persist LID↔PN to chat_id_mappings immediately (§3.4)
  UPDATE platform_identities SET phone_e164 = phone, phone_verified = true WHERE id = identity.id
  person = identity.person
  if person.primaryPhone is null:
      # enrich — the LID-only person now gains its bridge phone
      UPDATE persons SET primaryPhone = phone WHERE id = person.id
             ON CONFLICT (tenant_id, primary_phone) → mergePersons(person, owner_of_that_phone)  # §4b, monotonic
      INSERT identity_links (person, identity, 'pn_alt_reveal', 95, {phone})
  elif person.primaryPhone == phone:
      no-op
  else:
      # two different trusted phones on one person → flag for review, do not auto-split
      record identity_links evidence {conflict: true}; emit 'identity.review_needed'
```

This is the concrete replacement for "mint a phone-less person and hope a later
phone unifies it": the phone-less person is created **once** (`signal=initial`)
and later **enriched in place**, never duplicated.

### 4b. Merge (monotonic + reversible) — replaces `resolveLinkTarget` / `mergePersons`

```
mergePersons(a, b):
  survivor = older(a.createdAt, b.createdAt); loser = the other       # deterministic
  if survivor.tenantId != loser.tenantId: ABORT  ("cross-tenant merge forbidden", ADR-0002)
  survivor.primaryPhone ||= loser.primaryPhone                        # COALESCE — never drop (fixes D5)
  survivor.primaryEmail ||= loser.primaryEmail
  survivor.displayName  ||= loser.displayName
  survivor.metadata      = deepMerge(loser.metadata, survivor.metadata, {mergedFrom: loser.id})
  reassign every FK (platform_identities, chat_participants, messages, omni_events,
                     agent_routes*, access_rules, identity_links) loser → survivor   # generalise fix-person-duplicates.ts:73-126
  INSERT identity_links rows recording the merge provenance
  DELETE loser
  publish 'identity.merged' { survivorId, loserId, coalesced:{...} }
```

\* `agent_routes` has a `(instanceId, personId)` unique — reuse the
conflict-delete handling already in `fix-person-duplicates.ts:97-119`.

### 4c. Anchor rotation & Meta number-change (reconcile, don't fork)

Anchors are not immortal (principle 8): a Baileys re-registration mints a new
LID, and a Meta number change regenerates the BSUID and fires a *number-change
system webhook*. Both are handled the same way — **migrate the anchor and keep
history**, never create a second person:

```
onNumberChange(evt):    # Meta system webhook: {oldBsuid?, newBsuid, oldWaId?, newWaId?}  (business channel)
  id = findIdentityByAnchor(channel, instanceId, 'bsuid', evt.oldBsuid)
       ?? findIdentityByPhone(channel, evt.oldWaId)
  if id:
     append {type:'bsuid', id: id.anchorId, retiredAt: now} to id.priorAnchors
     UPDATE id SET anchorId = evt.newBsuid, phoneE164 = canonicalE164(evt.newWaId) or keep
     INSERT identity_links (id.person, id, 'manual'/'system_number_change', 100, {old:evt.oldBsuid})
  # no match → falls through to normal resolveIdentity on next inbound

# Rotated LID with no system signal: reconciled opportunistically when the new
# LID's phone is later revealed and matches an existing person (+corroborating
# pushName) — that is exactly maybeEnrichPhone → mergePersons (§4a/§4b).
```

`selectAnchor` and `findIdentityByAnchor` also consult `priorAnchors`, so a late
event still carrying a *retired* anchor resolves to the same identity/person.

### 4d. What each defect's fix looks like here

- **D1** → step 3 never mints a second person; §4a enriches. Flip
  `person-dedup.test.ts:229`.
- **D2** → step 2 adds `email_match` and phone-bridge for non-WhatsApp; anchor
  siblings link cross-instance without requiring phone.
- **D3** → step 1 upserts on the natural key (`onConflictDoUpdate`) and defers
  person creation until the identity row is secured; the person INSERT is
  `onConflictDoNothing` on the tenant-scoped phone unique.
- **D4** → `trustedPhone` rejects LID-shaped numbers; all person lookups carry
  `evt.tenantId`; merges refuse across tenants.
- **D5** → `identity_links` audit + coalescing merge.
- **D6** → step 0 `canonicalize(rawHandle)` runs before keying, so bare-digit and
  suffixed/prefixed forms of one number collapse to a single natural-key row.

---

## 5. Migration & backfill

Generalise `packages/api/scripts/fix-person-duplicates.ts` into an **online,
idempotent reconciler** (`reconcile-identities.ts`) with `--dry-run`, safe to
run repeatedly while the API serves traffic. Ordering matters:

1. **Schema migration `0052_identity_links.sql`** — create `identity_links`; add
   `anchor_type` / `anchor_id` / `phone_e164` / `phone_verified` to
   `platform_identities`; add the new indexes. Additive only; no data moves.
   (`bunx drizzle-kit generate`, commit SQL + schema together.)
2. **Normalize + collapse key-fragmentation (D6, ~1164 cases) FIRST.**
   Canonicalize `platform_user_id` (strip `whatsapp:` prefix / JID suffix /
   device `:NN`) and merge the bare-digits vs `<n>@s.whatsapp.net` twins in the
   same instance via `mergePersons` (oldest survivor). This is the single
   largest measured duplicate source and is unambiguous — do it before any
   LID/PN logic so later steps operate on de-fragmented rows.
3. **Backfill anchors** — `anchor_id = canonical(platform_user_id)`,
   `anchor_type = classify(platform_user_id)` for every existing identity
   (idempotent `UPDATE ... WHERE anchor_id IS NULL`). Backfill
   `phone_e164` from `persons.primary_phone` where the identity is the person's
   phone-bearing one and the value passes `isValidE164Phone && !isLidFormat`.
4. **Enrich the 60 trivially-backfillable phone-less persons.** For each
   phone-less person whose LID identity already has a `chat_id_mappings` row,
   set `persons.primary_phone` in place (§4a `maybeEnrichPhone`). Zero
   ambiguity, zero merges — the concrete first win, run before any merge step.
5. **Clear fake LID phones** — reuse `isFakeLidPhone` /
   `fix-person-duplicates.ts:130-206`: null out `persons.primary_phone` that is
   actually a LID; where a real-phone twin exists, `mergePersons` (§4b) instead
   of clearing.
6. **Collapse LID↔PN splits (D1 backfill, ~94 confirmed).** For each
   `chat_id_mappings` row, find the LID identity and the PN identity in the same
   instance; if they point at different persons (the 94 measured cases),
   `mergePersons` (oldest survivor), recording `pn_alt_reveal` evidence.
7. **Collapse cross-instance duplicates** — reuse
   `mergeCrossInstanceDuplicates` (`fix-person-duplicates.ts:210-294`) but route
   through the coalescing `mergePersons` and write `identity_links`.
8. **Delete true orphans** — persons with zero identities **and** zero
   `chat_participants` (`fix-person-duplicates.ts:298-341`), unchanged.
9. **Seed `identity_links`** — one `initial` (or best-known) link per surviving
   `(person, identity)` so the audit table is complete post-backfill.

Safety: every step is idempotent and re-runnable; merges are logged with
survivor/loser ids so they can be audited (and, via `identity_links` reversal,
unwound). **No deployed migration file is edited** — reconciliation is a script
+ the one additive `0052` migration, per AGENTS.md.

---

## 6. Phased rollout plan

| Phase | Scope | Files | Migration | Tests | Rollback |
|---|---|---|---|---|---|
| **P0 — Canonicalize the handle before keying (D6, biggest measured source)** | One shared canonicalizer for the WhatsApp family (strip `whatsapp:` / `@s.whatsapp.net` / `@lid` device `:NN`, normalize E.164). Apply at the resolver so bare-vs-suffixed twins stop being created; extend `extractPhoneFromSender` to `twilio-whatsapp`/`gupshup`/`hermes`. | `message-persistence.ts:327-340, 371`, `persons.ts:448-458`, reuse `packages/api/src/utils/phone.ts` | **No** | Bare==suffixed→one identity; `whatsapp:+E` normalizes. | Pure code revert. |
| **P1 — Idempotent upsert (race fix, D3)** | Change the identity INSERT to `onConflictDoUpdate` on `(channel, instanceId, platformUserId)`; guard the person-attach `UPDATE ... WHERE person_id IS NULL`. | `packages/api/src/services/persons.ts:429-512` | **No** | New concurrency test (§7 T1). | Pure code revert; no schema change. |
| **P2 — Stop minting phone-less duplicates (D1, part 1)** | Rework step 3 so a no-bridge event yields one `initial` person; add `maybeEnrichPhone` in-place update. Flip `person-dedup.test.ts:229`. | `persons.ts` (`findOrCreateIdentity`, new `maybeEnrichPhone`), `message-persistence.ts:376-393` | No | Flip T dedup:229; add LID-then-PN test (§7 T2). | Code revert; behaviour returns to fork. |
| **P3 — Confirm/repair per-message LID↔PN persistence (D1, part 2)** | **Not "add persistence" — it exists** (`chats.upsertLidMapping`, `discoveredFrom='message_key'`). Confirm it runs on `dev`; close the **group-participant** gap by persisting sender-level `resolvedSenderPhone` keyed on the sender LID. | `message-persistence.ts:526-573, 723-753`, `chats.ts:582-595`, `channel-whatsapp/src/handlers/messages.ts:924-943` | No | Group-participant reveal persists; mapping-survives-restart; `resolvePhoneFromLid` hit test. | Code revert; DM persistence still stands. |
| **P4 — `identity_links` + anchors + coalescing merge (D5)** | Add `identity_links` + anchor/`priorAnchors` columns; rewrite `linkIdentities`/`mergePersons` to coalesce + audit; emit `identity.resolved`/`identity.merged`. | `packages/db/src/schema.ts`, `0052_identity_links.sql`, `persons.ts:605-824`, event defs in `packages/core/src/events/` | **Yes (0052)** | Merge-coalesces-fields test (§7); audit-row assertions. | Additive migration is safe to leave; code revert restores old merge. |
| **P5 — Cross-channel matcher, BSUID/rotation, tenant-scoped uniques (D2, D4)** | Add `email_match` + phone-bridge for non-WhatsApp; business anchor = BSUID `user_id` with `wa_id` optional; handle the number-change webhook (`onNumberChange`, §4c); make all person lookups tenant-scoped; after ADR-0002/G6, drop global `persons_phone_idx` for `persons_tenant_phone_uq`. | `persons.ts:292-351`, `channel-whatsapp-business/src/plugin.ts:603-645`, `schema.ts:1205-1208`, migration `0053_drop_global_phone_unique.sql` | **Yes (0053, gated on G6)** | WhatsApp↔Meta-same-phone; cross-tenant stay-separate; BSUID number-change migrates not forks (§7 T3/T4/T7). | Dropping the global unique is the one hard-to-reverse step — gate strictly behind non-null `tenant_id`; keep `persons_tenant_phone_uq` live first. |
| **P6 — Backfill / reconcile** | Ship `reconcile-identities.ts`. **First live target: the 60 phone-less persons with a known mapping (trivial enrich), then the 94 confirmed LID↔PN splits.** Run `--dry-run` then live. | `packages/api/scripts/reconcile-identities.ts` (from `fix-person-duplicates.ts`) | No (data script) | Reconciler unit tests on a disposable DB. | Idempotent; merges audited via `identity_links`. |

**Effort / risk (rough):** P0 S/low (highest value-per-effort — ~1164 dupes) ·
P1 S/low · P2 M/med (behaviour change + test flip) · P3 S/low (verify + narrow
repair) · P4 L/med (schema + merge rewrite + events) · P5 M/high (tenant-unique
drop is the sharp edge, G6-gated; BSUID adds surface) · P6 M/med (runs against
real data; first 60+94 targets are well-understood).

Sequencing rationale: **P0 first** — normalization is code-only, reversible, and
removes the single largest measured duplicate class before anything else runs on
the rows. P1-P3 stay code-only and reversible; P4 adds durable audit; P5 is last
because it touches the tenant-unique invariant and depends on ADR-0002/G6.

---

## 7. Test strategy

Adversarial cases that must exist and currently don't (add under
`packages/api/src/plugins/__tests__/` and a real-Postgres integration suite;
use a disposable DB per AGENTS.md):

- **T1 — Concurrency first-contact → one person.** Fire N concurrent
  `resolveIdentity` calls for the *same* new sender (same channel/instance/raw
  handle). Assert exactly **one** `persons` row and **one** `platform_identities`
  row, no null-FK identity, no orphan person. (Directly exercises the D3 fix;
  needs a real DB to exercise the unique conflict.)
- **T2 — LID-then-PN same human → one person.** Event A: `@lid` sender, no
  phone → `initial` phone-less person. Event B: same human as
  `<pn>@s.whatsapp.net` **or** LID + `resolvedSenderPhone` → assert the **same**
  `personId`, `primaryPhone` now populated, a `pn_alt_reveal` link recorded, and
  **no** second person. **This flips `person-dedup.test.ts:229-265`**, whose
  current assertion (`wasLinked=false`, a brand-new person) is the codified D1
  bug.
- **T3 — WhatsApp ↔ Meta same phone → one person.** `whatsapp-baileys` LID
  identity with verified PN `+E`, then `whatsapp-business` `wa_id == E`. Assert
  one person spanning both identities, linked by `verified_phone_match`.
- **T4 — Cross-tenant same phone → separate persons.** Same E.164 phone arriving
  under tenant X and tenant Y. Assert **two** persons, no bridge, merge refused.
  (Guards D4 / ADR-0002.)
- **T5 — Merge coalesces, never drops.** Merge a person that has only a phone
  into one that has only a name+email. Assert survivor keeps phone **and** name
  **and** email, an `identity.merged` event fires, and `identity_links` records
  the provenance. (Guards D5.)
- **T6 — Trusted-phone guard.** A 14-digit LID-shaped number must never act as a
  bridge (`trustedPhone` returns null); re-assert the existing
  `validateContactPhone` / `isLidFormat` cases still hold
  (`person-dedup.test.ts:373-438`).
- **T7 — Anchor rotation migrates, never forks.** (a) Meta number-change webhook:
  BSUID `A`→`B` for an existing identity asserts the same `personId`, `anchor_id=B`,
  and `A` recorded in `priorAnchors`. (b) A late event still carrying retired
  anchor `A` resolves to the same identity. (c) Baileys re-register: new LID whose
  later-revealed phone matches an existing person re-links (merge), not forks.
- **T8 — Handle normalization (D6).** Same number as bare digits, as
  `<n>@s.whatsapp.net`, and as `whatsapp:+E` (twilio) all resolve to **one**
  identity/person within an instance.
- **T9 — Best-effort cross-family degradation.** A Meta contact with a hidden
  phone (`wa_id` absent, BSUID only) and a Baileys LID-only contact do **not**
  merge with anything until phone/email is volunteered — assert they remain
  separate valid persons rather than being force-linked.

---

## 8. Open questions / risks

1. **`remoteJidAlt` / `participantAlt` real-world frequency — measured HIGH, but
   watch groups.** Live data shows 91% of LID identities already carry a
   persisted mapping (§Live evidence), so the anti-fork story is on solid ground
   for DMs. The residual unknown is the **group-participant** reveal rate, which
   the chat-scoped persistence path misses today (P3). Confirm via telemetry
   after P3.
2. **LID rotation is real (community-reported, undocumented).** WhatsApp LID is
   global-per-account and stable across chats/groups, **but** re-registration /
   number-change appears to mint a **new** LID, and the PN behind a fresh LID is
   often unrecoverable (first seen via a call or in a group). The design assumes
   rotation and reconciles via phone+`pushName` (§4c, principle 8); the open item
   is confirming the trigger conditions with a live repro so `onNumberChange` and
   the LID-reconcile heuristic are tuned to reality, not folklore.
3. **Meta BSUID / phone-hiding — premise-shifting, already folded in.** Meta
   shipped **BSUID (`user_id`)**, a stable opaque non-phone id (live ~Apr 2026),
   but it is **per-business-portfolio** scoped (does **not** equal the Baileys
   LID) and **regenerates on number change**; and WhatsApp Usernames let users
   **hide** the phone so `wa_id` can be absent. Consequences the team must accept:
   the business anchor is BSUID with phone optional (§2.1, §2.2), cross-channel
   unification is **best-effort not guaranteed** (a hidden-phone Meta contact may
   never join its Baileys twin), and we must NOT build anything requiring a single
   global person-key. Open: verify the exact number-change webhook shape/field
   names against Meta's current API before implementing `onNumberChange`.
4. **Tenant assignment timing (ADR-0008/G6).** `persons.tenant_id` is NULL
   through the additive phase, and `processSenderIdentity` already degrades to
   "persist without identity FKs" under RLS when a person can't be created in a
   tenant scope (`message-persistence.ts:442-465`). P5's drop of the global
   phone unique **must** wait for G6 to backfill `tenant_id` non-null; running
   it early removes the only duplicate-phone guard. This is a hard cross-wish
   dependency, not just an ordering preference.
5. **Group-participant LIDs.** In `@g.us` chats the chat is not `@lid` but
   individual participants can be (`messages.ts:1008-1012`). Anchor selection
   must key on the **sender** handle, not the chat handle — verify no code path
   accidentally anchors a person on a group JID.
6. **Confidence threshold policy.** The ≥90 auto-attach cutoff and the
   review-needed behaviour on conflicting phones (§4a) are product calls: do we
   auto-merge on `email_match` (90), or hold it for review? Needs a decision
   before P5.

---

## Preserves

- `identity-graph.md` original intent: `identity_links` audit table and
  `identity.resolved` event (`identity-graph.md:123-221, 289-309`).
- ADR-0002 direction: tenant-owned `persons`, cross-tenant merge forbidden,
  tenant-scoped uniqueness.
- ADR-0008 / G5 work-item scoping already implemented in
  `resolveSenderIdentityForWorkItem`.
