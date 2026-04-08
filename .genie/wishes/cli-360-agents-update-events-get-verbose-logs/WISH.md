# Wish: CLI #360 — agents update, events get, verbose logs

| Field | Value |
|-------|-------|
| **Status** | DRAFT |
| **Slug** | `cli-360-agents-update-events-get-verbose-logs` |
| **Date** | 2026-04-08 |
| **Issue** | automagik-dev/omni#360 |
| **Branch** | `feat/cli-360-agents-update-events-get-verbose-logs` |
| **Design** | [DESIGN.md](../../brainstorms/cli-360-agents-update-events-get-verbose-logs/DESIGN.md) |

## Summary
Closes the three CLI gaps from issue #360 by wiring `omni agents update <id>`, `omni events get <id>`, and `omni logs --verbose|--json` against API endpoints that already exist. Eliminates the destructive `delete + create` workaround for agent edits, gives operators a way to drill into single events, and makes error context (stack traces, payloads, agent/chat IDs) reachable from the CLI by extending `LogEntry` with an explicit `data?` field.

## Scope

### IN
- `omni agents update <id>` CLI subcommand + `client.agents.update(id, body)` SDK method
- `omni events get <id>` CLI subcommand + `client.events.get(id)` SDK method
- `omni logs --json` and `omni logs --verbose` flags
- `LogEntry` OpenAPI schema gets optional `data?: Record<string, unknown>`
- API route `/logs/recent` reshapes entries to `{time, level, module, msg, data: <rest>}`
- SDK regen (`bun run generate:sdk`) + verify sdk-go and sdk-python build
- SDK coverage entries + CLI smoke tests for the three new flows
- `omni --help` and per-subcommand `--help` text

### OUT
- Bulk update (`omni agents update --all --provider X`)
- Interactive `agents edit` TUI
- Refactoring existing `logger.error(...)` call sites to add structured context
- Persistent log storage (logs remain in-memory ring buffer)
- `omni events watch <id>` (live updates)
- New event-search filters
- Changes to non-agents/non-events/non-logs CLI commands

## Decisions
| Decision | Rationale |
|----------|-----------|
| Single wish, three execution groups | Same author, same debugging session, single PR keeps the issue clean (confirmed by user) |
| `LogEntry.data?: Record<string, unknown>` (option a) | Explicit, type-safe, minimal blast radius across cross-language SDKs (confirmed by user) |
| Reuse `VALID_PROVIDERS` / `VALID_TYPES` from `agents create` | DRY; avoids drift between create and update validation |
| `--json` is opt-in, not auto-when-piped | Predictable; matches conventions in other CLI commands |
| `omni agents update <id>` with no fields errors before hitting the API | Avoids no-op API calls and confusing 200 responses |
| G3 sequenced after G1+G2 | Isolates the only schema change so pure-plumbing wins ship cleanly even if G3 hits friction |

## Success Criteria
- [ ] `omni agents update <id> --model claude-sonnet-4-6` patches the model field; `omni agents get <id>` reflects the change; UUID is unchanged
- [ ] `omni agents update <id> --name "X" --model "Y"` patches multiple fields atomically
- [ ] `omni agents update <id>` with no field flags errors clearly without hitting the API
- [ ] `omni agents update <id> --provider invalid-provider` errors with the same message format as `agents create`
- [ ] `omni events get <id>` returns full event payload including sender, chat, and error fields when present
- [ ] `omni events get <id> --json` emits valid parseable JSON
- [ ] `omni events get <missing-id>` exits non-zero with a clear "not found" message
- [ ] `omni logs error --json` emits a JSON array of log entries with no truncation, including any extra `data` fields
- [ ] `omni logs error --verbose` shows multi-line entries with stack traces and context when present
- [ ] `omni agents update --help`, `omni events get --help`, `omni logs --help` all render correctly
- [ ] `bun run build` clean across all packages (zero errors)
- [ ] `bunx biome check .` clean (zero lint errors)
- [ ] `bun test` passes for all new SDK + CLI test cases
- [ ] `bun run generate:sdk` succeeds and sdk-go + sdk-python build cleanly with the new `data?` field

## Execution Strategy

### Wave 1 (parallel) — Pure plumbing
| Group | Agent | Description |
|-------|-------|-------------|
| G1 | engineer | Wire `agents update` (CLI + SDK + tests) |
| G2 | engineer | Wire `events get` (CLI + SDK + tests) |

