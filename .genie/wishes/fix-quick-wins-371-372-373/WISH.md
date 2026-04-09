# Wish: Fix three quick wins — null reply filter (#371), agents create flags (#372), split-delay PATCH (#373)

| Field | Value |
|-------|-------|
| **Status** | READY |
| **Slug** | `fix-quick-wins-371-372-373` |
| **Date** | 2026-04-09 |
| **Design** | N/A — all three have complete root cause + fix from trace investigation |

## Summary

Three independent, low-risk fixes from the open backlog. #371 is P1 (silently drops ALL messages on new instances), #372 is P1 (agents create CLI missing 3 flags), #373 is P2 (instance PATCH missing split-delay fields). All surgical, all in different files, all independently revertable.

## Scope

### IN
- Default `shouldAgentReply` to `true` when filter is null, upgrade log to info level (#371)
- Add `--provider-agent-id`, `--config-path`, `--metadata` flags to `omni agents create` and `update` (#372)
- Add `messageSplitDelay*` fields to instance create/update API schema + CLI flags (#373)

### OUT
- No DB migrations (all columns already exist)
- No changes to dispatcher logic itself (only inputs to it)
- No changes to the debounce system (that's #374)

## Decisions

| Decision | Rationale |
|----------|-----------|
| **null filter → reply to all** rather than adding a DB default | Changing the runtime behavior is safer — existing null-filter instances immediately start working. A DB migration to backfill defaults would be needed otherwise and risks schema conflicts. |
| **CLI-only fix for #372** | The API, SDK, DB, and OpenAPI schema already accept `configPath` and `metadata`. Only the CLI is missing the flags. |
| **Add split-delay to both create and update schemas** | Following the same pattern as the existing `messageDebounce*` fields that are already exposed. |

## Success Criteria

- [ ] New instances with null `agentReplyFilter` receive and process all inbound messages
- [ ] When reply filter blocks a message, log line appears at `info` level (not `debug`)
- [ ] `omni agents create --provider-agent-id <id>` stores `metadata.providerAgentId` correctly
- [ ] `omni agents create --config-path <path>` stores `configPath` correctly
- [ ] `omni agents create --metadata '{"key":"val"}'` stores arbitrary metadata correctly
- [ ] `omni agents update` accepts the same three new flags
- [ ] `omni instances update --split-delay-mode randomized --split-delay-min 1000 --split-delay-max 3000` works
- [ ] `omni instances create` also accepts the four split-delay flags
- [ ] Existing test for null filter updated to expect reply-to-all behavior
- [ ] `bun run build` + `bunx biome check .` + `bun test` all clean
- [ ] PR opened targeting `dev`, linking to #371, #372, #373

## Execution Strategy

### Wave 1 (parallel — all three fixes are independent)

| Group | Agent | Description |
|-------|-------|-------------|
| 1 | engineer | Fix null reply filter default + upgrade log level (#371) |
| 2 | engineer | Add missing agents create/update CLI flags (#372) |
| 3 | engineer | Add split-delay fields to instance API schema + CLI (#373) |

### Wave 2 (after Wave 1)

| Group | Agent | Description |
|-------|-------|-------------|
| review | reviewer | Validate all three fixes, run quality gates, open PR |

## Execution Groups

### Group 1: Fix null reply filter default (#371) — XS, ~15 min

**Goal:** Stop silently dropping messages on instances with no reply filter configured.

**Root Cause:**
`shouldAgentReply()` at `packages/api/src/services/agent-runner.ts:130` returns `false` when `filter` is `null`. The dispatcher logs this at `debug` level (invisible in production). New instances always have `null` filter because neither the DB schema nor the API sets a default.

**Deliverables:**

1. **`packages/api/src/services/agent-runner.ts`** — line 130:
   - Change `if (!filter) return false;` → `if (!filter) return true;`
   - Update comment to: `// No filter configured = reply to all (safe default for new instances)`

2. **`packages/api/src/plugins/agent-dispatcher.ts`** — line ~3537:
   - Change `log.debug('Message did not pass reply filter', ...)` → `log.info('Message did not pass reply filter', ...)`

3. **`packages/api/src/plugins/__tests__/agent-dispatcher.test.ts`** — lines ~1288-1310:
   - Update test `'skips messages when reply filter is null (no agent response)'` to expect `agentRunner.run` IS called when filter is null
   - Rename test to `'processes messages when reply filter is null (reply to all by default)'`

**Validation:**
```bash
bun test packages/api/src/plugins/__tests__/agent-dispatcher.test.ts
bun test packages/api/src/services/__tests__/agent-runner.test.ts
```

---

### Group 2: Add missing agents CLI flags (#372) — S, ~30 min

**Goal:** Expose `--provider-agent-id`, `--config-path`, and `--metadata` on `omni agents create` and `omni agents update`.

**Root Cause:**
The CLI command at `packages/cli/src/commands/agents.ts:135-180` only exposes `--name`, `--provider`, `--model`, `--type`, `--agent-provider`. The API (routes/v2/agents.ts), SDK (types.generated.ts), and DB (schema.ts) all support `configPath`, `metadata`, and `agentProviderId` already.

**Deliverables:**

1. **`packages/cli/src/commands/agents.ts`** — create subcommand (~line 135):
   - Add `.option('--config-path <path>', 'Path to agent config file')`
   - Add `.option('--metadata <json>', 'Agent metadata as JSON string')`
   - Add `.option('--provider-agent-id <id>', 'Provider-internal agent identifier (stored in metadata.providerAgentId)')`
   - In action handler: if `--provider-agent-id` is given, merge into metadata as `{ ...parsedMetadata, providerAgentId: opts.providerAgentId }`
   - Pass `configPath` and `metadata` to `client.agents.create()`

2. **`packages/cli/src/commands/agents.ts`** — update subcommand (~line 182):
   - Add same three flags
   - Extend `UpdateAgentOptions` and `UpdateAgentBody` interfaces to include `configPath?: string` and `metadata?: Record<string, unknown>`
   - Extend `buildUpdateAgentBody()` to map the new fields

**Validation:**
```bash
omni agents create --help  # verify new flags appear
omni agents update --help  # verify new flags appear
bun run build
```

---

### Group 3: Add split-delay fields to instance schema + CLI (#373) — S, ~30 min

**Goal:** Allow configuring `messageSplitDelay*` via API and CLI, matching the existing `messageDebounce*` pattern.

**Root Cause:**
The `createInstanceSchema` Zod schema at `packages/api/src/routes/v2/instances.ts:58-162` defines `messageDebounce*` fields (lines 87-110) but omits the corresponding `messageSplitDelay*` fields. The `updateInstanceSchema` derives from `createInstanceSchema.partial()`, so it also lacks them. The CLI has no `--split-delay-*` flags.

**Deliverables:**

1. **`packages/api/src/routes/v2/instances.ts`** — `createInstanceSchema` (after ~line 110):
   - Add `messageSplitDelayMode: z.enum(['disabled', 'fixed', 'randomized']).default('randomized')`
   - Add `messageSplitDelayFixedMs: z.number().int().min(0).default(0)`
   - Add `messageSplitDelayMinMs: z.number().int().min(0).default(300)`
   - Add `messageSplitDelayMaxMs: z.number().int().min(0).default(1000)`
   - In `updateInstanceSchema` extend block (~line 168): add `.optional()` overrides for each (strip defaults, same pattern as debounce fields)

2. **`packages/cli/src/commands/instances.ts`**:
   - Add `applySplitDelayFields(body, opts)` helper (mirror `applyDebounceFields` at line 82)
   - Call it from `buildInstanceBody()` (~line 134)
   - Add `--split-delay-mode`, `--split-delay-fixed`, `--split-delay-min`, `--split-delay-max` to both create (~line 287) and update (~line 752) commands

3. **`packages/api/src/schemas/openapi/instances.ts`** (optional):
   - Add `messageSplitDelay*` fields to the OpenAPI response schema for documentation accuracy

**Validation:**
```bash
omni instances update --help  # verify new flags appear
bun run build
bunx biome check .
```
