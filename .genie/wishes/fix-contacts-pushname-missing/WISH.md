# fix-contacts-pushname-missing

> Include pushName/display name in contacts listing output.

## GitHub Issue
- **#307** — omni instances contacts: pushName/display name missing from output

## Problem
`omni instances contacts` shows `?` or `-` for all contact names. The API endpoint (`GET /instances/:id/contacts`) maps `contact.name` to `displayName`, but `fetchContacts()` in the WhatsApp plugin returns contacts from `contactsCache` which may not have names populated. Meanwhile, `platform_identities.platform_username` has the pushName from Baileys `contacts.upsert` events.

The API has a fallback path (lines 1443-1459) that queries `platform_identities`, but it only triggers when `fetchContacts()` returns zero results — not when it returns results with missing names.

## Scope
- **In:** Enrich contact names from `platform_identities` when `fetchContacts()` returns contacts without names
- **Out:** No CLI changes needed (CLI already displays `displayName` from API response)

## Acceptance Criteria
1. Contacts returned by `GET /instances/:id/contacts` have `displayName` populated from `platform_identities.platform_username` when the plugin's contact cache has no name
2. The WhatsApp plugin's `contactsCache` stores `pushName` when available from Baileys events
3. Existing contacts with names are unaffected
4. Fallback chain: `contact.name` → `platformIdentity.platformUsername` → phone number → JID

## Key Files
| File | Change |
|------|--------|
| `packages/api/src/routes/v2/instances.ts:1404-1441` | After getting contacts from plugin, enrich missing names from `platform_identities` |
| `packages/channel-whatsapp/src/plugin.ts:2078-2091` | Verify `contactsCache` stores `pushName` from Baileys `contacts.upsert` — check the `name` field mapping |

## Execution Groups

### Group 1: Investigate contact cache (read-only)
| # | Deliverable | File |
|---|-------------|------|
| 1 | Trace how Baileys `contacts.upsert` populates `contactsCache` — is `pushName`/`notify` mapped to `name`? | `packages/channel-whatsapp/src/plugin.ts` (search `contacts.upsert` handler) |
| 2 | If `name` mapping is missing, add it from `contact.notify` or `contact.name` | `packages/channel-whatsapp/src/plugin.ts` |

### Group 2: API-side name enrichment
| # | Deliverable | File |
|---|-------------|------|
| 1 | After `fetchContacts()` returns, find contacts with no `name` | `packages/api/src/routes/v2/instances.ts:1404` |
| 2 | Query `platform_identities` for those JIDs to get `platformUsername` | `packages/api/src/routes/v2/instances.ts` |
| 3 | Merge: `displayName = contact.name ?? identity.platformUsername ?? phone ?? jid` | `packages/api/src/routes/v2/instances.ts:1425-1428` |

## Validation
```bash
bun test                    # Full suite passes
bun run build               # Zero errors
bunx biome check .          # Zero lint errors
# Manual: omni instances contacts <id> — names should show pushName instead of ?/-
```

## Confidence: 100%
Data exists in DB (`platform_identities.platform_username`). Just needs to be merged into the API response.
