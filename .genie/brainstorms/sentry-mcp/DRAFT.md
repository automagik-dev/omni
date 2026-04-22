# Brainstorm: Sentry MCP + SDK Integration

## Problem
Sentry project exists for Omni but nothing reports to it — zero SDK integration, zero DSN, zero error reporting. OSS users generate no issues. Claude Code has no MCP access to query Sentry.

## Scope

### IN
- **Part A: Sentry MCP** — Configure remote Sentry MCP server in Claude Code
- **Part B: Sentry SDK** — Embed `@sentry/bun` in the Omni API with full observability
- **Part C: Privacy Layer** — 3-tier PII scrubbing (SDK + server-side + optional Relay)

### OUT
- Frontend/UI browser SDK (no Sentry in the web app)
- CLI error tracking
- Profiling (NOT supported on Bun)
- Sentry Relay (defer unless self-hosting for LGPD)

## Research Completed (4 parallel agents + AI deep dive)
- `research-bun-sdk.md` — 1079 lines, all SDK features, 28 integrations mapped
- `research-codebase-mapping.md` — 15 integration points mapped across 30+ source files
- `research-privacy-and-mcp.md` — 26 MCP tools + 3-layer privacy strategy
- AI monitoring deep dive — privacy, dashboard, cost tracking, span attributes

## What Exactly We Capture and Why

### The Principle
Capture **everything operational** (errors, latency, throughput, costs) — capture **nothing personal** (message content, phone numbers, names, chat data).

### Complete Capture Map

| What We Capture | How | Why We Need It | PII Risk |
|----------------|-----|----------------|----------|
| **Uncaught exceptions + stack traces** | Auto (`onUncaughtExceptionIntegration`) | Know when the server is crashing | LOW — stack traces are code, not user data |
| **Unhandled promise rejections** | Auto (`onUnhandledRejectionIntegration`) | Catch silent failures in async code | LOW |
| **5xx HTTP errors with error code/type** | Manual (`Sentry.captureException` in error middleware) | Know which API endpoints break and how often | LOW — we strip request body/headers |
| **HTTP request latency per endpoint** | Auto (`bunServerIntegration`) | Find slow endpoints, track p50/p95/p99 | MEDIUM — URLs may have UUIDs → parameterize |
| **HTTP status code distribution** | Auto (`bunServerIntegration`) | Track 4xx/5xx rates per route | NONE |
| **PostgreSQL query duration** | Auto (`postgresIntegration`) | Find slow queries, N+1 patterns | MEDIUM — query params may have data → scrub |
| **Outgoing fetch latency** | Auto (`nativeNodeFetchIntegration`) | Monitor WhatsApp/Telegram/Discord API health | LOW — external API URLs, not user data |
| **AI model calls (Anthropic/OpenAI)** | Auto (`anthropicAIIntegration`, `openAIIntegration`) | Track token usage, model latency, cost per call | **HIGH** — prompts contain user messages → see AI section |
| **AI token counts (input/output/cached)** | Auto (span attributes `gen_ai.usage.*`) | Cost monitoring, budget alerts | NONE — just numbers |
| **AI model name + provider** | Auto (`gen_ai.request.model`) | Know which models are used and their error rates | NONE |
| **CLI command usage (which features)** | Auto via HTTP tracing — each `omni <cmd>` maps to an API endpoint | Know which features people use most (send, chats, instances, etc.) to prioritize improvements | NONE — just endpoint paths |
| **CLI command errors (misused commands)** | Auto via 4xx error capture — CLI sends `x-omni-cli-version` header | Know which commands fail (wrong args, bad input from LLMs or users) | LOW — error messages only, body stripped |
| **CLI version distribution** | Tag from `x-omni-cli-version` header | Know which CLI versions are in the wild | NONE |
| **Agent type distribution** | Custom metric/tag from agent dispatcher | Know which agent providers (Agno, OpenClaw, Webhook, Claude Code, etc.) are used most | NONE — just provider names |
| **Scheduled job success/failure/missed** | Manual (`Sentry.withMonitor`) | Know if nightly sync or cleanup jobs fail/hang | NONE |
| **Console breadcrumbs** | Auto (`consoleIntegration`) | Trail of events before a crash | HIGH — logs may contain message content → scrub |
| **Release version** | Config (`release: packageJson.version`) | Detect regressions between versions | NONE |
| **Environment** | Config (`environment: NODE_ENV`) | Separate prod/dev/staging errors | NONE |
| **Custom tags** | Manual (`setTag`) | Filter errors by channel type, instance, error code | NONE — only internal IDs |
| **Custom metrics** | Manual (`Sentry.metrics.*`) | Business metrics: messages/sec, active connections | NONE — aggregated counters |

### What We Explicitly DO NOT Capture

