# Sentry Product Features — Exhaustive Research Report

> **Context**: Evaluating Sentry product features for the **Omni** project — a Bun-based omnichannel messaging platform (backend-only API server, no browser frontend).
>
> **Date**: 2026-03-10
> **Source**: https://docs.sentry.io/product/

---

## Table of Contents

1. [Error Monitoring / Issues](#1-error-monitoring--issues)
2. [Performance Monitoring / Tracing](#2-performance-monitoring--tracing)
3. [Profiling](#3-profiling)
4. [Backend Insights (Queries, HTTP, Caches, Queues)](#4-backend-insights)
5. [Releases & Release Health](#5-releases--release-health)
6. [Alerts & Notifications](#6-alerts--notifications)
7. [Dashboards & Discover](#7-dashboards--discover)
8. [Cron Monitoring](#8-cron-monitoring)
9. [Uptime Monitoring](#9-uptime-monitoring)
10. [User Feedback](#10-user-feedback)
11. [Metrics](#11-metrics)
12. [Session Replay](#12-session-replay)
13. [AI Features (Seer, Autofix, Issue Summary, Query Assistant)](#13-ai-features-in-sentry)
14. [AI Agent Monitoring (LLM/AI Pipelines)](#14-ai-agent-monitoring)
15. [Logs](#15-logs)
16. [Relay](#16-relay)
17. [Stats & Quota Management](#17-stats--quota-management)
18. [Data Scrubbing & Privacy](#18-data-scrubbing--privacy)
19. [Bun SDK Specifics](#19-bun-sdk-specifics)

---

## 1. Error Monitoring / Issues

### What It Does
- **Automatic error capture**: Catches unhandled exceptions, unhandled rejections, and uncaught errors automatically.
- **Issue grouping**: Groups similar error events into "issues" using fingerprints. Events with the same fingerprint → same issue.
- **Issue categories**: Error issues (grouped errors) and Performance issues (grouped poorly-performing transactions).
- **Issue states**: Unresolved → For Review → Resolved → Regressed → Archived → Escalating.
- **Issue priority**: Prioritization mechanism for actionability (can be auto-assigned or manual).
- **Ownership rules**: Automatic assignment to responsible team members based on code paths.
- **Suspect commits**: Identifies commits likely responsible for an error, suggests the author as assignee.
- **Reprocessing**: Re-analyze error events with updated debug files/source maps.
- **Saved searches**: Persist custom issue queries.

### Grouping & Fingerprinting
- **Default grouping**: Analyzes stack traces, exception types, and messages to cluster events.
- **Custom grouping (4 methods)**:
  1. **Merge issues** in UI (combines existing issues).
  2. **Fingerprint rules** — pattern-matching rules (error type, message, file path) to assign specific fingerprints.
  3. **Stack trace rules** — adjust which frames factor into grouping (useful for middleware noise).
  4. **SDK-side fingerprinting** — set custom fingerprints in code before events are sent.

### Issue Details (per issue)
- Stack traces with exact error line
- Breadcrumbs (timeline of events leading to error: HTTP requests, console logs, server logs)
- Tags (indexed key/value pairs — searchable)
- Contexts (structured key/value objects — not searchable)
- HTTP request info (query strings, cookies, headers)
- Packages and versions
- Span evidence (for performance context)
- Additional SDK-provided data

### Auto-Detected Performance Issues (Server/Backend-Relevant)
| Issue Type | What It Detects |
|---|---|
| **N+1 Queries** | Redundant database queries in loops |
| **Consecutive DB Queries** | Sequential database queries that could be batched |
| **Slow DB Queries** | Underperforming database operations |
| **Function Regressions** | Performance degradation in functions over time |
| **Endpoint Regressions** | Endpoint performance decline over releases |

### SDK Configuration Required?
- **Basic error capture**: Minimal — just initialize the SDK with DSN. Errors are captured automatically.
- **Custom fingerprints**: SDK-side code changes needed if using SDK fingerprinting.
- **Breadcrumbs**: Auto-captured for HTTP/console; custom breadcrumbs require SDK calls.
- **Tags/Contexts**: Optional SDK enrichment via `Sentry.setTag()` / `Sentry.setContext()`.

### Backend Relevance: **HIGH** ⭐⭐⭐
Core feature for any backend server. Captures all unhandled errors, groups them intelligently, tracks regressions.

### Privacy Implications
- **Stack traces**: Contain function names, file paths, line numbers — typically not PII.
- **Breadcrumbs**: May capture HTTP URLs, request headers, cookies — potential PII.
- **Tags/Contexts**: Whatever you set; could contain user IDs, emails if configured.
- **HTTP request data**: Query strings, headers, cookies — can contain PII.
- **Mitigation**: Use `sendDefaultPii: false` (default), configure server-side scrubbing, use `beforeSend` hook to filter.

---

## 2. Performance Monitoring / Tracing

### What It Does
- **Distributed tracing**: Tracks requests flowing across multiple services end-to-end.
- **Traces** = collections of transactions and spans sharing a `trace_id`.
- **Transactions** = one per service instance per operation.
- **Spans** = individual units of work (DB query, HTTP call, function execution).
- **Auto-instrumentation**: Automatically instruments libraries (HTTP requests, DB queries, file I/O, etc.).

### Key Features
- **Trace View / Waterfall**: Visualizes entire trace as a chronological waterfall. Shows operation hierarchy, durations, errors.
- **Trace Explorer**: Manual investigation — slice and dice performance data by any attribute. Percentile calculations (p50, p75, p95, p99).
- **Transaction Summary**: Per-transaction view with TPM/TPS throughput, failure rate, duration percentiles, related issues, suspect spans/tags.
- **Performance Issues**: Auto-detect N+1 queries, consecutive DB queries, slow queries, endpoint regressions, function regressions (see table above).

### Distributed Tracing Mechanics
- **Head-based sampling**: Sampling decision made in the originating service, propagated via headers to downstream services.
- **Trace propagation**: `sentry-trace` and `baggage` headers attach to outgoing requests. Controlled via `tracePropagationTargets` SDK option.
- **Dynamic sampling**: Retains all transactions in a trace if the head transaction is preserved — prevents fragmented traces.

### SDK Configuration Required?
- **Enable**: Set `tracesSampleRate` (0 to 1) or use `tracesSampler` function for dynamic sampling.
- **Distributed tracing**: Configure `tracePropagationTargets` to control which outgoing requests get trace headers.
- **Custom spans**: Use `Sentry.startSpan()` for custom instrumentation.
- **Auto-instrumentation**: Works automatically when using `--preload` flag with Bun SDK (not bundled code).

### Backend Relevance: **HIGH** ⭐⭐⭐
Essential for understanding API endpoint performance, identifying slow database queries, tracking cross-service latency.

### Privacy Implications
- **Transaction names**: Typically URL paths — may contain user IDs in URL params.
- **Span descriptions**: DB query text (parameterized — values replaced with placeholders), HTTP URLs, operation names.
- **Headers**: If `sendDefaultPii: true`, captures request headers which may contain auth tokens.
- **Mitigation**: Keep `sendDefaultPii: false`, use `beforeSendTransaction` hook, configure `tracePropagationTargets` carefully.

---

## 3. Profiling

### What It Does
Provides **function-level visibility** into application execution in production. Shows exactly where CPU time is consumed at the code level — deeper than tracing (which captures high-level operations).

### Two Modes
1. **Continuous Profiling**: Always-on monitoring of backend services. Identifies costly code paths driving infrastructure costs.
2. **UI Profiling**: For browser/mobile — analyzes user flows for jank, rendering delays. **Not relevant for backend.**

### Visualization
- **Flamegraphs**: Visualize call stacks across threads. Shows function hierarchy, execution time, and frequency.
- **Thread selection**: View one thread at a time.
- **Sorting**: Chronological, alphabetical, left-heavy (highest weight first).
- **Tree View**: Function hierarchy with duration and type (application vs. system).
- **Minimap**: Zoomed-out navigation for large profiles.

### SDK Platforms Supported
Android, iOS/macOS, Python, Node.js, PHP, JavaScript (browser), Ruby, React Native, Flutter, .NET, JVM — most stable, some beta/experimental.

### SDK Configuration Required?
- **Continuous profiling**: Set `profileSessionSampleRate` (0 to 1).
- **Trace-linked profiling**: Set `profileLifecycle: 'trace'` + `profilesSampleRate`.
- Legacy `profilesSampleRate` is deprecated in favor of `profileSessionSampleRate`.

### Backend Relevance: **HIGH** ⭐⭐⭐
Continuous profiling is specifically designed for backend services. Identifies which functions consume the most CPU, enabling targeted optimization without custom instrumentation.

### Privacy Implications
- **Function names and file paths**: Exposed in flamegraphs. Typically not PII.
- **No user data captured**: Profiling captures execution paths and timing, not input data.
- **Low PII risk**: Function call stacks don't typically contain user information.

---

## 4. Backend Insights

### Overview
High-level dashboards for backend performance, auto-populated when tracing is enabled.

### 4a. Database/Query Monitoring

**What It Tracks**:
- All database queries (SQL dialects + MongoDB)
- Query duration and throughput
- Most time-consuming queries
- Parameterized query text (values replaced with `?`, `%s`, `:c0`, `$1` — protects sensitive data)
- Query simplification (removes table prefixes, collapses long argument lists)

**Auto-Instrumentation**: Works without configuration when tracing is enabled. Manual instrumentation available for custom spans (set `op` to DB operation, `db.system` to identify DB type).

**Backend Relevance**: **HIGH** ⭐⭐⭐ — Critical for PostgreSQL monitoring in Omni.

**Privacy**: Query values are **parameterized by default** — raw user data not captured. Query structure (table/column names) is visible.

### 4b. Outbound HTTP Request Monitoring

**What It Tracks**:
- All outgoing HTTP requests your app makes
- Domain-level metrics (grouped by parameterized hostname)
- Average response duration and throughput
- HTTP response status code breakdown (3xx, 4xx, 5xx percentages)
- Time spent per domain
- Individual transaction drill-down

**Auto-Instrumentation**: "Most cases, Sentry's SDKs automatically enable HTTP request tracking." Custom instrumentation available for Python/JavaScript.

**Backend Relevance**: **HIGH** ⭐⭐⭐ — Critical for monitoring outbound calls to WhatsApp/Telegram/Discord/Slack APIs, webhook delivery, LLM API calls.

**Privacy**: URLs are captured — may contain tokens in query strings. Use `beforeSendSpan` to scrub if needed.

### 4c. Cache Monitoring

**What It Tracks**:
- Cache hit/miss rates
- Cache latency
- Transactions performing cache lookups

**Auto-Instrumentation**: Only for Django's cache framework. **All others (including Node.js/Bun) require custom instrumentation** using SDK-provided cache span APIs.

**Backend Relevance**: **MEDIUM** ⭐⭐ — Relevant if Omni uses Redis caching. Requires manual instrumentation for Node.js/Bun.

**Privacy**: Cache keys may contain user identifiers. Parameterization depends on custom instrumentation.

### 4d. Queue Monitoring

**What It Tracks**:
- Queue consumer/producer performance
- Error rates across message processing
- Individual message traces
- Destination-specific metrics

**Auto-Instrumentation**: Only for **Celery (Python)**. All other queue systems (BullMQ, etc.) **require custom instrumentation**.

**Backend Relevance**: **MEDIUM** ⭐⭐ — Relevant if Omni uses BullMQ or similar. Requires manual span creation.

**Privacy**: Message content not captured by default — only performance metrics and operation metadata.

---

## 5. Releases & Release Health

### What It Does
- **Release tracking**: Associates errors and performance data with specific code versions.
- **Deploy tracking**: Monitors when releases are deployed to environments.
- **Issue attribution**: Identifies which release introduced an issue.
- **Suspect commits**: Predicts which commit caused an issue.
- **Auto-resolve**: Resolve issues via commit messages.

### Release Health Metrics
| Metric | Description |
|---|---|
| **Crash-Free Sessions** | % of sessions not ended by crashes |
| **Crash-Free Users** | % of distinct users avoiding crashes |
| **Active Sessions** | Sessions started in last 24 hours |
| **Adoption Rate** | Session/user count per release as % of all releases |
| **Adoption Stages** | Adopted (≥10%), Low Adoption (<10%), Replaced |

### Session Types
- **User-mode/Application-mode**: Begin on app start, end on close/background (30+ sec).
- **Server-mode/Request-mode**: Correspond to HTTP requests/RPC calls. Start on request receive, end on response. **This is what Omni would use.**
- SDK auto-detects which mode applies.

### Session Statuses
| Status | Meaning |
|---|---|
| **Healthy** | Normal termination, no errors |
| **Errored** | Normal shutdown but had handled errors |
| **Crashed** | Explicit unhandled errors or hard crashes |
| **Abnormal** | Unclear termination (timeout, forcible shutdown) |

### SDK Configuration Required?
- **Release version**: Set `release` option in SDK init or `SENTRY_RELEASE` env var.
- **Environment**: Set `environment` option (default: `production`).
- **Session tracking**: Many SDKs auto-manage session start/end. Server-mode sessions auto-track per HTTP request.
- **Source maps**: Upload via `sentry-cli` or build plugin for readable stack traces.
- **Commits**: Integrate with GitHub/GitLab for suspect commits.

### Backend Relevance: **HIGH** ⭐⭐⭐
Essential for tracking deployment health, identifying regressions, correlating errors with releases.

### Privacy Implications
- **Release names**: Typically version strings — no PII.
- **Session data**: Captures user identifiers (if configured) for crash-free user metrics. Sessions are "not subject to inbound filters or sampling."
- **Commit data**: Author names/emails from git history.
- **Mitigation**: Don't set user context if not needed. Sessions are non-billable.

---

## 6. Alerts & Notifications

### What It Does
Alert when specific conditions are met across your error, performance, uptime, and cron data.

### Alert Types

#### Issue Alerts
- **Trigger**: When an issue matches specific criteria (new issue, regression, frequency increase, resolved→unresolved).
- **Components**: Triggers (when) → Filters (if) → Actions (then).
- **Actions**: Email, Slack, PagerDuty, webhook, create Jira/GitHub issue, etc.

#### Metric Alerts
- **Trigger**: When aggregate metrics cross thresholds.
- **Monitorable metrics**:
  - Total errors in project
  - Latency (min, max, avg, percentile)
  - Failure rates
  - Crash-free session/user rates
  - Throughput (TPM/TPS)
  - Apdex score
  - Custom metrics
- **Features**: Dynamic alerts, custom metric filtering.

#### Uptime Alerts
- **Trigger**: When HTTP checks fail to return successful responses.
- **Configuration**: URL, method, headers, body, thresholds.

#### Cron Monitor Alerts
- **Trigger**: When scheduled jobs miss check-ins, exceed runtime, or fail.

#### User Feedback Alerts
- **Trigger**: When new user feedback is submitted.

### Notification Types Beyond Alerts
- Issue state changes
- Release deployments
- Quota usage warnings

### SDK Configuration Required?
- **None** — Alerts are configured entirely in the Sentry UI.
- Alert rules, conditions, and actions are all server-side.

### Backend Relevance: **HIGH** ⭐⭐⭐
Critical for operational awareness. Issue alerts for new errors, metric alerts for latency spikes, cron alerts for failed background jobs.

### Privacy Implications
- **Notifications**: May include error messages, URLs, user context in alert payloads sent to Slack/email.
- **Mitigation**: Configure data scrubbing before data reaches Sentry; alerts inherit scrubbed data.

---

## 7. Dashboards & Discover

### Dashboards
- **What**: Visual overview of application health across projects.
- **Widgets**: Each widget visualizes one or more datasets (charts, tables, metrics).
- **Global filters**: Projects, environment, date range, release, custom filters.
- **Custom dashboards**: Create specialized views beyond the default template.
- **Widget interaction**: Expand, filter, sort, zoom; open in Discover or Issues for deep dives.
- **Dashboard integration with Metrics**: Alerts and dashboard widgets for custom Metrics "coming soon."

### Discover (Query Engine)
- **What**: Powerful query engine to query ALL metadata across projects and environments.
- **Pre-built queries**: All Events, Errors by Title, Errors by URL.
- **Custom queries**: Build with search conditions, custom columns, aggregations.
- **Visualization**: Graph + table with sortable columns + facet map.
- **Saved queries**: Organization-wide visibility.
- **Dashboard conversion**: Any Discover query → dashboard widget.
- **URL-based sharing**: URLs update dynamically as queries are built.

### SDK Configuration Required?
- **None** — Entirely UI-based. Operates on data already collected by the SDK.

### Backend Relevance: **HIGH** ⭐⭐⭐
Essential for creating operational dashboards (error rates, latency, throughput per endpoint), investigating issues across time.

### Privacy Implications
- **None additional** — Dashboards display data already collected. Privacy depends on what the SDK captures.

---

## 8. Cron Monitoring

### What It Does
Monitors the uptime and performance of **scheduled, recurring jobs**:
- Detects when jobs fail to run on schedule
- Detects when jobs exceed runtime limits
- Detects when jobs report failures
- Tracks job performance over time

### Use Cases
- Scheduled database cleanup tasks
- Invoice generation
- Sync jobs (e.g., Omni's `sync-worker`)
- Queue processing health checks
- Any recurring "finite unit of execution"

### Integration Methods
1. **SDK integration**: Native support for Node.js (including Next.js, SvelteKit, Remix, NestJS), Python (Celery), PHP (Laravel), Go, Java (Spring Boot), Ruby, Elixir.
2. **HTTP API**: Direct API calls for custom implementations.
3. **Sentry CLI**: Command-line job wrapping.

### How Check-Ins Work
- **Check-in start**: Job reports start to Sentry.
- **Check-in complete/failed**: Job reports completion or failure.
- **Missed detection**: If no check-in arrives within the expected schedule + margin.
- **Timeout detection**: If check-in starts but doesn't complete within configured limits.

### SDK Configuration Required?
- **Yes** — Must instrument each cron job with check-in calls. Either wrap job function with SDK helpers or use HTTP API.
- Configure schedule (crontab or interval), expected runtime margins, environment.

### Backend Relevance: **HIGH** ⭐⭐⭐
Directly relevant for Omni's sync workers, scheduled polling jobs, cleanup tasks, health checks.

### Privacy Implications
- **Low PII risk** — Captures job names, run times, success/failure status. Does not capture job payload data unless you include it as context.

---

## 9. Uptime Monitoring

### What It Does
Continuously performs HTTP requests to configured URLs and evaluates responses.

### How It Works
- **Multi-region checks**: Round-robin from multiple geographic locations to reduce false positives.
- **Automatic setup**: Auto-monitors the most frequently encountered hostname from your error data.
- **Custom configuration**: Add specific URLs with HTTP method, headers, and body.
- **Failure criteria**: 3 consecutive failures before creating an uptime issue (avoids noise from temporary glitches).

### Success Criteria
- HTTP 2xx status codes (customizable via early-access verification features)
- Automatic 3xx redirect following, verifying final destination
- 10-second timeout per request
- Successful DNS resolution

### SDK Configuration Required?
- **None** — Entirely UI/server-side. Sentry's infrastructure makes the HTTP requests.

### Backend Relevance: **HIGH** ⭐⭐⭐
Monitor Omni API health endpoints externally. No SDK needed — just configure in the UI.

### Privacy Implications
- **URLs**: The monitored URLs are stored by Sentry.
- **Custom headers/body**: If you configure auth headers for authenticated endpoints, those are stored by Sentry.
- **Mitigation**: Only monitor public health endpoints without auth, or use Relay for on-prem control.

---

## 10. User Feedback

### What It Does
Captures end-user reports about issues not caught by automated error detection (broken flows, UX bugs, typos, business logic flaws).

### Collection Methods
1. **User Feedback Widget**: Embeddable UI widget — captures descriptions, screenshots, email, session replay, page URL, tags.
2. **Crash-Report Modal**: Auto-displays after errors — captures descriptions, linked issues, page URL, tags.
3. **User Feedback API**: Programmatic submission for custom interfaces.

### Features
- **AI-powered summaries**: Identifies common sentiments, generates filterable categories.
- **Triage**: Resolve, assign, bulk operations, spam flagging.
- **External integration**: GitHub, Jira — auto-populated issue creation.
- **Alerting**: Automatic notifications on new feedback; customizable alert rules.

### SDK Configuration Required?
- **Widget/Modal**: SDK integration with frontend — **NOT relevant for backend-only**.
- **API**: Can submit feedback programmatically from any server — requires HTTP API calls.

### Backend Relevance: **LOW** ⭐
Primarily a frontend feature. The API method could theoretically be used to pipe external feedback (e.g., from WhatsApp users reporting issues), but this is a stretch.

### Privacy Implications
- **HIGH PII risk**: Captures user emails, free-text descriptions, screenshots, page URLs.
- **Spam detection**: Uses Google Cloud Platform's internal LLM — "no data stored or persisted." Can be disabled.
- **Mitigation**: Can disable spam detection; control what data is submitted via API.

---

## 11. Metrics

### What It Does
Track custom application health signals as counters, gauges, and distributions.

### Metric Types
| Type | Description | Aggregations |
|---|---|---|
| **Counters** | Cumulative occurrences (email deliveries, failed txns) | sum, per_second, per_minute |
| **Gauges** | Point-in-time snapshots (queue depth, memory) | min, max, avg, per_second, per_minute |
| **Distributions** | Varying numeric values (response times, payload sizes) | p50, p75, p95, p99, avg, sum, min, max, count, per_second, per_minute |

> Note: "Sets" type is NOT mentioned in current docs — may be deprecated or removed.

### Features
- **Metrics Explorer**: Aggregates view (trends across attributes) + Samples view (individual events linked to traces).
- **Custom attributes**: Key-value pairs for filtering and grouping.
- **Trace correlation**: Automatically captures trace and span IDs.
- **Dashboard/Alert integration**: "Coming soon" — not yet available.

### SDK Configuration Required?
- **Yes** — Must emit metrics from code using `Sentry.metrics.increment()`, `Sentry.metrics.gauge()`, `Sentry.metrics.distribution()`, etc.

### Backend Relevance: **HIGH** ⭐⭐⭐
Track custom business metrics: messages processed, webhook latency, queue depth, active connections per channel, API response times.

### Privacy Implications
- **Low PII risk** — Metrics are numeric values with string tags. You control what tags you attach.
- **Mitigation**: Don't use user-identifying information as metric tags.

---

## 12. Session Replay

### What It Does
Captures "video-like reproductions of user interactions" in browser and mobile apps.

### Platforms Supported
- Web (browser-based apps, SPAs, SSR frameworks like Next.js, Remix, Electron)
- Mobile (Android, iOS, React Native)

### What It Records
- User interactions (clicks, scrolls, navigation)
- DOM changes (reconstructed from mutation data — not actual video)
- Network requests
- Console output

### SDK Configuration Required?
- **Yes** — Requires frontend SDK integration with replay configuration.

### Backend Relevance: **NONE** ⭐
**Session Replay is a frontend-only feature.** It captures browser/mobile user interactions. It has **zero relevance** for a backend-only Bun API server.

### Privacy Implications
- **VERY HIGH PII risk** — Captures everything users do on screen.
- **Masking**: Text, inputs, media auto-masked by default. Configurable.
- **Access control**: Granular user-based permissions for viewing replays.
- **Not applicable to Omni** — backend only, no frontend.

---

## 13. AI Features in Sentry

### Overview
Sentry's own AI features that analyze YOUR data to help debug faster. These are server-side AI — no SDK changes needed.

### Seer (AI Debugging Agent)
- **What**: AI agent combining issue detection, analysis, and automated fixing.
- **Issue grouping enhancement**: AI-powered similarity detection beyond fingerprinting.
- **Root cause analysis**: Analyzes stack traces, breadcrumbs, and context to suggest probable causes.
- **Code review**: Reviews GitHub PRs before merge for potential issues.
- **Suggested fixes**: Provides code-level fix suggestions for errors.

### Autofix
- **What**: AI-generated code fixes for errors.
- **How**: Analyzes error context, stack traces, and connected code repository to suggest patches.
- **Integration**: Works with connected GitHub/GitLab repositories.

### Issue Summary
- **What**: AI-generated overview of issues.
- **Extracts**: Key insights from event and issue-level metadata, potential causes, trace-connected insights.

### Query Assistant
- **What**: Natural language queries of trace and span data.
- **Use**: Find relevant metric samples without manual query construction.

### AI Summaries
- **What**: Summarizes user feedback and session replays for recurring patterns.

### SDK Configuration Required?
- **None** — All AI features are server-side, operating on data already in Sentry.
- **Repository connection**: Autofix requires GitHub/GitLab integration (not SDK).

### Backend Relevance: **HIGH** ⭐⭐⭐
Seer, Autofix, Issue Summary, and Query Assistant are all valuable for backend debugging. They analyze your error data regardless of whether it's frontend or backend.

### Privacy Implications
- **Data processing**: Sentry states it "does not train generative AI models using your data by default and without your permission."
- **AI output visibility**: Only authorized account users can see AI-generated content.
- **Code access**: Autofix reads your connected source code repository to suggest fixes.
- **Opt-out available**: AI features can be disabled.

---

## 14. AI Agent Monitoring

### What It Does
Monitors AI/LLM pipelines — agent invocations, tool executions, and token usage. Designed for applications that USE AI (e.g., an app calling OpenAI/Anthropic APIs).

### Three Monitoring Areas

#### AI Agent Monitoring
- Tracks agent runs, tool calls, model interactions, and handoffs.
- Visibility into how agents execute workflows and communicate with external systems.

#### Conversation Replay
- Records and replays every message and tool call in a chat-like view.
- Audit AI assistant interactions chronologically.
- Identify where issues occur in conversation flows.

#### MCP Server Monitoring
- Captures tool executions, resource access, and client connections.
- For Model Context Protocol (MCP) implementations.
- Server-side observability.

### Data Captured
- Token usage metrics (input/output/total tokens)
- Tool executions and outcomes
- Agent handoffs between systems
- LLM call performance (latency, error rates)
- Error conditions across the AI pipeline
- Conversation message flow

### SDK Configuration Required?
- **Yes** — Requires instrumentation of LLM calls. Auto-instrumentation available for supported LLM libraries (e.g., OpenAI SDK, LangChain, etc.). Custom spans for other integrations.

### Backend Relevance: **HIGH** ⭐⭐⭐
If Omni integrates with LLMs for chatbot responses, auto-replies, or AI-powered features, this provides critical visibility into token costs, latency, and failure rates.

### Privacy Implications
- **HIGH risk**: May capture prompt/completion text if instrumented at that level.
- **Token counts**: Numeric, low risk.
- **Conversation content**: If conversation replay is enabled, captures all messages and tool calls.
- **Mitigation**: Configure what data is captured in spans. Use `beforeSendSpan` to scrub sensitive content.

---

## 15. Logs

### What It Does
Centralized log collection and search within Sentry, automatically linked to distributed traces.

### Key Features
- **Trace-connected logging**: Every log entry automatically linked to the active trace when recorded. Navigate from log → complete trace waterfall.
- **Searchable**: Full-text search on message content (case-sensitive), property-based filtering, custom attributes.
- **Query examples**: `severity:error`, `user.id:12345`, `trace_id:abc123`, `database:"users" query.duration_ms:>1000`
- **Auto-refresh**: Live log tailing (with sorting/time restrictions).
- **Alerts**: Create alert rules and dashboard widgets based on log queries.
- **AI analysis**: Sentry CLI, MCP Server, and Seer can analyze logs.

### Log Use Cases
- Operational insights (cache misses, DB connections, query results)
- User activity tracking (login events, checkout, feature adoption)
- System state (config initialization, service startup, connection establishment)
- Business transactions (order submissions, payment handling, notification dispatch)

### Integration Methods
1. **SDK integration**: Direct SDK calls (`Sentry.logger.info()`, etc.)
2. **Log drains**: Forward from Vercel, Cloudflare, Heroku, Supabase without code changes.
3. **OpenTelemetry**: Send via OTLP endpoint using any OTel SDK or Collector.

### SDK Configuration Required?
- **Yes** — Set `enableLogs: true` in SDK init.
- Use `beforeSendLog` hook for filtering/modification.
- Emit logs via `Sentry.logger.*` methods or use OTel bridge.

### Backend Relevance: **HIGH** ⭐⭐⭐
Centralized logging with automatic trace correlation is extremely valuable for a messaging backend. Correlate log entries with specific request traces, errors, and performance data.

### Privacy Implications
- **HIGH risk if uncontrolled**: Log messages may contain any data developers choose to log — user messages, phone numbers, emails, etc.
- **Mitigation**: Use `beforeSendLog` to scrub PII. Establish logging conventions that avoid PII. Use parameterized log messages.
- **Server-side scrubbing**: Sentry's data scrubbing applies to logs too.

---

## 16. Relay

### What It Does
Self-hosted proxy that acts as a middle layer between your application and sentry.io.

### Key Capabilities
- **Data scrubbing at the edge**: PII removal before data leaves your network.
- **Enterprise proxy**: Forward events through custom domain names — no direct sentry.io connection from SDKs.
- **Performance**: Reduces roundtrip latency by deploying near your infrastructure.
- **Rate limiting**: Control data flow at the network boundary.

### SDK Configuration Required?
- **SDK change**: Point SDK DSN to your Relay instance instead of sentry.io.
- **Relay configuration**: Deploy and configure Relay service separately.

### Backend Relevance: **MEDIUM** ⭐⭐
Useful for organizations with strict data residency requirements. Adds operational complexity.

### Privacy Implications
- **Privacy POSITIVE**: Relay is a privacy-enhancing feature. Sensitive data gets filtered locally within your network before cloud transmission. Satisfies compliance requirements for data residency.

---

## 17. Stats & Quota Management

### What It Does
Organization-wide usage metrics and billing visibility.

### Data Categories Tracked
| Category | Description | Billable? |
|---|---|---|
| **Events** | Errors and transactions | Yes |
| **Attachments** | Files attached to events | Yes |
| **Sessions** | Release health session data | No |
| **Profile hours** | Continuous profiling data | Yes |

### Event Statuses
| Status | Meaning |
|---|---|
| **Accepted** | Processed and stored |
| **Filtered** | Excluded by settings (browser extensions, IP blocks, etc.) |
| **Rate Limited** | Discarded due to quotas |
| **Invalid** | Failed validation |
| **Client Discard** | Dropped by SDK (queue overflow, network errors, sample rates) |

### SDK Configuration Required?
- **None** — UI-only feature.

### Backend Relevance: **MEDIUM** ⭐⭐
Important for managing costs and understanding data volume. Useful for capacity planning.

### Privacy Implications: None — aggregate usage data only.

---

## 18. Data Scrubbing & Privacy

### Three Layers of Privacy Protection

#### 1. SDK-Side (Client)
- `sendDefaultPii: false` (default) — prevents automatic IP/user collection.
- `beforeSend` / `beforeSendTransaction` / `beforeSendSpan` / `beforeSendLog` — filter/modify events before sending.
- `ignoreErrors` — suppress specific error patterns entirely.

#### 2. Relay (Edge)
- PII scrubbing before data leaves your network.
- Centralized privacy rules applied at the proxy layer.

#### 3. Server-Side (Sentry.io)
- **Default scrubbing** (enabled by default):
  - Credit card number detection via regex.
  - Keyword-based scrubbing: fields containing/named `password`, `secret`, `passwd`, `api_key`, `apikey`, `auth`, `credentials`, `mysql_pwd`, `privatekey`, `private_key`, `token`, `bearer`.
  - Custom sensitive fields (configurable per project/org).
- **Safe Fields**: Exclude specific paths from scrubbing (e.g., `user.id`).
- **Advanced Data Scrubbing**: Custom regex-based redaction rules.
- **IP address handling**: Can disable IP storage. Note: geo data still extracted even if IP storage is off (use Advanced rules to remove `$user.geo.**`).
- **Attachment scrubbing**: PII removal from file attachments.
- **Session Replay privacy**: Masking controls for replay data.

### Configuration Hierarchy
- **Organization settings** override project settings.
- Available at: `[Settings] > Security & Privacy > DATA SCRUBBING`.

### Known Limitations
- Breadcrumb categories cannot be excluded from scrubbing via Safe Fields.
- Single events cannot be deleted — entire issues must be deleted.
- Once data reaches Sentry, tag values require manual removal via Project Settings > Tags.

### Backend Relevance: **CRITICAL** ⭐⭐⭐
Essential to configure properly for a messaging platform. WhatsApp messages, phone numbers, user names must be scrubbed or never captured.

---

## 19. Bun SDK Specifics

### Supported Features
1. **Error Monitoring** — Automatic error capture ✅
2. **Performance Tracing** — Distributed tracing ✅
3. **Logs** — Centralized log analysis ✅

### Key Configuration Options (Complete)

| Option | Type | Default | Description |
|---|---|---|---|
| `dsn` | string | — | Where SDK sends events. Required. |
| `release` | string | — | Code version identifier |
| `environment` | string | `"production"` | Deployment context (max 64 chars) |
| `debug` | boolean | `false` | Diagnostic output |
| `enabled` | boolean | `true` | Toggle event transmission |
| `sendDefaultPii` | boolean | `false` | Auto-capture IP/user context |
| `sampleRate` | number | `1.0` | Error event sampling (0-1) |
| `tracesSampleRate` | number | — | Transaction sampling (0-1) |
| `tracesSampler` | function | — | Dynamic per-transaction sampling |
| `tracePropagationTargets` | array | — | Control trace header attachment |
| `profileSessionSampleRate` | number | — | Continuous profiling sampling (0-1) |
| `profileLifecycle` | string | `"manual"` | `"manual"` or `"trace"` |
| `enableLogs` | boolean | `false` | Enable log capture |
| `maxBreadcrumbs` | number | `100` | Breadcrumb limit |
| `attachStacktrace` | boolean | `false` | Stack traces on log messages |
| `serverName` | string | — | Server/device hostname |
| `includeLocalVariables` | boolean | `false` | Local vars in stack traces |
| `normalizeDepth` | number | `3` | Context data tree depth |
| `normalizeMaxBreadth` | number | `1000` | Properties per object/array |
| `shutdownTimeout` | number | `2000` | MS for queue drain on shutdown |
| `tunnel` | string | — | Custom event transport URL |
| `transport` | function | — | Custom transport implementation |

### Hooks (Data Filtering)
| Hook | Purpose |
|---|---|
| `beforeSend` | Filter/modify error events |
| `beforeSendTransaction` | Filter/modify transactions |
| `beforeSendSpan` | Filter/modify spans |
| `beforeSendLog` | Filter/modify logs |
| `beforeBreadcrumb` | Filter/modify breadcrumbs |

### Filter Options
| Option | Purpose |
|---|---|
| `ignoreErrors` | String/regex patterns to suppress |
| `ignoreTransactions` | String/regex patterns to exclude transactions |
| `ignoreSpans` | String/regex or objects to filter spans |

### Critical Limitation
> **"Sentry's auto-instrumentation does not work with bundled code, including Bun's single-file executables"** — module hooks are unavailable in bundled contexts. Omni likely runs unbundled in development/production, so this may not be an issue.

### Auto-Instrumentation
When using `--preload` flag with Bun:
- HTTP incoming requests (automatic transaction creation)
- HTTP outgoing requests (automatic span creation)
- Database queries (if using supported ORMs)
- File I/O operations

---

## Summary: Relevance Matrix for Omni

| Feature | Backend Relevance | SDK Config Needed? | Privacy Risk | Recommendation |
|---|---|---|---|---|
| **Error Monitoring / Issues** | ⭐⭐⭐ HIGH | Minimal (DSN only) | Medium | **ENABLE** — Core feature |
| **Performance / Tracing** | ⭐⭐⭐ HIGH | `tracesSampleRate` | Medium | **ENABLE** — Critical for API perf |
| **Profiling** | ⭐⭐⭐ HIGH | `profileSessionSampleRate` | Low | **ENABLE** — CPU optimization |
| **DB Query Monitoring** | ⭐⭐⭐ HIGH | Auto w/ tracing | Low (parameterized) | **ENABLE** — PostgreSQL visibility |
| **HTTP Request Monitoring** | ⭐⭐⭐ HIGH | Auto w/ tracing | Medium (URLs) | **ENABLE** — Track external API calls |
| **Cache Monitoring** | ⭐⭐ MEDIUM | Manual instrumentation | Low | **OPTIONAL** — If using Redis |
| **Queue Monitoring** | ⭐⭐ MEDIUM | Manual instrumentation | Low | **OPTIONAL** — If using BullMQ |
| **Releases & Health** | ⭐⭐⭐ HIGH | `release` + `environment` | Low | **ENABLE** — Track deployments |
| **Alerts** | ⭐⭐⭐ HIGH | UI-only | Low | **ENABLE** — Operational awareness |
| **Dashboards & Discover** | ⭐⭐⭐ HIGH | UI-only | None | **ENABLE** — Operational visibility |
| **Cron Monitoring** | ⭐⭐⭐ HIGH | SDK check-in calls | Low | **ENABLE** — For sync workers |
| **Uptime Monitoring** | ⭐⭐⭐ HIGH | UI-only | Low | **ENABLE** — External health checks |
| **User Feedback** | ⭐ LOW | Frontend SDK / API | High (PII) | **SKIP** — Frontend-only feature |
| **Metrics** | ⭐⭐⭐ HIGH | SDK emit calls | Low | **ENABLE** — Custom business metrics |
| **Session Replay** | ❌ NONE | Frontend SDK | Very High | **SKIP** — Not applicable |
| **AI Features (Seer/Autofix)** | ⭐⭐⭐ HIGH | None (server-side) | Medium (code access) | **ENABLE** — Free debugging help |
| **AI Agent Monitoring** | ⭐⭐⭐ HIGH | LLM instrumentation | High (prompts) | **ENABLE** — If Omni uses LLMs |
| **Logs** | ⭐⭐⭐ HIGH | `enableLogs: true` | High (log content) | **ENABLE** — Trace-correlated logging |
| **Relay** | ⭐⭐ MEDIUM | Infrastructure change | Positive (privacy) | **OPTIONAL** — For strict compliance |
| **Data Scrubbing** | ⭐⭐⭐ CRITICAL | Server-side config | Positive (privacy) | **CONFIGURE** — Must scrub PII |

---

## Key Takeaways for Omni

### Must-Enable Features
1. **Error Monitoring** — Foundation of observability
2. **Performance/Tracing** — Understand API latency, identify bottlenecks
3. **Releases** — Correlate errors with deployments
4. **Alerts** — Get notified of issues immediately
5. **Cron Monitoring** — Monitor sync workers and background jobs
6. **Data Scrubbing** — Critical for a messaging platform handling user messages and phone numbers

### High-Value Features
7. **Profiling** — Find CPU hotspots in message processing
8. **Logs** — Centralized, trace-correlated logging
9. **Metrics** — Custom business metrics (messages/sec, queue depth, etc.)
10. **AI Features** — Seer/Autofix for faster debugging
11. **Dashboards** — Custom operational views
12. **Uptime Monitoring** — External health verification

### Skip for Backend-Only
- **Session Replay** — Frontend-only, zero backend relevance
- **User Feedback Widget/Modal** — Frontend-only (API could work but low value)
- **Web Vitals** — Browser metrics, not applicable

### Privacy Priorities for a Messaging Platform
1. **NEVER capture message content** in Sentry (WhatsApp, Telegram, etc. messages are highly sensitive)
2. **Scrub phone numbers** — Configure custom sensitive fields
3. **Scrub user names/emails** — Unless explicitly needed
4. **Use parameterized queries** — DB queries auto-parameterized, but verify
5. **Configure `beforeSend`** — Strip any PII from error contexts
6. **Configure `beforeSendLog`** — Prevent logging user data to Sentry
7. **Keep `sendDefaultPii: false`** — Never auto-collect IP/user data
8. **Consider Relay** — If strict data residency needed
