# Design: CLI #360 — agents update, events get, verbose logs

| Field | Value |
|-------|-------|
| **Slug** | `cli-360-agents-update-events-get-verbose-logs` |
| **Issue** | automagik-dev/omni#360 |
| **Branch** | `feat/cli-360-agents-update-events-get-verbose-logs` |
| **Date** | 2026-04-08 |
| **WRS** | 100/100 |

## Problem
Three CLI gaps from issue #360 force destructive workarounds during routine agent management and debugging:
1. `omni agents update <id>` is missing — patching a single agent field requires `delete + create`, generating a new UUID and breaking instance assignments.
2. `omni events get <id>` is missing — `events list` is summary-only; there's no way to drill into a single event's full payload.
3. `omni logs error --verbose`/`--json` is missing — the table truncates `MESSAGE` to 80 chars, and the API schema strips extra error context (stack, agentId, chatId, payload) before serialization.

## Scope

### IN
- **G1 — `omni agents update <id>`**
  - CLI: subcommand on `agents` with `--name`, `--model`, `--provider`, `--agent-provider`, `--type`, `--active|--inactive` flags. Requires at least one field; reuses `VALID_PROVIDERS`/`VALID_TYPES` validation from `agents create`.
  - SDK: `client.agents.update(id, body)` calling `PATCH /agents/:id` and returning the updated `Agent`.
  - Tests: SDK coverage entry; CLI smoke test.
- **G2 — `omni events get <id>`**
  - CLI: subcommand on `events` with `--json` flag (uses existing `output.data()` for default pretty-print).
  - SDK: `client.events.get(id)` calling `GET /events/:id` and returning the full `Event`.
  - Tests: SDK coverage entry; CLI smoke test.
- **G3 — `omni logs --verbose`/`--json`**
  - OpenAPI schema: extend `LogEntry` with optional `data?: Record<string, unknown>` field.
  - API route: `/logs/recent` reshapes each entry into `{time, level, module, msg, data: <rest>}` so extras survive serialization.
  - SDK: regenerate `types.generated.ts`; `LogEntry` now exposes `data?`.
  - CLI: `--json` emits raw JSON array (no truncation); `--verbose` pretty-prints multi-line including `data` fields when present.
  - Cross-language SDKs: run `bun run generate:sdk` and confirm sdk-go and sdk-python build cleanly with the new optional field.
- **Cross-cutting**
  - `omni --help`, per-subcommand `--help` updated.
  - `bun run build` clean across all packages.
  - `bunx biome check .` clean.
  - `bun test` passes for new test cases.

### OUT
- Bulk update (`omni agents update --all --provider X`) — follow-up.
- Interactive `agents edit` TUI — follow-up.
- Refactoring existing `logger.error(...)` call sites to add structured context — only ensure existing extras pass through.
- Persistent log storage — logs remain in-memory ring buffer.
- `omni events watch <id>` (live updates) — follow-up.
- New event-search filters — out of scope; only the `get` drill-down.

## Approach
**Single wish, three execution groups, sequenced G1 → G2 → G3.**

Items #1 and #2 are pure plumbing — every layer except SDK + CLI is already in place (`PATCH /agents/:id` lives in `routes/v2/agents.ts:80`; `GET /events/:id` lives in `routes/v2/events.ts:225`). The execution pattern is identical: add SDK method → add CLI subcommand → add test.

Item #3 has the only design decision in the wish: how to expose the rich error context the buffer already carries. The chosen approach declares an explicit `data?: Record<string, unknown>` field on `LogEntry` and reshapes entries at API serialization. This is type-safe, regenerates cleanly across cross-language SDKs (each adds one optional field), and avoids the loose typing of `additionalProperties: true` or the unnecessary indirection of a separate detail endpoint.

Sequencing G3 last keeps the schema work isolated; if it surfaces unforeseen redaction or cross-SDK issues during execution, G1 and G2 are still mergeable independently within the same wish.

### Design-for-Isolation notes
- **Single purpose per group:** G1 = agents PATCH wiring; G2 = events GET wiring; G3 = log entry context exposure. Each group has one purpose and ships independently.
- **Well-defined interfaces:** Each new SDK method maps 1:1 to an existing API route. The `data?: Record<string, unknown>` field is the only contract change and is additive/optional.
- **Independent testability:** SDK tests can hit a mocked openapi-fetch client; CLI smoke tests run against a local API. No new shared state.
- **File size:** `agents.ts` (150 lines) and `events.ts` (393 lines) both have headroom; no splits needed.
- **Explicit dependencies:** G1/G2 depend only on existing API routes. G3 depends on the OpenAPI schema regen pipeline (`bun run generate:sdk`).

## Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Wish shape | Single wish, three execution groups | Same author, same debugging session, single PR keeps the issue clean |
| LogEntry schema extension | Declare `data?: Record<string, unknown>` (option a) | Explicit, type-safe, minimal blast radius across cross-language SDKs |
| `agents update` validation | Reuse `VALID_PROVIDERS`/`VALID_TYPES` from create | DRY; avoids drift between create and update validation |
| `events get` JSON output | Use existing `output.data()` (TTY-aware) + explicit `--json` flag | Matches existing CLI conventions |
| `logs --json` semantics | Opt-in flag, not auto-when-piped | Predictable; matches conventions in other commands |
| Sequencing | G1 → G2 → G3 | Ship pure-plumbing wins first; isolate the only schema change to last |
| Empty-update guard | `omni agents update <id>` with no fields errors before hitting the API | Avoids no-op API calls and confusing 200 responses |

## Risks & Assumptions
| Risk | Severity | Mitigation |
|------|----------|------------|
| `LogEntry` schema change forces SDK regen across sdk-go and sdk-python | Medium | `data` is optional; existing consumers unaffected. Run `bun run generate:sdk` and verify both cross-language SDKs build during G3 |
| `redactObject` may strip rich error context before push to buffer | Medium | Inspect `packages/core/src/logger/redact.ts` during G3 spike; add a test case with a stack trace and a known-safe payload to confirm extras survive |
| `PATCH /agents/:id` validation may diverge from `POST /agents` | Low | Mirror CLI validation from `agents create` exactly; add a test that exercises invalid inputs to confirm parity |
| Touching SDK regen could rebase-conflict with NATS Genie work on dev | Low | Keep changes scoped to `agents`/`events`/`logs` paths; rebase before final review |
| `output.data()` JSON behavior may differ from raw stdout JSON expectations | Low | G2 verifies JSON output is valid parseable JSON in a test |
| Buffer-side log entries with `data` fields may not be included in `getRecent()` filtering | Low | G3 includes a test that pushes a log entry with `data` and asserts it appears in the API response |

## Success Criteria
- [ ] `omni agents update <id> --model claude-sonnet-4-6` patches the model field; `omni agents get <id>` reflects the change; UUID is unchanged
- [ ] `omni agents update <id> --name "X" --model "Y"` patches multiple fields atomically
- [ ] `omni agents update <id>` with no field flags errors clearly without hitting the API
- [ ] `omni agents update <id> --provider invalid-provider` errors with the same message format as `agents create`
- [ ] `omni events get <id>` returns full event payload including sender, chat, error fields when present
- [ ] `omni events get <id> --json` emits valid parseable JSON
- [ ] `omni events get <missing-id>` exits non-zero with a clear "not found" message
- [ ] `omni logs error --json` emits a JSON array of log entries with no truncation, including any extra `data` fields
- [ ] `omni logs error --verbose` shows multi-line entries with stack traces and context when present
- [ ] `omni logs --help`, `omni agents update --help`, `omni events get --help` all render correctly
- [ ] `bun run build` clean across all packages (zero errors)
- [ ] `bunx biome check .` clean (zero lint errors)
- [ ] `bun test` passes for all new SDK + CLI test cases
- [ ] `bun run generate:sdk` succeeds and sdk-go + sdk-python build cleanly with the new `data?` field

## Execution Groups (preview for /wish)
- **G1 — agents-update** (CLI + SDK + tests). Lowest risk, highest user impact.
- **G2 — events-get** (CLI + SDK + tests). Mirrors G1 pattern.
- **G3 — logs-verbose** (LogEntry schema + API serialization passthrough + SDK type regen + CLI flags + tests). Has the only design decision; sequenced last.

## Spec Self-Review
1. **Placeholder scan:** No TBD/TODO. All sections filled.
2. **Internal consistency:** Scope IN matches success criteria; OUT items are not tested. Approach matches Decisions table.
3. **Scope check:** Single wish, three cohesive groups, all within `packages/cli`, `packages/sdk`, `packages/api`, `packages/core/src/logger`. Bounded.
4. **Ambiguity check:** `--verbose` semantics defined ("multi-line including `data` fields"); `--json` semantics defined ("raw JSON array, no truncation"); empty-update behavior defined ("errors before hitting API").
