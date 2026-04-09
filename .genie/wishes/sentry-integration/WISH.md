# Wish: Sentry Integration (MCP + SDK + Privacy)

**Status:** SHIPPED
**Slug:** sentry-integration
**Date:** 2026-03-10
**Brainstorm:** `.genie/brainstorms/sentry-mcp/`

---

## Summary

Embed `@sentry/bun` in the Omni API server to capture errors, tracing, AI cost metrics, cron health, and feature usage analytics — while guaranteeing zero user PII (message content, phone numbers, chat names) ever reaches Sentry. Additionally, configure the Sentry MCP server so Claude Code can query issues directly.

## Scope

### IN
- Sentry MCP server configuration for Claude Code (remote OAuth)
- `@sentry/bun` SDK integration in `packages/api`
- PII scrubbing layer (`beforeSend`, `beforeBreadcrumb`, `beforeSendTransaction`, `beforeSendSpan`)
- Error capture (5xx only via error middleware)
- HTTP request tracing (auto via `bunServerIntegration`)
- PostgreSQL query tracing (auto via `postgresIntegration`)
- AI model tracing — tokens/cost only, no prompts (auto via `anthropicAIIntegration`)
- Cron monitoring for 6 scheduled jobs (`Sentry.withMonitor`)
- Custom tags (channelType, instanceId, cliVersion, agentProvider)
- Custom metrics (messages received/sent, agent dispatch, connections)
- Graceful shutdown with `Sentry.close()`
- Env vars + `.env.example` documentation

