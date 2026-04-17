---
slug: cli-360-agents-update-events-get-verbose-logs
issue: automagik-dev/omni#360
branch: feat/cli-360-agents-update-events-get-verbose-logs
status: DRAFT
wrs: 40
---

# Brainstorm: CLI #360 — agents update, events get, verbose logs

## Problem
Three CLI gaps from issue #360 (Felipe Rosa) force destructive workarounds during routine agent management and debugging:

1. **`omni agents update <id>`** missing — fixing a typo on `--name` or pointing an agent at a different `--provider-id`/`--model` requires `delete + create`, generating a new UUID and breaking instance assignments.
2. **`omni events get <id>`** missing — `events list` is summary-only; there's no way to drill into a single event's full payload (sender, chat, agent response, error, timing).
3. **`omni logs error --verbose`/`--json`** missing — `logs` outputs a fixed table with `MESSAGE` truncated to 80 chars. Stack traces, request payloads, agent IDs, and chat IDs are unreachable from the CLI.

## Recon (existing surface)

| Layer | `agents update` | `events get` | `logs verbose` |
|-------|-----------------|--------------|-----------------|
| **API route** | ✅ `PATCH /agents/:id` exists (routes/v2/agents.ts:80) | ✅ `GET /events/:id` exists (routes/v2/events.ts:225) | ⚠️ `/logs/recent` returns full entries from `LogBuffer.getRecent()` — buffer stores `LogEntry` with `[key: string]: unknown` extras, but `LogEntry` OpenAPI schema only declares `time/level/module/msg`, so extra context is dropped at serialization (or never declared) |
| **API service** | ✅ `services.agents.update()` exists | ✅ `services.events.getById()` exists | ✅ buffer keeps full entry |
| **SDK** | ❌ no `agents.update()` method | ❌ no `events.get()` method | ⚠️ `LogEntry` type only carries 4 fields |
| **CLI** | ❌ no `update` subcommand (agents.ts:150 lines, only list/get/create/delete) | ❌ no `get` subcommand (events.ts has list/search/timeline/metrics/analytics/replay) | ⚠️ table truncates at 80 chars; no `--verbose`/`--json` flag |

**Implication:** items #1 and #2 are pure plumbing — wire SDK + CLI to existing API endpoints. Item #3 is the only one with a real architectural decision: do we (a) extend `LogEntry` schema to carry rich error context, (b) keep schema lean and add a separate `/logs/recent/:idx?` detail endpoint, or (c) use OpenAPI `additionalProperties: true` and let the existing `[key: string]: unknown` flow through.

## Scope (proposed)

### IN
- `omni agents update <id> [--name <name>] [--model <model>] [--provider <provider>] [--agent-provider <id>] [--type <type>] [--active|--inactive]` — patch any subset of fields, returns updated agent
- SDK: `client.agents.update(id, body)` matching `PATCH /agents/:id`
- `omni events get <id> [--json]` — full event detail with payload
- SDK: `client.events.get(id)` returning `Event` with full payload
- `omni logs [level] --json` — emit raw `LogEntry[]` as JSON to stdout (no truncation)
- `omni logs [level] --verbose` — pretty-printed multi-line view including any extra fields (stack trace, agentId, chatId, payload)
- LogEntry schema extension: declare `data?: Record<string, unknown>` (or `additionalProperties: true`) so error context survives serialization
- Tests: SDK coverage entries + CLI smoke tests for the three new flows
- Help text and `omni --help` updates

### OUT
- Bulk update (`omni agents update --all --provider X`) — out of scope, can be a follow-up
- Interactive `agents edit` TUI — out of scope
- New error-context fields on every log call — only ensure existing extras pass through; we don't refactor every `logger.error(...)` call site
- Persistent log storage — out of scope; logs remain in-memory ring buffer
- `omni events watch <id>` (live updates) — out of scope

## Approach (single wish, three groups)