| What We Block | How We Block It | Why |
|--------------|----------------|-----|
| **Request bodies** (message content, phone numbers from CLI `omni send --text ...`) | `requestDataIntegration({ data: false })` | CLI sends message text + recipient in POST body |
| **Error message PII** (phone numbers embedded in exception strings) | `beforeSend` regex scrub on `event.exception.values[].value` — pattern `\+?\d{10,15}`, `\d+@[sc]\.whatsapp\.net` | Errors like `resolveRecipient` embed phone/JID in the error message string |
| **Error context PII** (OmniError.context may have `{ to: "+5511..." }`) | `beforeSend` scrubs `event.extra` and `event.contexts` for phone patterns | `OmniError({ context: { to, channelType } })` leaks the recipient |
| Phone numbers / WhatsApp JIDs in breadcrumbs | `beforeBreadcrumb` regex scrub + `beforeSend` scrubs breadcrumb data | Console logs and HTTP breadcrumbs may log recipients |
| Chat/group names | `beforeBreadcrumb` drops console breadcrumb `.data` content | Log statements may include chat names |
| User email/username/IP | `sendDefaultPii: false` (default) + `requestDataIntegration({ user: false, ip_address: false })` | PII |
| Request headers (API keys, auth tokens) | `requestDataIntegration({ headers: false })` | Security |
| Request cookies | `requestDataIntegration({ cookies: false })` | Security |
| Query strings | `requestDataIntegration({ query_string: false })` | May contain phone numbers, tokens |
| AI prompts/completions (user messages in agent dispatch) | `sendDefaultPii: false` (AI integration respects this) | Prompts contain WhatsApp message content forwarded to LLMs |
| HTTP response bodies | `beforeBreadcrumb` strips response data | API responses contain message content |
| Server hostname | `beforeSend` strips `server_name` tag | Infrastructure PII |

### Known PII Leak Points in Codebase (discovered during research)

| File | Line | What Leaks | Scrubbing Strategy |
|------|------|-----------|-------------------|
| `routes/v2/messages.ts` | 95 | Phone/JID in error message: `"${to}" is a UUID but not a known person...` | `beforeSend` regex on exception values |
| `routes/v2/messages.ts` | 96 | Phone/JID in error context: `context: { to, channelType }` | `beforeSend` scrubs `error.context` |
| `services/chats.ts` | 487 | externalId (JID) in error: `Failed to create...${externalId}` | `beforeSend` regex |
| `services/chats.ts` | 834 | platformUserId in error: `ChatParticipant ${chatId}/${platformUserId}` | `beforeSend` regex |
| `services/persons.ts` | 726 | platformIdentityId in error | `beforeSend` regex |
| `plugins/agent-dispatcher.ts` | all | Message content flows through dispatch → AI calls | `sendDefaultPii: false` blocks prompt capture |
| Console logs throughout | various | `log.info("Received message from...", { jid })` | `beforeBreadcrumb` scrubs console data |

### AI Monitoring — Special Handling

The `anthropicAIIntegration` and `openAIIntegration` auto-capture span attributes:

| Attribute | Captured when `sendDefaultPii: false` | Captured when `sendDefaultPii: true` |
|-----------|---------------------------------------|--------------------------------------|
| `gen_ai.request.model` | YES | YES |
| `gen_ai.usage.input_tokens` | YES | YES |
| `gen_ai.usage.output_tokens` | YES | YES |
| `gen_ai.usage.input_tokens.cached` | YES | YES |
| `gen_ai.request.messages` (prompts) | **NO** | YES |
| `gen_ai.response.text` (completions) | **NO** | YES |
| `gen_ai.tool.input` / `gen_ai.tool.output` | **NO** | YES |
| `gen_ai.prompt` | **NO** | YES |

**With `sendDefaultPii: false` (our config)**: We get model name, token counts, latency, error rates — but NO prompt/completion content. This is exactly what we want: cost and performance monitoring without leaking WhatsApp conversations.

**What we see in Sentry AI dashboard**:
- Agent runs over time + error rates
- Response time per AI call
- Token usage by model (Anthropic vs OpenAI vs Groq)
- Estimated cost per model (auto-calculated from token counts)
- Tool call volume and errors
- Which models fail and how often

**What we DON'T see** (by design):
- What the user asked
- What the AI responded
- The system prompt content
- Tool call arguments (which contain message content)

## Architecture Decision: What to Enable

