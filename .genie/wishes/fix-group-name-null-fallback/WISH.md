# fix-group-name-null-fallback

> Add JID-based fallback when group name is null after enrichment.

## GitHub Issue
- **#309** — omni chats list: group name null when not synced from group metadata

## Problem
`ChatService.enrichGroupNames()` looks up group names from `omni_groups` table, but if the group isn't in that table (not yet synced), the chat `name` stays `null`. Users see blank group names in `omni chats list` and API responses.

## Scope
- **In:** Add fallback in `enrichGroupNames()` for groups not found in `omni_groups`
- **Out:** No schema changes, no sync process changes

## Acceptance Criteria
1. After `enrichGroupNames()`, no group/community chat has `name: null`
2. Fallback priority: `omni_groups.name` → `omni_groups.subject` → JID-derived name (e.g., `"Group 5551234…"`) → `"Unknown Group"`
3. Existing named groups are unaffected
4. Unit test covering the fallback chain

## Key Files
| File | Change |
|------|--------|
| `packages/api/src/services/chats.ts:201-218` | Add fallback after `omni_groups` lookup — set remaining nameless chats to JID-derived or "Unknown Group" |

## Execution Groups

### Group 1: Fallback logic + test
| # | Deliverable | File |
|---|-------------|------|
| 1 | After the `nameMap` loop, set remaining nameless group chats to a JID-derived fallback | `packages/api/src/services/chats.ts:212-217` |
| 2 | JID fallback: extract phone from `externalId` (strip `@g.us`), format as `"Group <phone-prefix>…"` | `packages/api/src/services/chats.ts` |
| 3 | Final fallback if JID parsing fails: `"Unknown Group"` | `packages/api/src/services/chats.ts` |
| 4 | Also check `omniGroups.subject` column if `name` is null | `packages/api/src/services/chats.ts:207` |

## Validation
```bash
bun test                    # Full suite passes
bun run build               # Zero errors
bunx biome check .          # Zero lint errors
# Manual: omni chats list should show no null group names
```

## Confidence: 100%
Simple fallback logic in one function. No side effects.
