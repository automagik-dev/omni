# Wish: Session Observatory & Self-Improvement Loop

**Status:** DRAFT
**Slug:** `session-observatory`
**Created:** 2026-02-10
**Depends on:** `openclaw-provider-integration` (Phase 1 must ship first)
**Council:** R3 unanimously recommended splitting from provider integration. 16 must-fix items below.

---

## Summary

Build the observability and review layer for OpenClaw agent sessions. Browse heartbeats and tasks, review agent work (human or AI), track metrics (tokens, cost, speed), and create a self-improvement feedback loop.

> "Every agent in its main session will be eternal. Tasks will be disposable sessions, used and reset as much as needed, UNTIL THE SHIPPING IS DONE." — Felipe

**Two session types:**
- **Main sessions** — eternal, per-agent consciousness (`agent:sofia:main`)
- **Task sessions** — disposable, spawned for work, archived when shipped (`agent:sofia:subagent:*`)

---

## Vision

- List all heartbeats across agents, filterable by agent, title, status
- List all tasks with status (pending → running → completed → archived)
- Review each heartbeat/task: did it accomplish its work?
- Summary + verdict (human or AI review)
- Metrics per task: token usage, cost, speed, time-to-completion
- Use reviews to self-improve: better heartbeats, better task execution

---

## Council R3 Must-Fix Items (from provider integration review)

These must be resolved before this wish goes to /forge:

### BLOCKER
| # | Issue | Source |
|---|-------|--------|
| 1 | Schema files go in `packages/db/src/schema.ts` (existing pattern) or update drizzle config | Operator, Deployer |

### HIGH
| # | Issue | Source |
|---|-------|--------|
| 2 | Unify user auth with existing API key system (no second apiKey column) | Sentinel, Ergonomist, Questioner |
| 3 | Define explicit role → scope mapping (viewer→sessions:read, etc.) | Sentinel |
| 4 | session_metrics population mechanism undefined (batch? view? real-time?) | Measurer, Benchmarker |
| 5 | Session sync failure behavior undefined (retry, circuit breaker, staleness indicator) | Operator, Benchmarker |
| 6 | No join path between trigger_logs and session_reviews (need sessionKey column) | Tracer |
| 7 | Token availability from OpenClaw unverified (add to Group 0 spike or separate spike) | Measurer |

### MEDIUM
| # | Issue | Source |
|---|-------|--------|
| 8 | Group E scope unrealistic — split into E1 (session list/review) + E2 (dashboard/charts) | Ergonomist |
| 9 | No charting library acknowledged (UI has no chart dep today) | Ergonomist |
| 10 | Remove tRPC claim — no tRPC exists in codebase, use Hono + Zod only | Ergonomist, Architect |
| 11 | Session detail proxy-vs-cache strategy undefined | Tracer |
| 12 | Self-improvement view → Phase 3 (underspecified, needs review volume first) | Tracer, Measurer, Architect |
| 13 | Drop session_metrics table — use aggregate queries over trigger_logs | Architect |
| 14 | Drop Group F (User Management) — use existing api_keys auth, add createdByApiKeyId on reviews | Architect, Questioner |
| 15 | Flatten routes — `/api/v2/sessions` with query filters, not `/api/v2/sessions/openclaw` | Architect |
| 16 | session_reviews should be provider-agnostic — reference trigger_logs, not OpenClaw-specific | Architect |

---

## Khal Reference Patterns

The `khal` repo (`/home/genie/workspace/repos/khal/`) has working patterns to adapt:
- `Bun.serve()` with `fetch(req)` routing (1800-line server.ts)
- Drizzle ORM + pgserve (embedded PostgreSQL)
- Session/agent/version tables with proper relations
- `sessionStatusEnum`: pending, running, completed, failed, archived
- Makefile, PM2, environment patterns

Adapt into Omni's existing `packages/api/` (Hono + Zod) rather than creating a separate service.

---

## Rough Execution Groups (to be refined)

### Group D: Session Schema & Sync API
- Drizzle tables for session metadata + reviews
- API endpoints for listing/filtering sessions
- OpenClaw session sync mechanism

### Group E1: Session List & Review UI
- Filterable table of heartbeats/tasks per agent
- Session detail view with conversation transcript
- Review form (verdict, rating, summary)

### Group E2: Dashboard & Metrics (separate from E1)
- Agent dashboard with aggregate metrics
- Charts (requires charting library decision)
- Performance trends over time

### Self-Improvement (Phase 3 — after review volume exists)
- Comparison across time periods
- Pattern detection from reviews
- AI-generated improvement suggestions

---

_This wish was split from `openclaw-provider-integration` per unanimous council recommendation (R3, 10/10). Phase 1 (provider plumbing) ships first, then this builds on top._