Recommended: **one wish, three execution groups**, because:
- Same author of #360 reported all three from one debugging session — they want one merged fix
- Same layered pattern (API ✓, SDK ✗, CLI ✗) across items 1 & 2
- Item 3 has its own decision but is small enough not to warrant a separate wish
- Single PR keeps the issue clean and aligns with conventional commits (`feat(cli): ...`)

Execution groups:
- **G1 — agents update** (CLI + SDK + tests). Lowest risk, highest user impact.
- **G2 — events get** (CLI + SDK + tests). Mirrors G1 pattern.
- **G3 — logs verbose/json** (LogEntry schema + API serialization passthrough + SDK type regen + CLI flags + tests). Has the only design decision; should be sequenced last so we ship G1+G2 even if G3 needs council.

## Decisions (open)
| Decision | Options | Recommendation | Status |
|----------|---------|----------------|--------|
| Single wish or three? | (a) one wish, three groups; (b) three wishes; (c) split logs out | (a) — one wish, three groups | ✅ Confirmed |
| LogEntry schema extension | (a) declare `data?: Record<string, unknown>`; (b) `additionalProperties: true`; (c) separate `/logs/recent/:idx` detail endpoint | (a) — explicit, type-safe, minimal blast radius | ✅ Confirmed |
| Output format default | `--json` opt-in vs default-JSON-when-piped | opt-in `--json` flag for now (matches existing CLI conventions) | Pending |
| `agents update` field validation | reuse `VALID_PROVIDERS`/`VALID_TYPES` constants from create | yes — DRY | Confirmed |
| `events get --json` vs separate flag | use existing `output.data()` (already pretty-prints / json based on TTY) | yes | Confirmed |

## Risks & assumptions
| Risk | Severity | Mitigation |
|------|----------|------------|
| `LogEntry` schema change forces SDK type regen across all consumers (sdk-go, sdk-python) | Medium | Add `data` as optional; existing consumers unaffected. Run `bun run generate:sdk` and verify cross-language SDKs still build |
| Redaction (`redactObject`) might already strip the rich error context before push to buffer — need to confirm | Medium | Inspect `redact.ts` during execution; add test case with stack trace |
| `PATCH /agents/:id` may not validate provider/type identically to POST — discrepancy could let CLI accept invalid inputs that API rejects | Low | Mirror the CLI validation from `agents create` exactly |
| Item 3 may surface that the existing log buffer drops `data` fields during JSON formatting — would expand scope | Medium | Spike during execution; if discovered, escalate to council and possibly defer G3 to follow-up wish |
| Touching SDK regen could rebase-conflict with NATS Genie work on dev | Low | Keep changes scoped to `agents`/`events`/`logs` paths |

## Success criteria
- [ ] `omni agents update <id> --model claude-sonnet-4-6` patches the model field; `omni agents get <id>` reflects the change; UUID is unchanged
- [ ] `omni agents update <id> --name "X" --model "Y"` patches multiple fields atomically
- [ ] `omni agents update <id>` (no fields) errors clearly without hitting the API
- [ ] `omni events get <id>` returns full event payload including sender, chat, error fields when present
- [ ] `omni events get <id> --json` emits valid parseable JSON
- [ ] `omni logs error --json` emits a JSON array of log entries with no truncation, including any extra `data` fields
- [ ] `omni logs error --verbose` shows multi-line entries with stack traces and context
- [ ] `bun run build` clean across all packages
- [ ] `bunx biome check .` clean
- [ ] `bun test` passes for new SDK + CLI test cases
- [ ] CLI smoke: `omni --help`, `omni agents update --help`, `omni events get --help`, `omni logs --help` all render correctly

## Wish Readiness Score
```
WRS: ████░░░░░░ 40/100
 Problem ✅ | Scope ✅ | Decisions ░ | Risks ░ | Criteria ░
```

(Scope and Problem are filled; Decisions, Risks, Criteria need user confirmation before crystallizing.)