### OUT
- Browser/UI Sentry SDK (frontend error tracking)
- CLI-side Sentry SDK (CLI runs on user machines, not our infra)
- Profiling (`@sentry/profiling-node` doesn't work on Bun)
- Sentry Relay (only needed for on-prem LGPD compliance — defer)
- NATS queue span instrumentation (Tier 3 — manual, low ROI now)
- Sentry Alerts/Dashboards configuration (UI-only, no code needed — do manually after)
- Structured Logs (`Sentry.logger.*` — defer to Tier 3)
- Source maps upload (Bun runs TS directly)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| SDK package | `@sentry/bun` | Official first-class Bun SDK; auto-instruments `Bun.serve()` |
| Init strategy | Top of `index.ts` before all imports | Sentry must load before other modules to hook into runtime |
| Error capture scope | 5xx only | 4xx are expected client errors (validation, not-found); already handled correctly |
| AI prompt capture | Disabled via `sendDefaultPii: false` | Prompts contain WhatsApp message content — tokens/cost only |
| PII strategy | 3-layer (SDK scrub → server-side rules → no Relay) | SDK `beforeSend` catches it before leaving server; server-side regex as safety net |
| Request data capture | URL only — no body, headers, cookies, query strings | CLI sends message content + phone numbers in POST bodies |
| Opt-in activation | `SENTRY_DSN` env var — absent = no-op | OSS users choose whether to enable; no forced telemetry |
| Traces sample rate | 10% default, configurable via `SENTRY_TRACES_SAMPLE_RATE` | Balance observability vs volume |
| Cron monitoring | `Sentry.withMonitor()` wrapping existing scheduler jobs | Non-invasive — wraps existing job handlers |

## Success Criteria

- [ ] `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` completes successfully
- [ ] `@sentry/bun` is in `packages/api/package.json` dependencies
- [ ] API starts normally with `SENTRY_DSN` set (Sentry active)
- [ ] API starts normally without `SENTRY_DSN` (Sentry no-op, no errors)
- [ ] Throwing a test 5xx error produces an event in Sentry dashboard
- [ ] A 4xx error (e.g., validation) does NOT produce a Sentry event
- [ ] HTTP requests appear as transactions in Sentry Performance
- [ ] PG queries appear as spans under HTTP transactions
- [ ] AI calls show model name + token counts in Sentry AI dashboard (no prompt content)
- [ ] 6 scheduled jobs appear as Cron Monitors in Sentry
- [ ] Phone numbers in error messages are scrubbed to `[phone]` before sending
- [ ] WhatsApp JIDs in error contexts are scrubbed to `[jid]` before sending
- [ ] Request bodies never appear in Sentry events
- [ ] `SENTRY_DSN` documented in `.env.example`
- [ ] Graceful shutdown flushes pending Sentry events

## Assumptions & Risks

| Risk | Mitigation |
|------|-----------|
| `@sentry/bun` is beta — edge cases possible | Pin version, test thoroughly, can disable via `SENTRY_DSN` removal |
| PII scrubbing regex misses an edge case | 3-layer defense: SDK regex + server-side regex + no request body capture |
| `postgresIntegration` doesn't work with Drizzle's pg driver on Bun | Falls back gracefully — no DB spans but errors/HTTP still work |
| AI integration captures prompt data despite `sendDefaultPii: false` | Verify in test; add `beforeSendSpan` scrub for `gen_ai.*` attributes as safety net |
| Sentry overhead in hot path | Async fire-and-forget; 10% trace sampling; `ignoreTransactions` for healthchecks |

---

## Execution Groups

### Group 1: PII Scrubbing Module

**Goal:** Create a standalone, testable PII scrubbing module that all Sentry hooks use.

**Deliverables:**
- [ ] New file `packages/api/src/lib/sentry-scrub.ts` with:
  - `scrubPii(text: string): string` — regex replace phone numbers (`\+?\d{10,15}` → `[phone]`), WhatsApp JIDs (`\d+@[sc]\.whatsapp\.net` → `[jid]`), email addresses. Note: Discord snowflake regex (`\d{17,22}`) has false-positive risk on large numbers — only apply when channelType context is `discord`, or document the tradeoff.
  - `scrubEvent(event: SentryEvent): SentryEvent` — walks exception values, contexts, extras, breadcrumbs, request data and applies `scrubPii`. Also strips `event.server_name` and `event.tags?.server_name` (hostname leaks infrastructure topology).
  - `scrubTransaction(event: SentryEvent): SentryEvent` — parameterizes transaction names (phone → `:phone`, UUID → `:uuid`, JID → `:jid`)
  - `scrubBreadcrumb(breadcrumb): breadcrumb | null` — scrubs console breadcrumb data, HTTP URLs; drops breadcrumbs with message content patterns
  - `scrubSpan(span): span` — scrubs `db.statement` params, `http.url` paths
- [ ] Unit tests in `packages/api/src/lib/__tests__/sentry-scrub.test.ts` covering:
  - Phone numbers in various formats (+55, 5511, with/without country code)
  - WhatsApp JIDs (123456789@s.whatsapp.net, @c.whatsapp.net)
  - Error messages with embedded PII (from known leak points in messages.ts, chats.ts, persons.ts)
  - Clean strings pass through unchanged
  - Nested object scrubbing (OmniError context)
  - Edge cases: short numbers (not phone), UUIDs, normal text

**Acceptance:**
- All regex patterns match known PII formats from codebase audit
- Unit tests pass with 100% coverage on scrub functions

**Validation:**
```bash
cd packages/api && bun test src/lib/__tests__/sentry-scrub.test.ts
```

---

### Group 2: Sentry SDK Init + Shutdown

**Goal:** Wire up `@sentry/bun` in the API entry point with all config, privacy hooks, and graceful shutdown.

**Depends on:** Group 1 (scrub module)

**Deliverables:**
- [ ] `bun add @sentry/bun` in `packages/api`
- [ ] New file `packages/api/src/instrument.ts`:
  - `Sentry.init()` with DSN from env, release from package.json, environment from NODE_ENV
  - `sendDefaultPii: false`
  - `maxBreadcrumbs: 30` (reduced from default 100 to limit PII exposure window)
  - `requestDataIntegration` configured: URL only (no body, headers, cookies, query_string, ip, user)
  - `beforeSend` → calls `scrubEvent()` from Group 1
  - `beforeSendTransaction` → calls `scrubTransaction()`
  - `beforeSendSpan` → calls `scrubSpan()`
  - `beforeBreadcrumb` → calls `scrubBreadcrumb()`
  - `ignoreErrors`: ECONNRESET, ETIMEDOUT, socket hang up
  - `ignoreTransactions`: healthcheck, favicon, metrics
  - `tracesSampleRate` from `SENTRY_TRACES_SAMPLE_RATE` env (default 0.1)
  - Conditional init: if no `SENTRY_DSN`, skip init entirely (no-op)
- [ ] `packages/api/src/index.ts` imports `./instrument.ts` as first import (line 1)
- [ ] Graceful shutdown: `await Sentry.close(5000)` added before `process.exit(0)` in shutdown handler
- [ ] `SENTRY_DSN`, `SENTRY_TRACES_SAMPLE_RATE`, `SENTRY_ENVIRONMENT` added to `.env.example` with section heading:
  ```
  # -----------------------------------------------------------------------------
  # Sentry (Error Tracking & Performance Monitoring)
  # -----------------------------------------------------------------------------
  # SENTRY_DSN=https://...@o123.ingest.sentry.io/456
  # SENTRY_TRACES_SAMPLE_RATE=0.1
  # SENTRY_ENVIRONMENT=development
  ```
- [ ] Unit test `packages/api/src/lib/__tests__/instrument.test.ts`:
  - Verifies `Sentry.getClient()` returns configured client when DSN is set
  - Verifies `Sentry.getClient()` returns undefined when DSN is absent
  - Verifies `sendDefaultPii` is `false` on the client options

**Acceptance:**
- API starts with `SENTRY_DSN` set — no errors, Sentry logs confirm init
- API starts without `SENTRY_DSN` — no errors, no Sentry output
- Shutdown flushes pending events
- instrument.ts unit tests pass

**Validation:**
```bash
# With valid-format DSN - should show Sentry init log
SENTRY_DSN=https://test@o0.ingest.sentry.io/0 bun run packages/api/src/index.ts 2>&1 | head -20
# Without DSN - should start normally, no Sentry mentions
bun run packages/api/src/index.ts 2>&1 | head -20
# Unit tests
cd packages/api && bun test src/lib/__tests__/instrument.test.ts
```

---

### Group 3: Error Capture in Middleware

**Goal:** Capture 5xx server errors to Sentry with rich context tags.

**Depends on:** Group 2 (Sentry init)

**Deliverables:**
- [ ] `packages/api/src/middleware/error.ts` modified:
  - Import `* as Sentry from '@sentry/bun'`
  - In the `errorHandler` function, server error branch (line ~337): add `Sentry.withScope()` block
  - Set tags: `request_id`, `http.method`, `http.url` (path only)
  - Set tag `cli_version` from `x-omni-cli-version` header (if present)
  - For `OmniError`: tag `error.code`, extra `error.context` (raw — PII scrubbing handled by `beforeSend` hook from Group 1, do NOT scrub inline to avoid double processing)
  - Call `Sentry.captureException(error)`
  - Do NOT capture for `isClientError === true`

**Acceptance:**
- Throwing a test error from a route handler produces a Sentry event
- The event has tags: request_id, http.method, http.url, error.code
- 4xx errors (ZodError, NotFoundError, etc.) do NOT produce events
- No PII in captured events (verified by scrub module)

**Validation:**
```bash
cd packages/api && bun test src/__tests__/middleware-error.test.ts
```

---

### Group 4: Cron Monitoring

**Goal:** Wrap all 6 scheduled jobs with `Sentry.withMonitor()` so missed/failed runs alert.

**Depends on:** Group 2 (Sentry init)

**Deliverables:**
- [ ] `packages/api/src/scheduler.ts` modified:
  - Import `* as Sentry from '@sentry/bun'`
  - Wrap each job's `handler` with `Sentry.withMonitor(monitorSlug, handler, monitorConfig)`
  - Monitor config per job:

    | Job | Slug | Cron | checkinMargin (min) | maxRuntime (min) |
    |-----|------|------|---------------------|-----------------|
    | Dead letter retry | `dead-letter-auto-retry` | `*/15 * * * *` | 5 | 10 |
    | Payload cleanup | `payload-cleanup` | `0 3 * * *` | 10 | 30 |
    | Dead letter cleanup | `dead-letter-cleanup` | `0 3 * * *` | 10 | 15 |
    | Contacts sync | `contacts-sync-daily` | `0 4 * * *` | 15 | 60 |
    | Groups sync | `groups-sync-daily` | `0 5 * * *` | 15 | 60 |
    | Unread refresh | `unread-count-refresh` | `0 * * * *` | 5 | 5 |
  - Conditional: only wrap if `sentryEnabled()` helper returns true (uses `Sentry.getClient()`) so no-op without Sentry

**Acceptance:**
- All 6 jobs appear as Cron Monitors in Sentry UI
- A successful job run shows status "ok"
- A failing job run shows status "error"
- Without `SENTRY_DSN`, scheduler works exactly as before

**Validation:**
```bash
cd packages/api && bun test src/__tests__/scheduler.test.ts 2>/dev/null || echo "manual verification needed"
```

---

### Group 5: Custom Tags + Metrics

**Goal:** Add per-request tags and business metrics for usage analytics.

**Depends on:** Group 2 (Sentry init)

**Deliverables:**
- [ ] New middleware or hook in request pipeline to set Sentry tags from request context:
  - `cli_version` from `x-omni-cli-version` header
  - `channel_type` when available from route context
  - `instance_id` (parameterized) when available
- [ ] Agent dispatcher: emit `Sentry.metrics.count("agent.dispatch", 1, { attributes: { provider_type, model } })` on each dispatch
- [ ] Agent dispatcher: emit `Sentry.metrics.distribution("agent.dispatch.latency", durationMs, { unit: "millisecond", attributes: { provider_type } })` after each response
- [ ] Event persistence plugin: emit `Sentry.metrics.count("messages.received", 1, { attributes: { channel_type } })` on message received
- [ ] Message send routes: emit `Sentry.metrics.count("messages.sent", 1, { attributes: { channel_type } })`
- [ ] Instance monitor: emit `Sentry.metrics.gauge("instance.connections", count, { attributes: { channel_type } })` on health check cycle
- [ ] All metric calls guarded: only emit if `Sentry.getClient()` returns truthy (documented API for checking init state — `isInitialized()` does not exist). Create helper: `const sentryEnabled = () => !!Sentry.getClient()` in `sentry-scrub.ts` for reuse.

**Acceptance:**
- Sentry Metrics dashboard shows custom metrics after API runs with traffic
- Agent dispatch metrics show provider_type breakdown
- No PII in any metric attributes (only enum values and counts)

**Validation:**
```bash
# Positive: verify expected metric calls exist (should be 6+)
grep -r 'Sentry\.metrics\.\(count\|gauge\|distribution\)' packages/api/src/ | wc -l
# Negative: verify no PII in metric attribute values
grep -r 'Sentry.metrics' packages/api/src/ | grep -viE 'channel_type|provider_type|model|job_type|unit'
# Should return empty (no unexpected attributes)
# Unit test: mock Sentry.metrics and verify calls with expected attributes
cd packages/api && bun test src/__tests__/sentry-metrics.test.ts
```

---

### Group 6: Sentry MCP Server (type: manual)

**Goal:** Configure the remote Sentry MCP server for Claude Code.

**Depends on:** Nothing (independent)

**Deliverables:**
- [ ] Run `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp`
- [ ] Complete OAuth authentication flow in browser
- [ ] Select relevant tool groups (Issues, Events, AI/Seer, Core)
- [ ] Verify access: query Omni project issues from Claude Code

**Acceptance:**
- `/mcp` in Claude Code shows Sentry server as connected
- Can run a Sentry query (e.g., list project issues) from Claude Code
- MCP tools appear in tool list

**Validation:**
```bash
claude mcp list 2>&1 | grep -i sentry
```

---

### Group 7: Server-Side Scrubbing Rules (type: manual)

**Goal:** Configure server-side scrubbing as a safety net in the Sentry project settings.

**Depends on:** Group 2 (need events flowing to configure)

**Deliverables:**
- [ ] In Sentry Project Settings > Security & Privacy:
  - Enable "Prevent Storing of IP Addresses"
  - Add sensitive fields: `phoneNumber`, `chatName`, `messageContent`, `senderName`, `recipientName`, `groupName`
- [ ] In Advanced Data Scrubbing, add rules:
  - `[Remove] [Regex: \+?\d{10,15}] from [**]` (phone numbers)
  - `[Remove] [Regex: \d+@[sc]\.whatsapp\.net] from [**]` (WhatsApp JIDs)
  - `[Remove] [Email Addresses] from [**]`
  - `[Remove] [Anything] from [$http.data]` (request body safety net)
  - `[Remove] [Anything] from [$http.query_string]`

**Acceptance:**
- Server-side rules are active in Sentry project settings
- A test event with a phone number in extras gets the number scrubbed server-side

**Validation:**
Manual verification in Sentry UI — check project Security & Privacy settings page.

---

## Dependencies

```
Group 1 (scrub module) ← independent, start first
Group 2 (init/shutdown) ← depends on Group 1
Group 3 (error capture) ← depends on Group 2
Group 4 (cron monitoring) ← depends on Group 2
Group 5 (tags/metrics) ← depends on Group 2
Group 6 (MCP server) ← independent, can run in parallel with all
Group 7 (server-side rules) ← depends on Group 2 (need events flowing)
```

**Execution order:**
- **Parallel wave 1:** Group 1 + Group 6
- **Sequential:** Group 2 (after Group 1)
- **Parallel wave 2:** Group 3 + Group 4 + Group 5 (after Group 2)
- **Final:** Group 7 (after events are flowing)

---

## Rollback

Since `@sentry/bun` is beta, here's the rollback path if issues arise:

**Quick disable (no code change):**
- Remove `SENTRY_DSN` from environment — Sentry becomes a complete no-op

**Full removal:**
1. `cd packages/api && bun remove @sentry/bun`
2. Delete `packages/api/src/instrument.ts`
3. Remove the `import './instrument.ts'` line from `packages/api/src/index.ts`
4. Remove `Sentry.close(5000)` from shutdown handler in `index.ts`
5. Remove `Sentry.captureException()` and `Sentry.withScope()` from `middleware/error.ts`
6. Remove `Sentry.withMonitor()` wrappers from `scheduler.ts`
7. Remove all `Sentry.metrics.*` calls from dispatcher, plugins, routes
8. Delete `packages/api/src/lib/sentry-scrub.ts` and its tests