### Tier 1: Must Have (Day 1)
| Feature | How | Why |
|---------|-----|-----|
| Error Capture | Auto via `@sentry/bun` | Uncaught exceptions, unhandled rejections, 5xx errors |
| HTTP Request Tracing | Auto via `bunServerIntegration` | API latency, error rates per endpoint |
| PG Query Tracing | Auto via `postgresIntegration` | Slow queries, N+1 detection |
| Outgoing Fetch Tracing | Auto via `nativeNodeFetchIntegration` | WhatsApp/Telegram/Discord API call monitoring |
| AI SDK Tracing | Auto via `anthropicAIIntegration` + `openAIIntegration` | Token usage, model latency, agent dispatch |
| Release Tracking | `release: packageJson.version` | Regression detection per version |
| Environment Tags | `environment: NODE_ENV` | Separate prod/dev/staging |
| Privacy Scrubbing | `beforeSend` + `beforeBreadcrumb` + `beforeSendTransaction` + `requestDataIntegration` | Strip ALL PII before it leaves the server |
| Sentry MCP | `claude mcp add --transport http sentry https://mcp.sentry.dev/mcp` | Query issues from Claude Code |

### Tier 2: Should Have (Day 1, minimal config)
| Feature | How | Why |
|---------|-----|-----|
| Cron Monitoring | `Sentry.withMonitor()` wrapping 6 scheduled jobs | Detect missed/failed scheduled jobs |
| Custom Metrics | `Sentry.metrics.count/gauge/distribution` | messages_received, active_connections, webhook_latency |
| Custom Tags | `setTag('channelType', ...)`, `setTag('instanceId', ...)` | Filter errors by channel, instance |
| Breadcrumbs | Console + HTTP (scrubbed) | Trail leading to errors |

### Tier 3: Nice to Have (Later)
| Feature | How | Why |
|---------|-----|-----|
| Structured Logs | `Sentry.logger.*` with `enableLogs: true` | Centralized searchable logs |
| NATS Queue Spans | Manual `Sentry.startSpan({ op: 'queue.process' })` | Distributed tracing across event bus |
| Alerts | Sentry UI config | Slack/email on new issues, regressions |
| Dashboards | Sentry UI | Custom views per channel type |
| Source Maps | `@sentry/wizard` | Better stack traces (Bun runs TS directly, may not need) |

### NOT Available on Bun
- Profiling (`@sentry/profiling-node` requires V8 CpuProfiler)
- File system instrumentation
- ANR/event loop block detection
- Child process instrumentation

## Privacy Strategy (3-Layer)

### Layer 1: SDK (`beforeSend` etc.) — data never leaves server
- `sendDefaultPii: false` (default, keep it)
- `requestDataIntegration({ include: { cookies: false, data: false, headers: false, query_string: false, url: true, ip_address: false, user: false } })`
- `beforeSend`: strip user context, request body, cookies, sensitive headers, scrub error messages for phone numbers
- `beforeSendTransaction`: parameterize URLs (phone → `:phone`, UUID → `:uuid`, WhatsApp JID → `:jid`)
- `beforeSendSpan`: scrub DB statements, HTTP URLs
- `beforeBreadcrumb`: drop console data content, scrub HTTP URLs
- `ignoreErrors`: ECONNRESET, ETIMEDOUT, socket hang up
- `ignoreTransactions`: healthcheck, favicon

### Layer 2: Server-Side (Sentry UI)
- Enable "Prevent Storing of IP Addresses"
- Add sensitive fields: phoneNumber, chatName, messageContent, senderName
- Advanced rules: `[Remove] [Regex: \+?\d{10,15}] from [**]` (phone numbers)
- Advanced rules: `[Remove] [Regex: \d+@[sc]\.whatsapp\.net] from [**]` (JIDs)
- Advanced rules: `[Remove] [Email Addresses] from [**]`

### Layer 3: Relay (Defer)
- Only needed for LGPD/GDPR on-prem compliance
- Not needed for SaaS Sentry with Layer 1+2

## 15 Integration Points (from codebase mapping)

1. **index.ts:1** — `Sentry.init()` (before all imports, or via `--preload`)
2. **middleware/error.ts:337** — `Sentry.captureException()` for 5xx only
3. **app.ts** — Auto via `bunServerIntegration` (no code needed)
4. **scheduler.ts** — `Sentry.withMonitor()` wrapping 6 cron jobs
5. **NATS event bus** — Manual spans for publish/subscribe (Tier 3)
6. **plugins/agent-dispatcher.ts** — Auto AI tracing via `anthropicAIIntegration`
7. **Channel plugins** — Custom tags (channelType, instanceId) + error capture
8. **Database** — Auto via `postgresIntegration`
9. **plugins/media-processor.ts** — Manual spans for transcription/OCR
10. **plugins/sync-worker.ts** — Manual spans for long-running sync
11. **plugins/inbox-bridge.ts** — Manual spans for polling loop
12. **plugins/session-cleaner.ts** — Error capture
13. **plugins/instance-monitor.ts** — Custom metrics (connected/disconnected)
14. **Logger integration** — `consoleIntegration` for breadcrumbs
15. **Shutdown** — `Sentry.close(5000)` in graceful shutdown handler