Both groups touch `packages/sdk/src/client.ts` but in disjoint blocks (G1 in the `agents` resource ~line 2968, G2 in the `events` resource ~line 1873). Engineers must rebase against each other before pushing to avoid merge conflicts in `client.ts`.

### Wave 2 (after Wave 1) — Schema work
| Group | Agent | Description |
|-------|-------|-------------|
| G3 | engineer | Extend `LogEntry` schema, reshape API serialization, regen SDK, add `--json`/`--verbose` to CLI |

Sequenced after Wave 1 because it touches `types.generated.ts` (full SDK regen) and has the only contract change in the wish.

### Wave 3 (after Wave 2) — Review
| Group | Agent | Description |
|-------|-------|-------------|
| review | reviewer | Validate all 14 success criteria; ensure cross-language SDKs build |

## Execution Groups

### Group G1: agents-update
**Goal:** Add `omni agents update <id>` end-to-end so operators can patch agent fields without delete+recreate.

**Deliverables:**
1. `client.agents.update(id, body)` in `packages/sdk/src/client.ts` calling `PATCH /agents/{id}`, returning the updated `Agent`
2. `agents update` subcommand in `packages/cli/src/commands/agents.ts` with `--name`, `--model`, `--provider`, `--agent-provider`, `--type`, `--active|--inactive` flags; reuses `VALID_PROVIDERS`/`VALID_TYPES`; errors when no fields are passed
3. SDK coverage entry for `agents.update` in the test mapping
4. CLI smoke test that creates an agent, patches it, and asserts the change

**Acceptance Criteria:**
- [ ] `omni agents update <id> --model X` patches model and preserves UUID
- [ ] `omni agents update <id> --name X --model Y` patches both atomically
- [ ] `omni agents update <id>` (no flags) exits non-zero with a clear error before hitting the API
- [ ] `omni agents update <id> --provider invalid` errors using the same format as `agents create`
- [ ] `omni agents update --help` renders correctly

**Validation:**
```bash
bun run build && bunx biome check packages/cli/src/commands/agents.ts packages/sdk/src/client.ts && bun test packages/sdk packages/cli
```

**depends-on:** none

---

### Group G2: events-get
**Goal:** Add `omni events get <id>` end-to-end so operators can drill into a single event's full payload.

**Deliverables:**
1. `client.events.get(id)` in `packages/sdk/src/client.ts` calling `GET /events/{id}`, returning the full `Event`
2. `events get <id>` subcommand in `packages/cli/src/commands/events.ts` with `--json` flag; uses `output.data()` for default pretty-print
3. SDK coverage entry for `events.get` in the test mapping
4. CLI smoke test that fetches a known event and asserts the JSON shape

**Acceptance Criteria:**
- [ ] `omni events get <id>` returns full payload including sender, chat, and error fields when present
- [ ] `omni events get <id> --json` emits valid parseable JSON
- [ ] `omni events get <missing-id>` exits non-zero with a clear "not found" message
- [ ] `omni events get --help` renders correctly

**Validation:**
```bash
bun run build && bunx biome check packages/cli/src/commands/events.ts packages/sdk/src/client.ts && bun test packages/sdk packages/cli
```

**depends-on:** none (parallel with G1; rebase against G1 before pushing to avoid client.ts conflicts)

---

### Group G3: logs-verbose
**Goal:** Make rich error context (stack traces, payloads, agent/chat IDs) reachable from `omni logs` by extending the `LogEntry` schema with an optional `data?` field and adding `--json`/`--verbose` flags.

**Deliverables:**
1. **Spike first:** inspect `packages/core/src/logger/redact.ts` and confirm `redactObject` does NOT strip extra fields beyond known sensitive tokens. If it does, document the gap and adjust before continuing.
2. Extend OpenAPI schema for `LogEntry` to include `data?: Record<string, unknown>` (location: wherever the OpenAPI source-of-truth lives — likely a Zod schema in `packages/api/src/routes/v2/logs.ts` or a shared schema file referenced by `bun run generate:sdk`)
3. Update `/logs/recent` route to reshape each entry into `{time, level, module, msg, data: <rest>}` so extras survive serialization
4. Run `bun run generate:sdk` and verify `packages/sdk/src/types.generated.ts` now includes the `data?` field on `LogEntry`
5. Verify sdk-go and sdk-python build cleanly with the regenerated types
6. Add `--json` flag to `omni logs` (emits raw `LogEntry[]` JSON to stdout, no truncation, exits with no extra `output.dim()` summary line)
7. Add `--verbose` flag to `omni logs` (multi-line pretty-print including any `data` fields when present)
8. Test: push a log entry with a stack trace and `data: {agentId, chatId}` via the logger; assert it appears unchanged in `GET /logs/recent` and in `omni logs --json`

