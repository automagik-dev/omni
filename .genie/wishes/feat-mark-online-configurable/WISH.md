# feat-mark-online-configurable

> Make `markOnlineOnConnect` configurable per instance instead of hardcoded to `true`.

## GitHub Issue
- **#310** — Make markOnlineOnConnect configurable per instance

## Problem
`markOnlineOnConnect` is hardcoded to `true` in `DEFAULT_SOCKET_CONFIG` (channel-whatsapp/src/socket.ts:78). When true, Omni sends `sendPresenceUpdate("available")` on connection, which suppresses phone push notifications and shows the user as "online" on WhatsApp. Users must patch `dist/server/index.js` manually, and the fix is lost on every update.

## Scope
- **In:** Add `markOnlineOnConnect` column to instances table, wire it through socket creation, expose in API
- **Out:** No CLI changes needed (existing PATCH /instances/:id already handles dynamic columns)

## Acceptance Criteria
1. `markOnlineOnConnect` column exists in `instances` table with default `true` (backward compatible)
2. The WhatsApp plugin reads the instance-level value and passes it to `createSocket()`
3. `PATCH /api/v2/instances/:id` accepts `markOnlineOnConnect: boolean`
4. Default behavior unchanged — existing instances still mark online on connect
5. Migration generated via `drizzle-kit generate` (not push)

## Key Files
| File | Change |
|------|--------|
| `packages/db/src/schema.ts` | Add `markOnlineOnConnect` boolean column, default `true` |
| `packages/db/drizzle/NNNN_*.sql` | Generated migration |
| `packages/channel-whatsapp/src/plugin.ts` | Read `instance.markOnlineOnConnect` in `connect()`, pass to socket config |
| `packages/channel-whatsapp/src/socket.ts` | Already supports `markOnlineOnConnect` in config — no change needed |
| `packages/api/src/routes/v2/instances.ts` | Add to update schema validation (if not already dynamic) |

## Execution Groups

### Group 1: Schema + migration
| # | Deliverable | File |
|---|-------------|------|
| 1 | Add `markOnlineOnConnect` boolean column with `default(true)` | `packages/db/src/schema.ts` |
| 2 | Generate migration | `packages/db/drizzle/` |

### Group 2: Wire through WhatsApp plugin
| # | Deliverable | File |
|---|-------------|------|
| 1 | Read `instance.markOnlineOnConnect` in `connect()` method | `packages/channel-whatsapp/src/plugin.ts` |
| 2 | Pass to `createSocket()` via `socketOptions.markOnlineOnConnect` | `packages/channel-whatsapp/src/plugin.ts` |

### Group 3: API exposure
| # | Deliverable | File |
|---|-------------|------|
| 1 | Verify `markOnlineOnConnect` is accepted in instance update endpoint | `packages/api/src/routes/v2/instances.ts` |
| 2 | Add to OpenAPI description if needed | `packages/api/src/routes/v2/instances.ts` |

## Validation
```bash
bun run build               # Zero errors
bun test                    # Full suite passes
bunx biome check .          # Zero lint errors
# Manual: PATCH instance with markOnlineOnConnect: false, reconnect, verify no presence sent
```

## Confidence: 100%
Pattern identical to existing `readReceipts` per-instance toggle. Socket config already accepts the field.