## Custom Metrics & Usage Analytics

### Feature Usage (from HTTP tracing — automatic)
Every CLI command maps to an API endpoint. Sentry's transaction grouping gives us:
- **Request count per endpoint** → which features are used most
- **Error rate per endpoint** → which features break most
- **Latency per endpoint** → which features are slow

Examples of what we'll see:
- `POST /api/v2/instances/:id/send` → send command usage
- `GET /api/v2/chats` → chats list usage
- `GET /api/v2/instances` → instances list usage
- `POST /api/v2/providers` → provider setup usage

### Custom Tags on Every Request (from middleware)
```
channelType: "whatsapp" | "telegram" | "discord" | "slack"
instanceId: "<uuid>"  (parameterized in Sentry)
cliVersion: "2.260309.1" (from x-omni-cli-version header)
agentProvider: "agno" | "openclaw" | "webhook" | "claude-code" | "genie"
```

### Custom Metrics (manual)

| Metric | Type | Tags | Why |
|--------|------|------|-----|
| `messages.received` | counter | channelType, instanceId | Volume per channel |
| `messages.sent` | counter | channelType, instanceId | Outbound volume |
| `agent.dispatch` | counter | providerType, model | Which agent types are used most |
| `agent.dispatch.latency` | distribution (ms) | providerType, model | Agent response time |
| `agent.dispatch.tokens` | distribution | providerType, model | Token consumption |
| `instance.connections` | gauge | channelType | Active connections |
| `webhook.latency` | distribution (ms) | channelType | External API health |
| `sync.job.duration` | distribution (ms) | jobType | Sync performance |
| `dead_letters.pending` | gauge | — | Queue health |

## Env Vars Needed

```bash
SENTRY_DSN=                           # Required — from Sentry project
SENTRY_TRACES_SAMPLE_RATE=0.1         # Optional, default 0.1 (10%)
SENTRY_ENVIRONMENT=                    # Optional, defaults to NODE_ENV
```

## Summary: Why Each Feature Matters for Omni

| Feature | Real-World Scenario It Solves |
|---------|------------------------------|
| Error capture | "Users report WhatsApp disconnects but we have no idea how often or why" |
| HTTP tracing | "The API feels slow but we don't know which endpoints are the bottleneck" |
| PG query tracing | "Chat list takes 3s to load — is it the query or the API?" |
| Outgoing fetch tracing | "Telegram API started timing out — when did it start?" |
| AI monitoring (tokens/cost) | "How much are agent dispatches costing us? Which model is cheapest for the task?" |
| **CLI feature usage** | **"Which `omni` commands do people use most? send? chats? instances? — so we can prioritize improvements"** |
| **CLI command errors** | **"LLMs constantly mistype `omni send` arguments — how often? which subcommands? what errors?"** |
| **Agent type usage** | **"Are people using Agno, OpenClaw, Webhook, or Claude Code agents more? Which types fail?"** |
| Cron monitoring | "Daily contacts sync silently stopped running 3 days ago" |
| Custom metrics | "How many messages/day flow through each channel type?" |
| Release tracking | "Did the last deploy introduce a regression?" |
| Sentry MCP | "Claude Code can query Sentry issues directly while debugging" |

## Acceptance Criteria

- [ ] MCP: `claude mcp add` configures Sentry MCP server
- [ ] MCP: Claude Code can query issues via MCP after OAuth
- [ ] SDK: `@sentry/bun` added to `packages/api`
- [ ] SDK: `Sentry.init()` runs at startup when `SENTRY_DSN` is set
- [ ] SDK: No-op when `SENTRY_DSN` is unset
- [ ] SDK: 5xx errors captured via `Sentry.captureException()`
- [ ] SDK: HTTP requests auto-traced via `bunServerIntegration`
- [ ] SDK: PG queries auto-traced via `postgresIntegration`
- [ ] SDK: AI calls auto-traced via `anthropicAIIntegration`
- [ ] SDK: 6 scheduled jobs monitored via `Sentry.withMonitor()`
- [ ] Privacy: `sendDefaultPii: false`
- [ ] Privacy: `requestDataIntegration` captures URL only
- [ ] Privacy: `beforeSend` strips all user data, request body, cookies
- [ ] Privacy: `beforeSendTransaction` parameterizes URLs
- [ ] Privacy: No phone numbers, JIDs, message content reaches Sentry
- [ ] Config: `SENTRY_DSN` documented in `.env.example`
- [ ] Config: `Sentry.close()` in graceful shutdown
- [ ] Tags: channelType, instanceId, errorCode on captured events
