# Wish: observability-hub P2 Genie — Mailbox trace_id stamping + PG→OTLP tailer

| Field | Value |
|-------|-------|
| **Status** | DEFERRED |
| **Slug** | `observability-hub-p2-genie` |
| **Date** | 2026-04-20 |
| **Parent design** | [observability-hub DESIGN.md](../../brainstorms/observability-hub/DESIGN.md) |
| **Original scope** | Formerly group 2.4 of `observability-hub-p2-producers`; extracted into own wish 2026-04-20 |
| **Depends on** | P1 ✅ done; P2-producers 2.2 (NATS dual-header injection on Omni side) to produce `x-trace-id` traffic |
| **Blocks** | End-to-end trace through Genie leg (Omni→NATS→Genie) |
| **Blocker for kickoff** | Resolve `repos/genie` divergence (see Risks) |

## Summary

Close the broken trace-propagation gap between Omni and Genie via NATS. Currently Omni's `NatsOutboundMessage` carries a `traceId` field in the payload (see `packages/core/src/providers/nats-genie-provider.ts:49`), but Genie's NATS subscriber (`src/services/omni-bridge.ts`) never reads message headers — and insertions into `genie_runtime_events` land with `trace_id = NULL` for `source='mailbox'` rows. Fix is narrow: extract W3C `traceparent` + khal-os `x-trace-id` headers, thread them into runtime event inserts. Additionally add a PG→OTLP tailer that emits existing Genie runtime events and tool_events as OTel spans to the chosen backend, vendor-neutral.

## Audit summary (2026-04-20, read-only)

| Finding | Evidence |
|---------|----------|
| Genie PG schema already supports trace_id | `git show origin/dev:src/lib/runtime-events.ts` → column `trace_id` in INSERT (line 248–267), TypeScript `traceId?: string` in interface (lines 93/110/122), query filter `if (query.traceId)` (line 224) |
| NATS subscriber does NOT read headers | `git show origin/dev:src/services/omni-bridge.ts`: imports `{ NatsConnection, StringCodec, Subscription, connect }` from 'nats' — no `headers` import; line 726 `const data = this.sc.decode(msg.data)` decodes body but never accesses `msg.headers`; grep for `traceId|trace_id|traceparent|x-trace-id|extractTrace` returns zero matches in the file |
| Consumer loop entry point | `src/services/omni-bridge.ts:724` — `for await (const msg of this.sub) { ... }` |
| Insert call site | not directly in omni-bridge.ts; delegated via `src/lib/runtime-events.ts` or `src/lib/protocol-router.ts` — needs walk-through |

## Scope

### IN

- **G1**: In `src/services/omni-bridge.ts` around line 725: extract `msg.headers?.get('x-trace-id')` and (as fallback) parse W3C `traceparent` (`msg.headers?.get('traceparent')`), thread into the downstream dispatch so the eventual `insertRuntimeEvent` call receives `traceId`
- **G2**: In any call site that builds `insertRuntimeEvent` inputs from mailbox-sourced messages, include `traceId` — preserve existing NULL behavior for `source IN ('chat','registry','hook','sdk')`
- **G3**: Add a **PG→OTLP tailer** — a worker that polls `genie_runtime_events` + `tool_events` for new rows since last offset, converts them to OTel spans (vendor-neutral OTLP out via `OTEL_EXPORTER_OTLP_ENDPOINT`), and advances offset. Cursor persisted in a new small table or existing mechanism (TBD in execution)
- **G4**: Unit test: publish an `omni.message.*` with `x-trace-id` header → assert `genie_runtime_events.trace_id` populated
- **G5**: Integration test: full round-trip Omni → NATS (w/ traceparent) → Genie bridge → mailbox insert → PG→OTLP tailer → span visible in backend with correct parent-child relationship

### OUT

- Changes to Omni side (lives in `observability-hub-p2-producers` group 2.2)
- New PG columns (schema already has what we need)
- Migration work
- Session replay in Genie
- Refactoring the broader bridge architecture

## Decisions

| Decision | Rationale |
|----------|-----------|
| Dual-read headers: `x-trace-id` first, fallback to W3C `traceparent` | Compat with khal-os convention + OTel standard; matches Omni's dual-emit |
| PG→OTLP tailer is additive (existing `genie_runtime_events` continues unchanged) | Zero risk to current Genie operations; OTLP is an extra subscriber |
| Tailer reads `genie_runtime_events` + `tool_events` | Both are source-of-truth for agent operations; combining gives full span tree |
| UUID-no-hyphens → 32-hex for W3C trace-id format when emitting OTLP | Canonical conversion; future agents can consume either representation |
| Fix ships as PR to `automagik-dev/genie` | Upstream home for Genie source |

## Success Criteria

- [ ] G1: mailbox consumer extracts `x-trace-id` header (or W3C traceparent) from incoming NATS messages
- [ ] G2: `genie_runtime_events.trace_id IS NOT NULL` for >95% of rows with `source='mailbox'` after deploy (allow for edge cases where Omni doesn't send header)
- [ ] G3: PG→OTLP tailer running, lag <30s, no duplicate spans on restart
- [ ] G4: Unit test in place
- [ ] G5: Integration test: one real Omni message traces through Genie leg and lands as child span in backend UI

## Blocker — must resolve before kickoff

**`repos/genie` local checkout is badly diverged:**
- Local `dev` branch at commit `b597c87d` (version `4.260402.18`) — ~2 weeks stale
- `origin/dev` at `b4eec295` (version `4.260420.5`)
- `rev-list --left-right --count origin/dev...HEAD` = **3616 / 2962** (local is 3616 behind, 2962 ahead with orphan commits)
- The 2962 local-ahead commits appear to be someone's WIP — risky to rebase/squash

**Options to unblock:**
1. Fresh clone of `automagik-dev/genie` into `~/dev/genie-fresh/` — work exclusively there for this wish, leave `repos/genie` alone
2. Investigate what the 2962 local commits represent; if discardable, hard-reset `repos/genie` to `origin/dev`
3. Ask workspace owner what the 2962 commits are for before any action

**Recommendation**: **option 1** (fresh clone), safest.

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Fresh clone may lack workspace-specific tooling | Low | Stick to vanilla `git clone`, run `bun install`, should just work per CLAUDE.md at repo root |
| Tailer duplicates spans on process restart | Medium | Persist cursor (last `id`) in a small control table; restart resumes from persisted offset |
| OTel span parent-child linking may not match Genie's `thread_id`/`parent_event_id` semantics perfectly | Medium | Map carefully: `trace_id` → OTel trace_id, `parent_event_id` → OTel parent_span_id. Test relationships in integration test |
| Upstream PR review latency | Medium | Fork-build bridge until merge |
| Header naming drift (`x-trace-id` vs `traceparent`) | Low | Always read both; emit both on outbound in Omni |

## References

- Parent DESIGN: [`.genie/brainstorms/observability-hub/DESIGN.md`](../../brainstorms/observability-hub/DESIGN.md)
- Omni-side dual-header emit: `observability-hub-p2-producers` group 2.2
- Genie source (stale local): `/home/genie/dev/workspace-genies/agents/genie/repos/genie/`
- Genie source (remote): `github.com/automagik-dev/genie` branch `dev`
- Current state of `runtime-events.ts` on origin/dev: line 153 has `trace_id: string | null`
- Current state of `omni-bridge.ts` on origin/dev: line 726 `const data = this.sc.decode(msg.data)` — header extraction gap
- NULL evidence query: `SELECT count(*) FROM genie_runtime_events WHERE source='mailbox' AND trace_id IS NULL` on local Genie pgserve returned rows
