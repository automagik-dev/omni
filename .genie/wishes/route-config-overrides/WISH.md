# Wish: Per-User and Per-Agent Config Overrides on Routes

| Field | Value |
|-------|-------|
| **Status** | APPROVED |
| **Slug** | `route-config-overrides` |
| **Date** | 2026-03-24 |
| **Design** | [DESIGN.md](../../brainstorms/route-config-overrides/DESIGN.md) |

## Summary
Add debounce, split delay, and ack override columns to `agent_routes` so each user/chat can have different messaging behavior on the same WhatsApp number. Eliminates the need to run multiple Omni installations for dev/prod config separation. "I'm admin, no debounce, no ack, no bullshit — everyone else gets defaults."

## Scope
### IN
- Add 14 nullable override columns to `agent_routes` table in schema.ts
- Drizzle migration for new columns
- Extend `resolveEffectiveInstance()` merge with new fields
- Move route resolution BEFORE debounce in the `message.received` handler
- Store resolved instance in debounce buffer (avoid double resolution)
- Update typing event handler to use route-resolved debounce config
- Update OpenAPI schemas in `agent-routes.ts`
- Update route CRUD routes to accept new fields
- CLI `omni routes create/update` with new flags (--debounce-mode, --debounce-min, --split-delay-mode, --reaction-ack, --ack-message, etc.)

### OUT
- Access mode/rules at route level (security stays instance-scoped)
- Profile name/pic at route level (WhatsApp protocol: per-number)
- Read receipts at route level (WhatsApp protocol: per-connection)
- Trigger events at route level (per-connection subscription)
- A/B testing framework (YAGNI — just use routes manually)
- processAudio/processImages at route level (defer to separate wish if needed)

## Decisions
| Decision | Rationale |
|----------|-----------|
| All 14 columns nullable | Null = inherit from instance. Existing routes auto-inherit. Zero migration backfill needed. |
| Move route resolution before debounce | Only way to support per-user debounce. The resolved instance is cached in the buffer — no double resolution. |
| Schema+merge first (Group 1), pipeline second (Group 2) | Group 1 gives instant value for split/ack overrides (read post-resolution already). Group 2 adds debounce (requires pipeline change). Incremental value delivery. |
| No new DispatchInstance type | The existing spread pattern `{...instance, ...overrides}` already works for 10+ fields. Adding 14 more follows the same pattern. |
| CLI flags grouped by prefix | `--debounce-mode`, `--debounce-min`, `--split-delay-mode`, etc. Discoverable via `--help`. |

## Success Criteria
- [ ] `omni routes create --scope user --person X --debounce-mode disabled --reaction-ack off` creates a route with overrides
- [ ] Messages from user X use disabled debounce (instant response, no wait)
- [ ] Messages from users without a route use instance defaults (no regression)
- [ ] Split delay override works: route with `--split-delay-mode disabled` → no delay between message parts
- [ ] Reaction ack override works: route with `--reaction-ack on` → ack emoji for that user only
- [ ] Ack message override works: route with `--ack-message ""` → no ack message for that user
- [ ] Drizzle migration generates cleanly: `cd packages/db && bunx drizzle-kit generate`
- [ ] Existing tests pass: `bun test` in packages/api
- [ ] TypeScript compiles: `bunx tsc --noEmit`
- [ ] Close GitHub issue #242

## Execution Strategy

### Wave 1 (sequential — migration must exist before API/dispatcher changes)
| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Schema + migration + OpenAPI + CRUD + merge extension |

### Wave 2 (after Wave 1)
| Group | Agent | Description |
|-------|-------|-------------|
| 2 | engineer | Dispatcher pipeline — move route resolution before debounce |

### Wave 3 (after Wave 2)
| Group | Agent | Description |
|-------|-------|-------------|
| 3 | engineer | Tests + validation |

## Execution Groups

### Group 1: schema-api-merge
**Goal:** Add override columns, update API/CLI, extend the config merge.
**Deliverables:**
1. **`packages/db/src/schema.ts`** — Add 14 nullable columns to `agentRoutes` table:
   - Debounce: `messageDebounceMode`, `messageDebounceMinMs`, `messageDebounceMaxMs`, `messageDebounceGroupMs`, `messageDebounceRestartOnTyping`
   - Split: `messageSplitDelayMode`, `messageSplitDelayFixedMs`, `messageSplitDelayMinMs`, `messageSplitDelayMaxMs`, `enableAutoSplit`
   - Ack: `reactionAck`, `reactionAckEmoji`, `ackTimeoutMs`, `agentAckMessage`
   - All nullable (null = inherit from instance). Use same types as instances table.