**Acceptance Criteria:**
- [ ] `LogEntry` OpenAPI schema declares `data?: Record<string, unknown>`
- [ ] `bun run generate:sdk` succeeds; `types.generated.ts` reflects the new field
- [ ] sdk-go and sdk-python build cleanly with the regenerated schema
- [ ] `omni logs error --json` emits a valid JSON array with no truncation and includes `data` fields when present
- [ ] `omni logs error --verbose` shows multi-line entries with stack traces and context
- [ ] `omni logs --help` renders correctly
- [ ] Existing `omni logs` (no flags) behavior is unchanged for the default table view
- [ ] Redaction still applies to known sensitive tokens within `data`

**Validation:**
```bash
bun run generate:sdk && bun run build && bunx biome check . && bun test packages/sdk packages/cli packages/api packages/core
```

**depends-on:** G1, G2 (sequenced after Wave 1 to isolate schema changes)

---

## Dependencies
- **depends-on:** none (no cross-wish dependencies)
- **blocks:** none

## QA Criteria

_Verified on dev after merge:_

- [ ] **Functional — agents update:** Create an agent via `omni agents create`, patch its model via `omni agents update`, confirm `omni agents get` reflects the change and the UUID is unchanged.
- [ ] **Functional — events get:** Send a message via `omni send`, find the resulting event via `omni events list`, drill into it via `omni events get <id>`, confirm full payload visible.
- [ ] **Functional — logs verbose:** Trigger an error (e.g. invalid provider call), run `omni logs error --json`, confirm stack trace and context appear in the JSON output.
- [ ] **Integration — instance preservation:** Patching an agent that's assigned to an instance does NOT detach it from the instance.
- [ ] **Regression — existing log table:** `omni logs` (no flags) renders the same truncated table as before — no change to default behavior.
- [ ] **Regression — events list/search/timeline:** All existing `events` subcommands still work unchanged.
- [ ] **Regression — agents list/get/create/delete:** All existing `agents` subcommands still work unchanged.
- [ ] **Cross-language SDKs:** sdk-go and sdk-python build cleanly post-merge.

## Assumptions / Risks
| Risk | Severity | Mitigation |
|------|----------|------------|
| `redactObject` strips rich error context before push to buffer | Medium | G3 starts with a redact.ts spike; if confirmed, document gap and adjust scope |
| `LogEntry` schema regen breaks sdk-go or sdk-python builds | Medium | `data` is optional; verify both cross-language SDKs build during G3; rollback the schema change if either fails |
| `PATCH /agents/:id` validation diverges from `POST /agents` | Low | G1 mirrors create-side validation exactly; test with invalid inputs |
| client.ts merge conflict between G1 and G2 in parallel Wave 1 | Low | Engineers rebase against each other before pushing; reviewer flags if missed |
| SDK regen rebase-conflicts with NATS Genie work on dev | Low | Branch is fresh off dev as of 2026-04-08; rebase before final review |
| `output.data()` JSON output format differs from raw stdout JSON expectations | Low | G2 test asserts JSON is parseable; if format is wrong, switch to direct `JSON.stringify` |

---

## Review Results

_Populated by `/review` after execution completes._

---

## Files to Create/Modify

```
packages/sdk/src/client.ts                         # G1 + G2: agents.update, events.get
packages/sdk/src/types.generated.ts                # G3: regenerated LogEntry
packages/sdk/src/__tests__/client.test.ts          # G1 + G2 + G3: SDK coverage
packages/cli/src/commands/agents.ts                # G1: agents update subcommand
packages/cli/src/commands/events.ts                # G2: events get subcommand
packages/cli/src/commands/logs.ts                  # G3: --json / --verbose flags
packages/api/src/routes/v2/logs.ts                 # G3: reshape /logs/recent serialization
packages/api/src/routes/v2/<schema-source>.ts      # G3: LogEntry schema extension (location TBD by spike)
.genie/wishes/cli-360-agents-update-events-get-verbose-logs/WISH.md  # this file
```
