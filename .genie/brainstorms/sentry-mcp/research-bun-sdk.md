# Sentry Bun SDK — Exhaustive Research

> Research date: 2026-03-10
> Source: https://docs.sentry.io/platforms/javascript/guides/bun/
> Package: `@sentry/bun`

---

## Table of Contents

1. [Installation & Setup](#1-installation--setup)
2. [Sentry.init() — All Configuration Options](#2-sentryinit--all-configuration-options)
3. [Auto-Instrumentation — What Gets Captured](#3-auto-instrumentation--what-gets-captured)
4. [Error Monitoring](#4-error-monitoring)
5. [Performance Tracing](#5-performance-tracing)
6. [Logs](#6-logs)
7. [Metrics](#7-metrics)
8. [Crons (Scheduled Job Monitoring)](#8-crons-scheduled-job-monitoring)
9. [Profiling](#9-profiling)
10. [Breadcrumbs](#10-breadcrumbs)
11. [Privacy & Filtering — CRITICAL FOR OMNI](#11-privacy--filtering--critical-for-omni)
12. [Scopes (Request Isolation)](#12-scopes-request-isolation)
13. [Enriching Events (Tags, Context, User)](#13-enriching-events-tags-context-user)
14. [Attachments](#14-attachments)
15. [Source Maps](#15-source-maps)
16. [Bun-Specific Limitations & Gotchas](#16-bun-specific-limitations--gotchas)
17. [Hono Framework Integration](#17-hono-framework-integration)
18. [AI Agent Monitoring](#18-ai-agent-monitoring)
19. [Queue Instrumentation (NATS)](#19-queue-instrumentation-nats)
20. [Cache Instrumentation (Redis)](#20-cache-instrumentation-redis)
21. [OpenTelemetry](#21-opentelemetry)

---

## 1. Installation & Setup

```bash
bun add @sentry/bun
```

Create `instrument.ts` (must be loaded BEFORE other imports):

```typescript
import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn: "https://...",
  // ... options
});
```

Launch with preload:
```bash
bun --preload ./instrument.ts app.ts
```

**CRITICAL**: Sentry's auto-instrumentation does NOT work with bundled code or single-file executables. Must run unbundled source.

---

## 2. Sentry.init() — All Configuration Options

### Core Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dsn` | `string` | — | Data Source Name (required) |
| `orgId` | `number \| string` | — | Organization ID, extracted from DSN or manual |
| `debug` | `boolean` | `false` | SDK debugging output to console |
| `release` | `string` | — | App release identifier (e.g., `"omni@2.260309.1"`) |
| `environment` | `string` | `"production"` | Deployment environment |
| `tunnel` | `string` | — | Custom URL for event transport (bypasses ad blockers) |
| `enabled` | `boolean` | `true` | Enable/disable all event transmission |
| `serverName` | `string` | — | Server hostname |
| `maxValueLength` | `number` | — | Truncation limit for string properties |
| `normalizeDepth` | `number` | `3` | How deep to walk context objects |
| `normalizeMaxBreadth` | `number` | `1000` | Max properties per normalized object |
| `sendClientReports` | `boolean` | `true` | Send client outcome reports |
| `shutdownTimeout` | `number` | `2000` | MS to wait for pending events on shutdown |
| `disableInstrumentationWarnings` | `boolean` | `false` | Suppress integration warnings |

### Privacy Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| **`sendDefaultPii`** | `boolean` | **`false`** | **Controls auto-capture of IP, headers, cookies, user** |
| `maxBreadcrumbs` | `number` | `100` | Max breadcrumbs stored |
| `attachStacktrace` | `boolean` | `false` | Attach stack traces to all messages |
| `includeLocalVariables` | `boolean` | `false` | Include stack local variables |

### Error Monitoring Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `sampleRate` | `number` | `1.0` | Error event sampling (0.0-1.0) |
| **`beforeSend`** | `function` | — | **Filter/modify error events before sending** |
| `enhanceFetchErrorMessages` | `'always' \| 'report-only' \| false` | `'always'` | Add hostname to fetch errors |
| **`ignoreErrors`** | `Array<string \| RegExp>` | `[]` | **Drop errors matching these patterns** |

### Tracing Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tracesSampleRate` | `number` | — | Transaction sampling rate (0-1) |
| `tracesSampler` | `function` | — | Dynamic sampling based on context |
| `tracePropagationTargets` | `Array<string \| RegExp>` | — | Which URLs get trace headers |
| `strictTraceContinuation` | `boolean` | `false` | Validate org ID for trace continuation |
| **`beforeSendTransaction`** | `function` | — | **Filter/modify transactions before sending** |
| **`beforeSendSpan`** | `function` | — | **Modify spans (cannot drop — use beforeSendTransaction)** |
| **`ignoreTransactions`** | `Array<string \| RegExp>` | `[]` | **Drop transactions matching patterns** |
| **`ignoreSpans`** | `Array<string \| RegExp \| object>` | `[]` | **Drop spans matching patterns** |
| `propagateTraceparent` | `boolean` | `false` | Attach W3C traceparent to outgoing requests |

### Logs Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enableLogs` | `boolean` | `false` | Enable log capture |
| **`beforeSendLog`** | `function` | — | **Filter/modify logs before sending** |

### Profiling Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `profileSessionSampleRate` | `number` | — | Session-level profiling rate (0-1) |
| `profileLifecycle` | `'trace' \| 'manual'` | `'manual'` | Auto vs manual profiling |

### Integration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `integrations` | `Array<Integration> \| function` | `[]` | Custom integrations |
| `defaultIntegrations` | `undefined \| false` | — | Set `false` to disable all defaults |
| **`beforeBreadcrumb`** | `function` | — | **Filter/modify breadcrumbs** |
| `initialScope` | `CaptureContext` | — | Pre-populate scope data |

### Transport Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transport` | `function` | — | Custom transport implementation |
| `transportOptions` | `TransportOptions` | — | Headers, proxy, CA certs, keepAlive |

---

## 3. Auto-Instrumentation — What Gets Captured

### Auto-Enabled Integrations in @sentry/bun (28 total)

| Integration | What It Captures | Relevant to Omni? |
|-------------|-----------------|-------------------|
| **`bunServerIntegration`** | Instruments `Bun.serve()` — auto-creates transactions, captures errors | **YES — Hono runs on Bun.serve** |
| **`httpIntegration`** | Breadcrumbs + spans for HTTP requests (incoming & outgoing) | **YES** |
| **`nativeNodeFetchIntegration`** | Spans + breadcrumbs for `fetch()` calls | **YES — all external API calls** |
| **`postgresIntegration`** | PostgreSQL query spans via `@opentelemetry/instrumentation-pg` | **YES — Drizzle/pg** |
| **`consoleIntegration`** | Console logs as breadcrumbs | **YES** |
| **`requestDataIntegration`** | Incoming request data (headers, cookies, body, query, URL) | **YES — but PII risk!** |
| `amqplibIntegration` | AMQP messaging spans | No (we use NATS) |
| `kafkaIntegration` | Kafka streaming spans | No |
| `redisIntegration` | Redis operation spans + cache monitoring | Maybe future |
| `mongoIntegration` | MongoDB spans | No |
| `mongooseIntegration` | Mongoose ORM spans | No |
| `mysqlIntegration` / `mysql2Integration` | MySQL spans | No |
| `prismaIntegration` | Prisma ORM spans | No |
| `graphqlIntegration` | GraphQL operation spans | No |
| `genericPoolIntegration` | Connection pool spans | Maybe |
| `lruMemoizerIntegration` | Cache monitoring | No |
| `tediousIntegration` | SQL Server spans | No |
| `contextLinesIntegration` | Source code context in stack frames | YES |
| `dedupeIntegration` | Prevents duplicate events | YES |
| `functionToStringIntegration` | Preserves function names | YES |
| `inboundFiltersIntegration` | Error filtering (ignoreErrors, denyUrls) | YES |
| `linkedErrorsIntegration` | Error chain tracking | YES |
| `modulesIntegration` | Package dependency context | YES |
| `nodeContextIntegration` | Environment/device context | YES |
| `onUncaughtExceptionIntegration` | Global uncaught exception handler | YES |
| `onUnhandledRejectionIntegration` | Unhandled promise rejection capture | YES |
| **`anthropicAIIntegration`** | Anthropic SDK tracing (tokens, model, etc.) | **YES — AI dispatching** |
| **`openAIIntegration`** | OpenAI SDK tracing | **YES** |
| `langChainIntegration` | LangChain tracing | Maybe |
| `vercelAiIntegration` | Vercel AI SDK tracing | No |
| `googleGenAIIntegration` | Google AI tracing | No |
| `firebaseIntegration` | Firebase spans | No |

### Manual (Opt-In) Integrations

| Integration | What It Captures |
|-------------|-----------------|
| `captureConsoleIntegration` | Console calls as exceptions (not just breadcrumbs) |
| `dataloaderIntegration` | Batch loading spans |
| `extraErrorDataIntegration` | Enhanced error attributes |
| `knexIntegration` | Knex query builder spans |
| `rewriteFramesIntegration` | Stack frame path transformation |
| `supabaseIntegration` | Supabase client spans |
| `trpcMiddleware` | tRPC handler spans + errors |
| `zodErrorsIntegration` | Zod validation error enrichment |
| `pinoIntegration` | Pino logger integration |
| `consoleLoggingIntegration` | Console.log -> Sentry Logs (not just breadcrumbs) |

---

## 4. Error Monitoring

### Automatic Capture
- Uncaught exceptions
- Unhandled promise rejections
- Errors in `Bun.serve()` handlers

### Manual Capture
```typescript
// Capture exception
Sentry.captureException(new Error("something broke"));

// Capture message
Sentry.captureMessage("Something went wrong");
Sentry.captureMessage("Degraded performance", "warning");
```

### Severity Levels
`"fatal"` | `"error"` | `"warning"` | `"log"` | `"debug"` | `"info"`

---

## 5. Performance Tracing

### Auto-Created Spans
- HTTP incoming requests (via `bunServerIntegration`)
- HTTP outgoing requests (via `httpIntegration` + `nativeNodeFetchIntegration`)
- PostgreSQL queries (via `postgresIntegration`)
- AI SDK calls (via `anthropicAIIntegration`, etc.)

### Manual Span Creation

```typescript
// Recommended: auto-ending span
const result = await Sentry.startSpan(
  { name: "process-webhook", op: "webhook.process" },
  async () => {
    return await processWebhook(data);
  }
);

// Nested spans
await Sentry.startSpan({ name: "parent" }, async () => {
  await Sentry.startSpan({ name: "child-1" }, async () => { /* ... */ });
  await Sentry.startSpan({ name: "child-2" }, async () => { /* ... */ });
});

// Manual control (for middleware patterns)
Sentry.startSpanManual({ name: "middleware" }, (span) => {
  res.once("finish", () => {
    span.setHttpStatus(res.status);
    span.end();
  });
  return next();
});

// Independent spans (not auto-children)
const span = Sentry.startInactiveSpan({ name: "background-task" });
doWork();
span.end();
```

### Span Options
| Option | Type | Description |
|--------|------|-------------|
| `name` | string | Span identifier (required) |
| `op` | string | Operation type (`"http.client"`, `"db"`, `"queue.process"`, etc.) |
| `startTime` | number | Custom start timestamp |
| `attributes` | Record | Key-value metadata |
| `parentSpan` | Span | Explicit parent |
| `onlyIfParent` | boolean | Skip if no active parent |
| `forceTransaction` | boolean | Force display as transaction in UI |

### Span Attributes
```typescript
Sentry.startSpan({
  name: "my-op",
  attributes: { attr1: "value1", attr2: 42, attr3: true }
}, () => { /* ... */ });

// Add to active span
const span = Sentry.getActiveSpan();
if (span) {
  span.setAttribute("key", "value");
  span.setAttributes({ k1: "v1", k2: "v2" });
}
```

### Sampling

```typescript
Sentry.init({
  // Option 1: Uniform rate
  tracesSampleRate: 0.2, // 20% of transactions

  // Option 2: Dynamic sampling (takes precedence)
  tracesSampler: ({ name, attributes, inheritOrSampleWith }) => {
    if (name.includes("healthcheck")) return 0;     // Never sample
    if (name.includes("/api/webhook")) return 1;     // Always sample
    if (name.includes("/api/admin")) return 0.5;     // 50%
    return inheritOrSampleWith(0.2);                  // Default 20%
  },
});
```

**Precedence**: `tracesSampler` > parent decision > `tracesSampleRate`

---

## 6. Logs

**Requires**: SDK v9.41.0+, `enableLogs: true`

### Log Levels
`trace` | `debug` | `info` | `warn` | `error` | `fatal`

### Basic Usage
```typescript
Sentry.logger.trace("Entering function", { fn: "processOrder" });
Sentry.logger.debug("Cache lookup", { key: "user:123" });
Sentry.logger.info("Order created", { orderId: "order_456" });
Sentry.logger.warn("Rate limit approaching", { current: 95, max: 100 });
Sentry.logger.error("Payment failed", { reason: "card_declined" });
Sentry.logger.fatal("Database unavailable", { host: "primary" });
```

### Structured Logging with fmt
```typescript
const userId = "user_123";
Sentry.logger.info(
  Sentry.logger.fmt`User ${userId} purchased product`,
);
// Auto-extracts variables as searchable attributes
```

### Console Integration -> Sentry Logs
```typescript
Sentry.init({
  enableLogs: true,
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
});
// Now console.warn() and console.error() also go to Sentry Logs
```

### Scope Attributes on Logs
```typescript
// Global - all logs get these
Sentry.getGlobalScope().setAttributes({
  service: "omni-api",
  version: "2.260309.1",
});

// Per-request
Sentry.getIsolationScope().setAttributes({
  instanceId: instance.id,
  channelType: "whatsapp",
});
```

### Filtering Logs
```typescript
Sentry.init({
  enableLogs: true,
  beforeSendLog: (log) => {
    if (log.level === "debug") return null; // Drop debug in prod
    if (log.attributes?.password) {
      delete log.attributes.password; // Scrub sensitive data
    }
    return log;
  },
});
```

### Auto-Attached Log Attributes
- `environment`, `release`, `sdk.name`, `sdk.version`
- `server.address`
- `sentry.trace.parent_span_id` (auto-links logs to traces)
- `user.id`, `user.name`, `user.email` (if user set)

---

## 7. Metrics

**Requires**: SDK v10.25.0+

### Metric Types

```typescript
// Counter - track occurrences
Sentry.metrics.count("messages_received", 1, {
  attributes: { channelType: "whatsapp", instanceId: "abc" },
});

// Gauge - current values
Sentry.metrics.gauge("active_connections", 42, {
  attributes: { channelType: "whatsapp" },
});

// Distribution - value ranges (latency, sizes)
Sentry.metrics.distribution("webhook_latency", 187, {
  unit: "millisecond",
  attributes: { endpoint: "/api/webhook" },
});
```

### Configuration
```typescript
Sentry.init({
  // Filter metrics
  beforeSendMetric: (metric) => {
    // return null to drop
    return metric;
  },
  // Disable entirely
  // enableMetrics: false,
});

// Force flush
await Sentry.flush();
```

### Attribute Limits
- 2KB max per metric's attributes

---

## 8. Crons (Scheduled Job Monitoring)

Monitors uptime and performance of recurring jobs. Alerts on errors, timeouts, missed runs.

### withMonitor Wrapper (Simplest)
```typescript
Sentry.withMonitor("sync-contacts", () => {
  await syncContacts();
}, {
  schedule: { type: "crontab", value: "*/5 * * * *" },
  checkinMargin: 2,   // 2 min grace before "missed"
  maxRuntime: 10,      // 10 min max before "failed"
  timezone: "UTC",
});
```

### Manual Check-Ins (More Control)
```typescript
const checkInId = Sentry.captureCheckIn({
  monitorSlug: "sync-contacts",
  status: "in_progress",
});

try {
  await syncContacts();
  Sentry.captureCheckIn({ checkInId, monitorSlug: "sync-contacts", status: "ok" });
} catch (e) {
  Sentry.captureCheckIn({ checkInId, monitorSlug: "sync-contacts", status: "error" });
  throw e;
}
```

### Cron Library Integration
```typescript
import { CronJob } from "cron";
const CronJobWithCheckIn = Sentry.cron.instrumentCron(CronJob, "my-cron-job");
```

### Monitor Config Options
| Option | Description |
|--------|-------------|
| `schedule.type` | `"crontab"` or `"interval"` |
| `schedule.value` | Cron expression or interval value |
| `schedule.unit` | For intervals: `"minute"`, `"hour"`, `"day"` |
| `checkinMargin` | Grace minutes before marking missed |
| `maxRuntime` | Max minutes before marking failed |
| `timezone` | IANA timezone |
| `failureIssueThreshold` | Consecutive failures needed to create issue |
| `recoveryThreshold` | Consecutive successes to resolve issue |

**Rate limit**: Max 6 check-ins per minute per monitor+environment.

---

## 9. Profiling

### CRITICAL BUN LIMITATION

> **`@sentry/profiling-node` does NOT work with Bun.** It uses V8's CpuProfiler via a native Node addon. The docs explicitly state: "Profiling requires Node.js and won't run in environments like Deno or Bun."

**Status**: No server-side profiling available for Bun as of 2026-03-10.

### If We Ever Move to Node.js
```typescript
import { nodeProfilingIntegration } from "@sentry/profiling-node";
Sentry.init({
  integrations: [nodeProfilingIntegration()],
  profileSessionSampleRate: 0.1,
  profileLifecycle: 'trace', // or 'manual'
});
```

---

## 10. Breadcrumbs

### Auto-Captured Breadcrumbs (via default integrations)
- **Console logs** (`consoleIntegration`) — `console.log/warn/error` calls
- **HTTP requests** (`httpIntegration`) — incoming + outgoing HTTP
- **Fetch requests** (`nativeNodeFetchIntegration`) — outgoing fetch calls
- **PostgreSQL queries** (via OpenTelemetry instrumentation)

### Manual Breadcrumbs
```typescript
Sentry.addBreadcrumb({
  category: "webhook",
  message: "Received WhatsApp webhook",
  level: "info",
  data: {
    instanceId: "abc123",
    messageType: "text",
    // DO NOT include message content or user info!
  },
});
```

### Breadcrumb Fields
| Field | Type | Description |
|-------|------|-------------|
| `type` | string | `"default"`, `"http"`, `"navigation"`, `"error"` |
| `category` | string | Arbitrary category (e.g., `"auth"`, `"webhook"`) |
| `message` | string | Human-readable message |
| `level` | string | `"fatal"`, `"error"`, `"warning"`, `"log"`, `"info"`, `"debug"` |
| `timestamp` | number | Unix timestamp |
| `data` | object | Arbitrary key-value data |

### Filtering Breadcrumbs
```typescript
Sentry.init({
  maxBreadcrumbs: 50, // default 100
  beforeBreadcrumb(breadcrumb, hint) {
    // Drop breadcrumbs that might contain message content
    if (breadcrumb.category === "console" && breadcrumb.message?.includes("user")) {
      return null;
    }
    // Scrub URLs with user IDs
    if (breadcrumb.category === "http" && breadcrumb.data?.url) {
      breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
    }
    return breadcrumb;
  },
});
```

---

## 11. Privacy & Filtering — CRITICAL FOR OMNI

### The Problem
Omni handles WhatsApp conversations containing PII (names, phone numbers, message content). We MUST prevent user data from reaching Sentry while capturing all operational telemetry.

### Privacy Architecture — Three Layers

#### Layer 1: SDK-Side Prevention (Best — data never leaves the server)

**`sendDefaultPii: false`** (DEFAULT — keep it off!)
- Prevents auto-capture of: IP addresses, cookies, headers, user identifiers
- `requestDataIntegration` still captures URLs and query strings

**`beforeSend` — Error Event Scrubbing**
```typescript
Sentry.init({
  beforeSend(event, hint) {
    // Strip all user data
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      // Keep only internal ID
      event.user = event.user.id ? { id: event.user.id } : undefined;
    }

    // Scrub request body (may contain message content)
    if (event.request?.data) {
      delete event.request.data;
    }

    // Scrub request headers (may contain auth tokens)
    if (event.request?.headers) {
      const safeHeaders = ['content-type', 'content-length', 'accept', 'user-agent'];
      event.request.headers = Object.fromEntries(
        Object.entries(event.request.headers)
          .filter(([k]) => safeHeaders.includes(k.toLowerCase()))
      );
    }

    // Scrub cookies
    if (event.request?.cookies) {
      delete event.request.cookies;
    }

    // Scrub query strings (may contain phone numbers, tokens)
    if (event.request?.query_string) {
      delete event.request.query_string;
    }

    // Scrub breadcrumb data that might contain user content
    if (event.breadcrumbs) {
      event.breadcrumbs = event.breadcrumbs.map(bc => {
        if (bc.data?.body) delete bc.data.body;
        if (bc.data?.response_body) delete bc.data.response_body;
        return bc;
      });
    }

    return event;
  },
});
```

**`beforeSendTransaction` — Transaction Scrubbing**
```typescript
Sentry.init({
  beforeSendTransaction(event) {
    // Scrub parameterized URLs that might contain phone numbers
    // e.g., /api/instances/abc/messages/5511999999999
    if (event.transaction) {
      event.transaction = event.transaction
        .replace(/\/\d{10,15}/g, '/{phone}')
        .replace(/\/[a-f0-9-]{36}/g, '/{uuid}');
    }
    return event;
  },
});
```

**`beforeSendSpan` — Span Scrubbing**
```typescript
Sentry.init({
  beforeSendSpan(span) {
    // Scrub DB query parameters (may contain user data)
    if (span.data?.['db.statement']) {
      span.data['db.statement'] = scrubSqlParams(span.data['db.statement']);
    }
    // Scrub HTTP URLs
    if (span.data?.['http.url']) {
      span.data['http.url'] = scrubUrl(span.data['http.url']);
    }
    return span;
  },
});
```

**`beforeBreadcrumb` — Breadcrumb Scrubbing**
```typescript
Sentry.init({
  beforeBreadcrumb(breadcrumb, hint) {
    // Drop console breadcrumbs that might log message content
    if (breadcrumb.category === "console") {
      // Only keep warn/error, drop info/debug/log
      if (!["warning", "error"].includes(breadcrumb.level || "")) {
        return null;
      }
    }
    // Scrub HTTP breadcrumb URLs
    if (breadcrumb.data?.url) {
      breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
    }
    return breadcrumb;
  },
});
```

**`beforeSendLog` — Log Scrubbing**
```typescript
Sentry.init({
  enableLogs: true,
  beforeSendLog(log) {
    // Remove any attributes that might contain PII
    const sensitiveKeys = ['phone', 'email', 'name', 'content', 'body', 'message_content'];
    if (log.attributes) {
      for (const key of sensitiveKeys) {
        delete log.attributes[key];
      }
    }
    return log;
  },
});
```

**`ignoreErrors` — Drop Irrelevant Errors**
```typescript
Sentry.init({
  ignoreErrors: [
    "fb_xd_fragment",
    /^Network request failed$/,
    "ResizeObserver loop",
  ],
});
```

**`ignoreTransactions` — Drop Noisy Transactions**
```typescript
Sentry.init({
  ignoreTransactions: [
    /healthcheck/,
    /\/favicon\.ico/,
  ],
});
```

#### Layer 2: Server-Side Scrubbing (Sentry UI)
- Configure in Project Settings > Security & Privacy
- "Prevent Storing of IP Addresses" — enable this
- Server-side data scrubbing rules — regex patterns for phone numbers, emails
- Changes apply immediately without redeployment

#### Layer 3: Relay (Advanced — self-hosted only)
- Run a Sentry Relay between app and Sentry servers
- Can strip data before it leaves your infrastructure
- Most relevant for on-premise Sentry deployments

### RequestData Integration — PII Risk Matrix

| Field | Default (current) | Default (v11) | PII Risk | Recommendation |
|-------|-------------------|---------------|----------|----------------|
| `cookies` | **ON** | OFF | HIGH | **DISABLE** |
| `data` (body) | **ON** | OFF | **CRITICAL** | **DISABLE** — may contain message content |
| `headers` | **ON** | OFF | MEDIUM | **ALLOWLIST only** |
| `query_string` | **ON** | OFF | HIGH | **DISABLE** — may contain phone numbers |
| `url` | ON | ON | LOW | Keep, but scrub dynamic segments |
| `ip_address` | OFF | OFF | HIGH | Keep OFF |
| `user` (id, email, username) | **ON** | OFF | HIGH | **ID only** |

**Recommended Configuration:**
```typescript
Sentry.init({
  sendDefaultPii: false, // Keep OFF
  integrations: [
    Sentry.requestDataIntegration({
      include: {
        cookies: false,
        data: false,       // NO request bodies
        headers: false,    // NO headers (contain auth tokens)
        query_string: false,
        url: true,
        ip_address: false,
        user: false,       // We'll set user ID manually
      },
    }),
  ],
});
```

### What to Use Instead of User PII
```typescript
// Set safe user context — internal ID only, no PII
Sentry.setUser({ id: instance.id }); // Instance ID, not phone number
// Or for multi-tenant:
Sentry.setUser({ id: `org:${orgId}` });
```

---

## 12. Scopes (Request Isolation)

### Three Scope Types

1. **Global Scope** — applies to ALL events (app-wide)
2. **Isolation Scope** — per-request isolation (auto-forked by framework integrations)
3. **Current Scope** — ephemeral, for specific code blocks

### Merge Order
`global -> isolation -> current` (later overrides earlier)

### Usage
```typescript
// Global (app-wide)
Sentry.getGlobalScope().setAttributes({
  service: "omni-api",
  version: "2.260309.1",
});

// Per-request (auto-isolated in server frameworks)
Sentry.setTag("channelType", "whatsapp");
Sentry.setTag("instanceId", instance.id);
// Equivalent to: Sentry.getIsolationScope().setTag(...)

// Temporary scope
Sentry.withScope((scope) => {
  scope.setTag("job", "contact-sync");
  scope.setLevel("warning");
  Sentry.captureMessage("Sync took too long");
});

// Background job isolation
Sentry.withIsolationScope(() => {
  Sentry.setUser({ id: instance.id });
  Sentry.setTag("job", "message-sync");
  // Events here have their own isolated context
});
```

### Server Concurrency
Framework integrations (including `bunServerIntegration`) automatically fork isolation scopes per request. Concurrent requests get isolated contexts.

---

## 13. Enriching Events (Tags, Context, User)

### Tags (Searchable/Filterable)
```typescript
Sentry.setTag("channelType", "whatsapp");
Sentry.setTag("instanceId", "abc123");
Sentry.setTag("pluginId", "whatsapp-baileys");
```
- Key: max 32 chars, alphanumeric + `_.-:`
- Value: max 200 chars, no newlines

### Context (Viewable but NOT searchable)
```typescript
Sentry.setContext("instance", {
  id: "abc123",
  channelType: "whatsapp",
  status: "connected",
  syncState: "synced",
});

Sentry.setContext("job", {
  name: "contact-sync",
  scheduledAt: Date.now(),
  attempt: 3,
});
```
- Normalized to 3 levels deep (configurable via `normalizeDepth`)

### User (Safe — ID only)
```typescript
Sentry.setUser({ id: instance.id }); // No email, no username, no IP
Sentry.setUser(null); // Clear user
```
- Available fields: `id`, `email`, `username`, `ip_address` + custom keys
- For Omni: **ONLY use `id`** with internal identifiers

### Event Processors
```typescript
Sentry.addEventProcessor((event, hint) => {
  // hint.originalException has the raw error
  // Modify event as needed
  return event; // or null to drop
});
```

---

## 14. Attachments

```typescript
Sentry.getCurrentScope().addAttachment({
  filename: "debug-state.json",
  data: JSON.stringify(debugState),
  contentType: "application/json",
});

// Clear
Sentry.getCurrentScope().clearAttachments();
```

- Max compressed: 40MB
- Max uncompressed per event: 200MB
- Retention: 30 days
- Supported MIME types: text, JSON, images, video

**For Omni**: Useful for attaching sanitized debug state to errors, NOT message content.

---

## 15. Source Maps

```bash
npx @sentry/wizard@latest -i sourcemaps
```

Supports: webpack, Vite, Rollup, esbuild, tsc.

For Bun without a bundler, source maps may need custom handling since Bun runs TS directly.

---

## 16. Bun-Specific Limitations & Gotchas

1. **No bundled code support** — Auto-instrumentation requires unbundled source. Run with `bun --preload ./instrument.ts app.ts`
2. **No native profiling** — `@sentry/profiling-node` uses V8 CpuProfiler native addon, doesn't work in Bun
3. **Source maps** — Bun executes TS directly; source map upload needs custom approach
4. **`bunServerIntegration`** — Bun-specific, auto-instruments `Bun.serve()`. This IS compatible with Hono's `Bun.serve()` adapter
5. **OpenTelemetry** — The postgres integration uses `@opentelemetry/instrumentation-pg` under the hood. Other OTel integrations should work but are less tested on Bun
6. **No `fsIntegration`** — File system instrumentation is Node.js only (not in Bun's auto-enabled list)
7. **No `childProcessIntegration`** — Not auto-enabled in Bun
8. **No `anrIntegration`** — Application Not Responding detection is Node-only
9. **No `eventLoopBlockIntegration`** — Node-specific

---

## 17. Hono Framework Integration

Sentry has official Hono support. The community `@hono/sentry` middleware is **deprecated** — use `@sentry/bun` directly.

With Bun + Hono:
```typescript
// instrument.ts (loaded via --preload)
import * as Sentry from "@sentry/bun";

Sentry.init({
  dsn: "...",
  tracesSampleRate: 1.0,
});
```

```typescript
// app.ts
import { Hono } from "hono";

const app = new Hono();

// bunServerIntegration auto-captures Bun.serve() requests
// No middleware needed — Sentry hooks into Bun.serve() directly
export default app;
```

**Error handling**: By default, Sentry captures exceptions from Hono's `onError`. It excludes 3xx/4xx status codes.

---

## 18. AI Agent Monitoring

Auto-enabled integrations:
- `anthropicAIIntegration` — Anthropic SDK calls (tokens, model, latency)
- `openAIIntegration` — OpenAI SDK calls
- `langChainIntegration` — LangChain pipeline traces
- `vercelAiIntegration` — Vercel AI SDK

These capture:
- Model name, provider
- Token usage (input/output/total)
- Request/response latency
- Error rates

**For Omni**: The `anthropicAIIntegration` will auto-trace AI dispatch calls. May capture prompt content — need to verify and potentially scrub via `beforeSendSpan`.

---

## 19. Queue Instrumentation (NATS)

No built-in NATS integration. AMQP and Kafka are auto-enabled but not NATS.

**Manual instrumentation for NATS:**

### Producer Side
```typescript
Sentry.startSpan(
  {
    name: "event.publish",
    op: "queue.publish",
    attributes: {
      "messaging.message.id": eventId,
      "messaging.destination.name": subject,
      "messaging.message.body.size": payload.length,
    },
  },
  (span) => {
    const traceHeader = Sentry.spanToTraceHeader(span);
    const baggage = Sentry.spanToBaggageHeader(span);
    // Attach headers to NATS message for distributed tracing
    nats.publish(subject, payload, { headers: { "sentry-trace": traceHeader, baggage } });
  }
);
```

### Consumer Side
```typescript
const traceHeader = msg.headers?.get("sentry-trace");
const baggage = msg.headers?.get("baggage");

Sentry.continueTrace({ sentryTrace: traceHeader, baggage }, () => {
  Sentry.startSpan(
    {
      name: "event.process",
      op: "queue.process",
      attributes: {
        "messaging.message.id": eventId,
        "messaging.destination.name": subject,
        "messaging.message.body.size": msg.data.length,
        "messaging.message.receive.latency": receiveLatency,
      },
    },
    async () => {
      await processEvent(msg);
    }
  );
});
```

---

## 20. Cache Instrumentation (Redis)

### Auto with Redis Integration
```typescript
Sentry.init({
  integrations: [
    Sentry.redisIntegration({
      cachePrefixes: ["session:", "config:"],
    }),
  ],
});
```

### Manual Cache Spans
```typescript
// Cache write
Sentry.startSpan({ name: key, op: "cache.put", attributes: {
  "cache.key": [key],
  "cache.item_size": JSON.stringify(value).length,
}}, () => cache.set(key, value));

// Cache read
Sentry.startSpan({ name: key, op: "cache.get", attributes: {
  "cache.key": [key],
}}, (span) => {
  const value = cache.get(key);
  span.setAttribute("cache.hit", Boolean(value));
  if (value) span.setAttribute("cache.item_size", JSON.stringify(value).length);
});
```

---

## 21. OpenTelemetry

The Sentry JS SDK is built on OpenTelemetry under the hood. The `postgresIntegration` uses `@opentelemetry/instrumentation-pg`. Custom OTel instrumentations can be added alongside Sentry's.

---

## Summary: What Sentry Gives Us for Omni

### Immediately Useful (Auto)
- Error capture (uncaught exceptions, unhandled rejections)
- HTTP request tracing (Bun.serve via `bunServerIntegration`)
- Outgoing fetch tracing (WhatsApp API, Telegram API, etc.)
- PostgreSQL query tracing (Drizzle uses pg driver)
- AI SDK tracing (Anthropic calls)
- Console breadcrumbs
- Release tracking
- Environment tagging

### Useful with Manual Setup
- Structured logs (`Sentry.logger.*`)
- Custom metrics (counters, gauges, distributions)
- Cron monitoring (sync jobs, scheduled tasks)
- NATS queue instrumentation (manual spans)
- Custom span instrumentation for business logic

### NOT Available on Bun
- Server-side profiling (Node.js only)
- File system instrumentation
- Child process instrumentation
- ANR detection
- Event loop block detection

### Privacy Controls Available
- `sendDefaultPii: false` (default)
- `beforeSend` — scrub error events
- `beforeSendTransaction` — scrub transactions
- `beforeSendSpan` — scrub spans
- `beforeSendLog` — scrub logs
- `beforeBreadcrumb` — scrub/drop breadcrumbs
- `ignoreErrors` / `ignoreTransactions` / `ignoreSpans` — pattern-based dropping
- `requestDataIntegration` — configure exactly what request data to capture
- Server-side data scrubbing in Sentry UI
- All filtering happens BEFORE data leaves the server