2. **`packages/db/drizzle/`** — Generate migration: `cd packages/db && bunx drizzle-kit generate`
3. **`packages/api/src/schemas/openapi/agent-routes.ts`** — Add new fields to create/update/response schemas (all optional/nullable)
4. **`packages/api/src/routes/v2/agent-routes.ts`** — Accept new fields in create/update handlers
5. **`packages/api/src/plugins/agent-dispatcher.ts`** — Extend `resolveEffectiveInstance()` merge block (line 2829) with 14 new `route.X ?? instance.X` lines for the new fields. This gives immediate support for split/ack/ack-message (read post-resolution).

**Acceptance Criteria:**
- [ ] Migration generates without errors
- [ ] TypeScript compiles: `bunx tsc --noEmit`
- [ ] Route creation with override fields persists to DB and appears in `omni routes get`
> Note: CLI flags are auto-generated from the OpenAPI schema. Updating the Zod schemas in `agent-routes.ts` IS the CLI change. No separate CLI package work needed.
- [ ] Split/ack/ack-message overrides work (these are read post-resolution, no pipeline change needed)

**Validation:**
```bash
cd /home/genie/.genie/worktrees/omni/omni-day && bunx tsc --noEmit
```

**depends-on:** none

---

### Group 2: early-route-resolution
**Goal:** Move route resolution before debounce so per-user debounce config works.
**Deliverables:**
1. **`packages/api/src/plugins/agent-dispatcher.ts`** — In the `message.received` handler (~line 3608):
   - After `shouldProcessMessage()` returns the base instance
   - Look up internal chat: `services.chats.findByExternalIdSmart(instance.id, payload.chatId)`
   - Call `resolveEffectiveInstance(services, db, instance, chat?.id, metadata.personId)`
   - Use the resolved instance for `getDebounceConfig()` instead of base instance
   - Store the resolved instance in the buffer metadata so the debounce callback uses it
   - In the debounce callback (~line 3563): use the pre-resolved instance from the buffer instead of calling `resolveEffectiveInstance()` again
2. **`packages/api/src/plugins/message-debouncer.ts`** — May need to update `BufferedMessage` type to carry `resolvedInstance` in metadata
3. **Typing handler** (~line 3798): Also use route-resolved debounce config for `restartOnTyping`

**Acceptance Criteria:**
- [ ] Route with `messageDebounceMode: 'disabled'` → messages from that user bypass debounce entirely
- [ ] Route with `messageDebounceMinMs: 5000` → that user's messages debounce at 5s, not instance default
- [ ] Users without routes still use instance debounce config (no regression)
- [ ] No double route resolution (resolved once, stored in buffer, reused in callback)
- [ ] TypeScript compiles: `bunx tsc --noEmit`

**Validation:**
```bash
cd /home/genie/.genie/worktrees/omni/omni-day && bunx tsc --noEmit
```

**depends-on:** Group 1

---

### Group 3: tests-validation
**Goal:** Add tests and validate the full override pipeline.
**Deliverables:**
1. Unit test: config merge — route overrides beat instance defaults for all 14 fields
2. Unit test: null route fields inherit from instance (no override = instance default)
3. Unit test: `getDebounceConfig()` with route-resolved instance returns route values
4. Integration test: create route with `--debounce-mode disabled`, verify debounce is skipped
5. Verify existing tests pass

**Acceptance Criteria:**
- [ ] All new tests pass
- [ ] Existing tests pass: `bun test` in packages/api

**Validation:**
```bash
cd /home/genie/.genie/worktrees/omni/omni-day/packages/api && bun test
```

**depends-on:** Group 2

---

## Assumptions / Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| Early route resolution adds latency to every message | Medium | Route resolver caches results. When no route exists (most messages), it returns null fast. Measure latency before/after. |
| Buffer carries resolved instance → memory increase | Low | One extra object reference per buffered message. Negligible. |
| 14 new CLI flags on routes create/update | Low | Grouped by prefix (`--debounce-*`, `--split-*`, `--ack-*`). Shown in `--help`. |
| Migration adds 14 nullable columns to production | Low | Adding nullable columns is instant in PostgreSQL — no table rewrite, no lock. |

## Files to Create/Modify

```
packages/db/src/schema.ts                              # Add 14 nullable columns to agentRoutes
packages/db/drizzle/                                   # Generated migration
packages/api/src/schemas/openapi/agent-routes.ts       # OpenAPI schemas for new fields
packages/api/src/routes/v2/agent-routes.ts             # CRUD handlers accept new fields
packages/api/src/plugins/agent-dispatcher.ts           # Extend merge + move route resolution before debounce
packages/api/src/plugins/message-debouncer.ts          # BufferedMessage type may need resolvedInstance
packages/api/src/plugins/__tests__/route-overrides.test.ts  # New: config override tests
```
