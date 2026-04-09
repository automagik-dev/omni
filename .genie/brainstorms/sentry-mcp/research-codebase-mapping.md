# Sentry Integration - Codebase Mapping

> Exhaustive analysis of all Sentry integration points in the Omni v2 API codebase.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Integration Point 1: Sentry.init — Entry Point](#1-sentryinit--entry-point)
3. [Integration Point 2: Error Handler — captureException](#2-error-handler--captureexception)
4. [Integration Point 3: HTTP Middleware — Request Tracing](#3-http-middleware--request-tracing)
5. [Integration Point 4: Scheduled Jobs — Sentry Crons](#4-scheduled-jobs--sentry-crons)
6. [Integration Point 5: Event Bus — NATS Event Tracing](#5-event-bus--nats-event-tracing)
7. [Integration Point 6: Agent Dispatcher — AI Agent Tracing](#6-agent-dispatcher--ai-agent-tracing)
8. [Integration Point 7: Channel Plugins — Connection Monitoring](#7-channel-plugins--connection-monitoring)
9. [Integration Point 8: Database Operations](#8-database-operations)
10. [Integration Point 9: Media Processor — Background Jobs](#9-media-processor--background-jobs)
11. [Integration Point 10: Sync Worker — Long-Running Jobs](#10-sync-worker--long-running-jobs)
12. [Integration Point 11: Inbox Bridge — Polling Loop](#11-inbox-bridge--polling-loop)
13. [Integration Point 12: Session Cleaner](#12-session-cleaner)
14. [Integration Point 13: Instance Monitor — Health Checks](#13-instance-monitor--health-checks)
15. [Integration Point 14: Logger Integration — Breadcrumbs](#14-logger-integration--breadcrumbs)
16. [Integration Point 15: Graceful Shutdown](#15-graceful-shutdown)
17. [Sensitive Data & PII Mapping](#sensitive-data--pii-mapping)
18. [Custom Tags & Context](#custom-tags--context)
19. [Custom Metrics Opportunities](#custom-metrics-opportunities)
20. [Existing Infrastructure to Leverage](#existing-infrastructure-to-leverage)

---

## Architecture Overview

The Omni API is a **Bun.serve** HTTP server built with **Hono** framework. Key architectural layers:

```
┌─────────────────────────────────────────────────────┐
│  Bun.serve (HTTP)                                   │
│  ├── Hono Middleware Stack                          │
│  │   ├── timing, CORS, secureHeaders               │
│  │   ├── contextMiddleware (injects db, services)   │
│  │   ├── authMiddleware (API key validation)        │
│  │   ├── rateLimitMiddleware                        │
│  │   └── errorHandler (app.onError)                 │
│  └── Routes: /api/v2/*                              │
├─────────────────────────────────────────────────────┤
│  NATS Event Bus (JetStream)                         │
│  ├── Event listeners (connection, message, etc.)    │
│  ├── Event persistence → omni_events table          │
│  ├── Message persistence → chats/messages tables    │
│  └── Durable consumers with retry + dead-letter     │
├─────────────────────────────────────────────────────┤
│  Plugins/Workers                                     │
│  ├── Agent Dispatcher (AI agent dispatch)            │
│  ├── Media Processor (transcription, OCR)            │
│  ├── Sync Worker (history sync)                      │
│  ├── Inbox Bridge (Claude Code inbox polling)        │
│  ├── Session Cleaner (trash emoji → reset)           │
│  ├── Instance Monitor (health checks, reconnect)     │
│  └── History Push Tracker                            │
├─────────────────────────────────────────────────────┤
│  Scheduler (croner)                                  │
│  ├── dead-letter-auto-retry (every 15 min)           │
│  ├── payload-cleanup (daily 3 AM)                    │
│  ├── dead-letter-cleanup (daily 3 AM)                │
│  ├── contacts-sync-daily (4 AM)                      │
│  ├── groups-sync-daily (5 AM)                        │
│  └── unread-count-refresh (hourly)                   │
├─────────────────────────────────────────────────────┤
│  Embedded PostgreSQL (pgserve) + Drizzle ORM         │
└─────────────────────────────────────────────────────┘
```

---

## 1. Sentry.init — Entry Point

**File:** `packages/api/src/index.ts` (lines 1-20)
**Sentry Feature:** SDK Initialization

### Current State
- `configureLogging()` is called at line 16 before any other code
- `enableDefaultMetrics()` at line 340 starts Prometheus metrics
- `main()` at line 336 is the async entry point

### Recommended Integration

Sentry.init MUST be called **before** any other imports to capture all errors. With Bun, this means at the very top of `index.ts`:

```typescript
// Line 1 — BEFORE all other imports
import * as Sentry from '@sentry/bun';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV ?? 'development',
  release: packageJson.version,  // uses existing packageJson import
  tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
  profilesSampleRate: parseFloat(process.env.SENTRY_PROFILES_SAMPLE_RATE ?? '0.1'),

  // Integrations
  integrations: [
    Sentry.nativeNodeFetchIntegration(),  // traces outgoing HTTP (agent calls)
    Sentry.postgresIntegration(),          // auto-instruments pg queries
  ],

  // Data scrubbing
  beforeSend(event) {
    // Scrub PII — see §17 below
    return event;
  },
  beforeBreadcrumb(breadcrumb) {
    // Filter noisy breadcrumbs
    return breadcrumb;
  },
});
```

**Line placement:** Before line 8 (before ChannelRegistry import)
**Data flows:** Server version, environment name, trace sample rates
**PII risk:** None at init — DSN is not PII

### Shutdown Hook

In `setupShutdownHandlers()` (line 179), add Sentry flush before `process.exit()`:

```typescript
// Line 231, before process.exit(0)
await Sentry.close(5000); // flush pending events with 5s timeout
```

---

## 2. Error Handler — captureException

**File:** `packages/api/src/middleware/error.ts` (lines 328-347)
**Sentry Feature:** Error Capture, Context, Tags

### Current State

The `errorHandler` at line 328 is a Hono `ErrorHandler` registered via `app.onError()`. It:
1. Checks `isClientError()` to distinguish 4xx vs 5xx
2. Logs client errors at `debug` level
3. Logs server errors at `error` level with stack trace
4. Routes to type-specific handlers (`routeError`)

### Recommended Integration

Add `Sentry.captureException()` for **server errors only** (5xx). Client errors (4xx) are expected and should NOT be sent to Sentry.

```typescript
// In errorHandler, line 337-343 (the else branch for server errors)
export const errorHandler: ErrorHandler<{ Variables: AppVariables }> = (error, c) => {
  const requestId = c.get('requestId') ?? 'unknown';

  if (isClientError(error)) {
    log.debug('Client error', { ... });
  } else {
    log.error('Server error', { ... });

    // NEW: Capture to Sentry with request context
    Sentry.withScope((scope) => {
      scope.setTag('request_id', requestId);
      scope.setTag('http.method', c.req.method);
      scope.setTag('http.url', c.req.path);

      // Add OmniError context if available
      if (error instanceof OmniError) {
        scope.setTag('error.code', error.code);
        scope.setExtra('error.context', error.context);
        scope.setExtra('error.recoverable', error.recoverable);
      }

      // Channel errors
      if (error instanceof ChannelError) {
        scope.setTag('channel.type', error.channelType);
        if (error.instanceId) scope.setTag('instance.id', error.instanceId);
      }

      // Agent errors
      if (error instanceof AgentError) {
        if (error.providerId) scope.setTag('agent.provider_id', error.providerId);
      }

      Sentry.captureException(error);
    });
  }

  return routeError(c, error);
};
```

### Error Types to Capture (5xx only)

| Error Type | Sentry Level | Tags |
|-----------|-------------|------|
| `OmniError` with 5xx status | error | `error.code`, context |
| `ChannelError` (503/502/504) | error | `channel.type`, `instance.id` |
| `AgentError` (502/503/504) | error | `agent.provider_id` |
| `HTTPException` (5xx) | error | `http.status` |
| Database errors (non-constraint) | error | `db.error_code` |
| Unknown errors | error | — |

### Error Types to SKIP (4xx)

- `ZodError` → 400 (validation)
- `NotFoundError` → 404
- `ValidationError` → 400
- `ConflictError` → 409
- `HTTPException` < 500
- PostgreSQL 23505/23503 (unique/FK violations)
- Channel errors with status < 500 (WHATSAPP_INVALID_JID, etc.)

**Data flows:** Error messages, stack traces, OmniError context, request paths
**PII risk:** OmniError context may contain `instanceId`, `chatId`. Error messages may contain user-facing text. Need `beforeSend` scrubbing.

---

## 3. HTTP Middleware — Request Tracing

**File:** `packages/api/src/app.ts` (lines 80-99)
**Sentry Feature:** Performance Tracing (Transactions/Spans)

### Current State

- `timing()` middleware at line 81 adds Server-Timing headers
- Custom HTTP logger at lines 94-99 logs method, path, status, duration
- `x-request-id` generated in context middleware (`packages/api/src/middleware/context.ts:41`)
- Auth middleware captures IP, user-agent, response time for audit

### Recommended Integration

Use `@sentry/bun`'s built-in HTTP instrumentation. Since Bun.serve is used directly (line 161-165), Sentry's Bun integration auto-instruments incoming requests.

However, for Hono-specific route naming, add a middleware:

```typescript
// After authMiddleware, before routes
app.use('*', async (c, next) => {
  const transaction = Sentry.getActiveSpan();
  if (transaction) {
    // Set route pattern for grouping (not raw URL)
    Sentry.getCurrentScope().setTransactionName(`${c.req.method} ${c.req.routePath ?? c.req.path}`);
    Sentry.getCurrentScope().setTag('request_id', c.get('requestId'));
  }
  await next();
});
```

**Key middleware chain with Sentry spans:**

| Middleware | File:Line | Sentry Span? |
|-----------|-----------|-------------|
| `timing()` | app.ts:81 | Auto (Server-Timing) |
| `defaultTimeoutMiddleware` | app.ts:87-90 | No (wraps handler) |
| `defaultBodyLimitMiddleware` | app.ts:91 | No |
| HTTP logger | app.ts:94-99 | No (use Sentry instead) |
| `cors()` | app.ts:107-116 | No |
| `secureHeaders()` | app.ts:117 | No |
| `contextMiddleware` | app.ts:118 | No |
| `authMiddleware` | auth.ts:16 | Yes — `auth.validate` span |
| `rateLimitMiddleware` | app.ts:214 | No |

**Data flows:** HTTP method, URL path, status code, response time, IP address, user-agent
**PII risk:** IP addresses in `x-forwarded-for`. URL paths may contain instance IDs (UUIDs, not PII). User-agent strings.

---

## 4. Scheduled Jobs — Sentry Crons

**File:** `packages/api/src/scheduler.ts` (lines 1-256)
**Sentry Feature:** Crons Monitoring

### Current State

6 scheduled jobs registered via `croner`. Each job:
1. Records start time
2. Executes handler
3. Calls `recordScheduledJob(name, 'success'|'failure', durationSec)` for metrics
4. Throws on failure (caught by croner)

### Jobs to Monitor with Sentry Crons

| Job Name | Schedule | Monitor ID | Priority |
|----------|----------|-----------|----------|
| `dead-letter-auto-retry` | Every 15 min | `dead-letter-auto-retry` | HIGH |
| `payload-cleanup` | Daily 3 AM | `payload-cleanup` | MEDIUM |
| `dead-letter-cleanup` | Daily 3 AM | `dead-letter-cleanup` | MEDIUM |
| `contacts-sync-daily` | Daily 4 AM | `contacts-sync-daily` | LOW |
| `groups-sync-daily` | Daily 5 AM | `groups-sync-daily` | LOW |
| `unread-count-refresh` | Hourly | `unread-count-refresh` | LOW |

### Recommended Integration

Wrap each job handler with Sentry Cron check-ins:

```typescript
// In scheduler.ts, wrap each handler registration
scheduler.register({
  name: 'dead-letter-auto-retry',
  cron: CronExpressions.EVERY_15_MINUTES,
  handler: Sentry.withMonitor('dead-letter-auto-retry', async () => {
    // ... existing handler code
  }, {
    schedule: { type: 'crontab', value: '*/15 * * * *' },
    checkinMargin: 5,    // allow 5 min late
    maxRuntime: 10,      // alert if > 10 min
    timezone: 'UTC',
  }),
});
```

**Alternative:** The scheduler in `packages/core/src/scheduler/index.ts` (line 52-80) has a central `register` method. Could add Sentry wrapping at the Scheduler class level, applying to ALL jobs automatically.

**Data flows:** Job name, schedule, duration, success/failure
**PII risk:** None — job names are internal identifiers

---

## 5. Event Bus — NATS Event Tracing

**File:** `packages/core/src/events/nats/client.ts` (lines 157-200)
**Sentry Feature:** Performance Tracing (Custom Spans), Breadcrumbs

### Current State

- `NatsEventBus.publish()` at line 157 publishes events with type-safe payload
- `publishInternal()` at line 185 creates event envelope with `id`, `type`, `timestamp`, `metadata`
- Subscribers process events via durable consumers with retry/dead-letter support
- Metrics already track: `natsMessagesPublished`, `natsPublishLatency`, `natsMessagesReceived`

### Recommended Integration

#### 5a. Publish Tracing

Add a Sentry span for each event publish:

```typescript
// In publishInternal(), around the js.publish() call
const publishSpan = Sentry.startInactiveSpan({
  name: `nats.publish ${type}`,
  op: 'queue.publish',
  attributes: {
    'messaging.system': 'nats',
    'messaging.destination': subject,
    'messaging.message.id': eventId,
  },
});
// ... publish ...
publishSpan?.end();
```

#### 5b. Subscribe/Consumer Tracing

When a consumer processes an event, create a transaction:

```typescript
// In subscription.ts, wrapping the handler call
await Sentry.startSpan({
  name: `nats.process ${event.type}`,
  op: 'queue.process',
  attributes: {
    'messaging.system': 'nats',
    'messaging.message.id': event.id,
    'messaging.consumer': consumerName,
  },
}, async () => {
  await handler(event);
});
```

#### 5c. Breadcrumbs

Add breadcrumbs for event lifecycle:

```typescript
Sentry.addBreadcrumb({
  category: 'nats',
  message: `Published ${type}`,
  data: { eventId, stream, instanceId: metadata?.instanceId },
  level: 'info',
});
```

**Data flows:** Event types, event IDs, correlation IDs, instance IDs
**PII risk:** Event payloads contain message content, phone numbers, chat names — MUST NOT be sent to Sentry. Only send metadata (event type, IDs).

---

## 6. Agent Dispatcher — AI Agent Tracing

**File:** `packages/api/src/plugins/agent-dispatcher.ts` (lines 1-300+)
**Sentry Feature:** Performance Tracing, Error Capture, Custom Metrics

### Current State

The agent dispatcher:
1. Subscribes to `message.received` and `reaction.received` events
2. Evaluates trigger conditions (DM, mention, reply, name match)
3. Debounces messages per chat
4. Rate-limits per user per channel per instance
5. Dispatches to IAgentProvider (Agno, OpenClaw, Webhook, Claude Code, etc.)
6. Splits responses and sends back via channel plugin
7. Has its own `traceId` and `correlationId` for journey tracking

### Recommended Integration

#### 6a. Agent Dispatch Transaction

Each agent dispatch should be a Sentry transaction:

```typescript
await Sentry.startSpan({
  name: 'agent.dispatch',
  op: 'ai.agent',
  attributes: {
    'agent.provider': providerSchema,
    'agent.instance_id': instanceId,
    'agent.trigger_type': triggerType,
    'agent.session_strategy': sessionStrategy,
  },
}, async (span) => {
  // child span: provider.trigger()
  await Sentry.startSpan({ name: `agent.trigger.${providerSchema}`, op: 'ai.run' }, async () => {
    await provider.trigger(context);
  });

  // child span: send responses
  await Sentry.startSpan({ name: 'agent.send_response', op: 'channel.send' }, async () => {
    // split and send
  });
});
```

#### 6b. Provider Error Capture

Provider failures should be captured with rich context:

```typescript
Sentry.withScope((scope) => {
  scope.setTag('agent.provider', providerSchema);
  scope.setTag('agent.instance_id', instanceId);
  scope.setTag('channel.type', channelType);
  scope.setExtra('trigger_type', triggerType);
  scope.setExtra('session_id', sessionId);
  // DO NOT include: message content, chatId, phone numbers
  Sentry.captureException(error);
});
```

**Data flows:** Provider type, instance ID, trigger type, session strategy, response timing
**PII risk:** HIGH. Message content, phone numbers (JIDs), chat names, push names all flow through here. The `payload.content.text`, `payload.from`, `payload.chatId` fields are PII.

---

## 7. Channel Plugins — Connection Monitoring

**File:** `packages/api/src/plugins/event-listeners.ts` (lines 1-80)
**File:** `packages/api/src/plugins/instance-monitor.ts` (lines 1-100)
**Sentry Feature:** Breadcrumbs, Error Capture, Custom Metrics

### Current State

- `setupConnectionListener()` handles `instance.connected` and `instance.disconnected`
- `InstanceMonitor` runs health checks every 30s and auto-reconnects
- Connection failures update DB state and trigger reconnection attempts

### Recommended Integration

#### 7a. Connection Breadcrumbs

```typescript
// In setupConnectionListener, on connect
Sentry.addBreadcrumb({
  category: 'channel',
  message: `Instance connected: ${channelType}`,
  data: { instanceId, channelType, profileName },
  level: 'info',
});

// On disconnect
Sentry.addBreadcrumb({
  category: 'channel',
  message: `Instance disconnected: ${channelType}`,
  data: { instanceId, reason, willReconnect },
  level: 'warning',
});
```

#### 7b. Instance Monitor Error Capture

When reconnection fails after max attempts, capture as Sentry error:

```typescript
Sentry.captureMessage(`Instance reconnection failed after ${maxAttempts} attempts`, {
  level: 'error',
  tags: { instanceId, channelType },
  extra: { lastError, attempts },
});
```

**Data flows:** Instance IDs, channel types, profile names, connection states
**PII risk:** `profileName` is PII (user's WhatsApp display name). `ownerIdentifier` is a phone number.

---

## 8. Database Operations

**File:** `packages/api/src/index.ts` (lines 316-391, migration/startup)
**File:** `packages/core/src/metrics/index.ts` (lines 162-205, DB metrics)
**Sentry Feature:** DB Tracing (auto-instrumented), Error Capture

### Current State

- Drizzle ORM with PostgreSQL (embedded pgserve or external)
- Auto-migration on startup with timeout (60s)
- Metrics: `dbPoolSize`, `dbQueries`, `dbQueryDuration`, `dbErrors`
- Database readiness check loops up to 30 times

### Recommended Integration

Sentry's `postgresIntegration()` auto-instruments queries when using the `pg` driver. Since Drizzle sits on top of `postgres.js` (Bun-compatible), verify auto-instrumentation works.

If not auto-instrumented, add manual spans for critical queries:

```typescript
// For migration
await Sentry.startSpan({ name: 'db.migrate', op: 'db' }, async () => {
  await applyMigrations(db, migrationPath);
});

// For readiness check
await Sentry.startSpan({ name: 'db.ready_check', op: 'db' }, async () => {
  await waitForDatabaseReady(db);
});
```

**Data flows:** Query strings, table names, migration file names
**PII risk:** Database query parameters may contain PII (searching by phone number, chat ID). Sentry's DB integration typically only captures parameterized queries, not values — verify this.

---

## 9. Media Processor — Background Jobs

**File:** `packages/api/src/plugins/media-processor.ts` (lines 1-100)
**Sentry Feature:** Performance Tracing, Error Capture

### Current State

- Subscribes to `message.received` events where `hasMedia=true`
- Downloads media to local filesystem
- Processes with `MediaProcessingService` (transcription, OCR, description)
- Stores results in `media_content` table
- Updates message record

### Recommended Integration

```typescript
await Sentry.startSpan({
  name: 'media.process',
  op: 'task',
  attributes: {
    'media.type': contentType,
    'media.processing_type': processingType,
    'media.instance_id': instanceId,
  },
}, async () => {
  // download span
  await Sentry.startSpan({ name: 'media.download', op: 'http.client' }, async () => {
    await downloadMedia();
  });

  // process span
  await Sentry.startSpan({ name: `media.${processingType}`, op: 'ai.run' }, async () => {
    await processMedia();
  });

  // store span
  await Sentry.startSpan({ name: 'media.store', op: 'db' }, async () => {
    await storeResult();
  });
});
```

**Data flows:** Media URLs, MIME types, processing type, result text
**PII risk:** HIGH. Media content (audio transcriptions, image descriptions) is PII. Media URLs may contain tokens. NEVER send media content or transcription text to Sentry.

---

## 10. Sync Worker — Long-Running Jobs

**File:** `packages/api/src/plugins/sync-worker.ts` (lines 100-177)
**Sentry Feature:** Performance Tracing (long spans), Error Capture

### Current State

- Subscribes to `sync.started` events
- Processes 4 sync types: messages, contacts, groups, history-push
- Has rate limiting per channel type
- Can process thousands of messages per sync

### Recommended Integration

Sync jobs are long-running (minutes to hours). Use Sentry transactions with periodic heartbeat:

```typescript
await Sentry.startSpan({
  name: `sync.${type}`,
  op: 'task',
  attributes: {
    'sync.type': type,
    'sync.instance_id': instanceId,
    'sync.job_id': jobId,
    'sync.channel_type': channelType,
  },
}, async (span) => {
  // Process sync...
  // Use child spans for batches
  for (const batch of batches) {
    await Sentry.startSpan({
      name: `sync.batch`,
      op: 'task',
    }, async () => {
      await processBatch(batch);
    });
  }
});
```

**Data flows:** Job IDs, instance IDs, channel types, sync depth, message counts
**PII risk:** Sync processes chat names, message content, contact names. None of this should reach Sentry.

---

## 11. Inbox Bridge — Polling Loop

**File:** `packages/api/src/plugins/inbox-bridge.ts` (lines 1-80)
**Sentry Feature:** Error Capture, Breadcrumbs

### Current State

- Polls Claude Code team inboxes every 2s
- Discovers genie providers from DB every 60s
- Reads inbox files, parses metadata, sends messages via channel plugins
- Uses cursor file for state tracking

### Recommended Integration

Light-touch integration — mostly error capture:

```typescript
// On poll failure
Sentry.captureException(error, {
  tags: { component: 'inbox-bridge', team: teamName },
  extra: { inboxPath, agentPattern },
});

// On send failure
Sentry.captureException(error, {
  tags: { component: 'inbox-bridge', action: 'send' },
  extra: { channel, instanceId },
});
```

**Data flows:** Team names, agent names, inbox file paths
**PII risk:** Inbox message text contains user conversation content — MUST NOT be sent to Sentry.

---

## 12. Session Cleaner

**File:** `packages/api/src/plugins/session-cleaner.ts` (lines 1-193)
**Sentry Feature:** Error Capture (light)

### Current State

- Subscribes to `message.received`
- Detects trash emoji (🗑️)
- Calls `IAgentProvider.resetSession()` or direct AgnoOS client
- Sends confirmation/error messages

### Recommended Integration

Minimal — only capture unexpected errors:

```typescript
// Line 148, in catch block (after filtering skippable errors)
Sentry.captureException(error, {
  tags: { component: 'session-cleaner', instance_id: instanceId },
});
```

**Data flows:** Instance IDs, session IDs, provider types
**PII risk:** LOW. `chatId` and `from` (phone JID) are used but shouldn't reach Sentry.

---

## 13. Instance Monitor — Health Checks

**File:** `packages/api/src/plugins/instance-monitor.ts` (lines 1-100)
**Sentry Feature:** Error Capture, Custom Metrics

### Current State

- Runs every 30s
- Checks connection status for all active instances
- Auto-reconnects with exponential backoff
- Max 3 concurrent reconnects, max 10 attempts

### Recommended Integration

```typescript
// After max reconnection attempts exhausted
Sentry.captureMessage('Instance permanently disconnected', {
  level: 'error',
  tags: {
    instance_id: instanceId,
    channel_type: channelType,
  },
  extra: {
    attempts: reconnectState.attempts,
    lastError: reconnectState.error,
  },
});
```

**Data flows:** Instance IDs, connection states, reconnection attempts
**PII risk:** LOW. Instance metadata only.

---

## 14. Logger Integration — Breadcrumbs

**File:** `packages/core/src/logger/index.ts` (lines 1-239)
**Sentry Feature:** Breadcrumbs

### Current State

The logging system:
- Central `configureLogging()` / `createLogger()` API
- Module-scoped loggers (e.g., `createLogger('api:startup')`)
- Levels: debug, info, warn, error
- Output: pretty (TTY) or JSON (production)
- Built-in redaction of tokens (bot tokens, Bearer, API keys, connection strings)
- Log buffer for SSE streaming

### Recommended Integration

Add Sentry breadcrumbs in the `writeLog()` function:

```typescript
// In writeLog(), line 124-150
function writeLog(entry: LogEntry): void {
  // ... existing level/module checks ...

  // Add Sentry breadcrumb for warn/error (not debug/info to avoid noise)
  if (entry.level === 'warn' || entry.level === 'error') {
    Sentry.addBreadcrumb({
      category: entry.module,
      message: entry.msg,
      level: entry.level === 'error' ? 'error' : 'warning',
      data: redacted,  // already redacted by this point
      timestamp: entry.time / 1000,
    });
  }

  // ... existing output ...
}
```

**Note:** The existing `redactObject()` in `logger/redact.ts` already strips:
- Telegram bot tokens
- Bearer tokens
- API keys (sk-*, key-*, api-*, secret-*, token-*)
- Connection strings (postgres://, nats://, redis://)

This redaction should also be applied to Sentry breadcrumbs. Since `writeLog` calls `redactObject` before output, the breadcrumb data is already redacted if we use the `redacted` variable.

**Data flows:** Log messages, module names, structured data fields
**PII risk:** MEDIUM. Log messages may contain instance IDs, chat IDs, error messages with PII. The existing redaction covers tokens but NOT phone numbers or message content.

---

## 15. Graceful Shutdown

**File:** `packages/api/src/index.ts` (lines 170-242)
**Sentry Feature:** SDK Flush

### Current State

`setupShutdownHandlers()` at line 171:
1. Sets `isShuttingDown` flag
2. 15s force-exit timeout
3. Stops scheduler, HTTP server, agent dispatcher, inbox bridge
4. Stops instance monitor, channel registry
5. Closes NATS, DB
6. Stops embedded pgserve
7. `process.exit(0)`

### Recommended Integration

Add `Sentry.close()` before process exit:

```typescript
// Before process.exit(0) at line 233
try {
  await Sentry.close(5000);
} catch {
  // Don't block shutdown for Sentry
}
process.exit(0);
```

Also in the `main().catch()` at line 462:

```typescript
main().catch(async (error) => {
  log.error('Failed to start API server', { error: String(error) });
  Sentry.captureException(error);
  await Sentry.close(5000);
  process.exit(1);
});
```

And in `earlyShutdown` at line 351:

```typescript
const earlyShutdown = async () => {
  log.info('Shutdown during startup — cleaning up');
  Sentry.captureMessage('Shutdown during startup', { level: 'warning' });
  await Sentry.close(2000);
  // ... existing cleanup
};
```

---

## Sensitive Data & PII Mapping

### PII Data Flows by Component

| Component | PII Fields | Risk Level |
|-----------|-----------|-----------|
| **Event Persistence** | `payload.content.text` (message body), `payload.from` (phone JID), `payload.chatId`, `payload.content.mediaUrl` | **CRITICAL** |
| **Message Persistence** | `chatName`, `pushName` (display name), `from`, `chatId`, message body | **CRITICAL** |
| **Agent Dispatcher** | Message content, `from` (phone), `chatId`, session ID (contains phone), chat history | **CRITICAL** |
| **Media Processor** | Transcription text, image descriptions, document extraction, media URLs | **HIGH** |
| **Session Cleaner** | `from` (phone JID), `chatId` | **MEDIUM** |
| **Instance Monitor** | `profileName`, `ownerIdentifier` (phone number) | **MEDIUM** |
| **Connection Events** | `profileName`, `profilePicUrl`, `ownerIdentifier` | **MEDIUM** |
| **Inbox Bridge** | Inbox message text (conversation content) | **HIGH** |
| **Auth Middleware** | IP address, API key (redacted), user-agent | **LOW** |
| **HTTP Requests** | URL paths (contain UUIDs, not PII) | **LOW** |

### Required `beforeSend` Scrubbing

```typescript
Sentry.init({
  beforeSend(event) {
    // Strip phone numbers from all string fields
    // WhatsApp JID format: 5511999999999@s.whatsapp.net
    // Phone format: +5511999999999

    // Strip message content from extra/contexts
    if (event.extra) {
      delete event.extra['message_content'];
      delete event.extra['text_content'];
      delete event.extra['transcription'];
      delete event.extra['chatName'];
      delete event.extra['pushName'];
      delete event.extra['profileName'];
    }

    return event;
  },

  // Use denyUrls/allowUrls for URL filtering
  // Use sendDefaultPii: false (default)
  sendDefaultPii: false,
});
```

### Data Scrubbing Rules for Sentry Dashboard

Configure in Sentry project settings > Security & Privacy:

1. **Phone number pattern:** `\d{10,15}@[a-z.]+` → `[PHONE_REDACTED]`
2. **WhatsApp JID:** `\d+@s\.whatsapp\.net` → `[JID_REDACTED]`
3. **Chat name fields:** `chatName`, `pushName`, `profileName` → remove
4. **Message content fields:** `textContent`, `content.text`, `mediaTranscript` → remove
5. **Media URLs:** `mediaUrl`, `profilePicUrl` → remove

---

## Custom Tags & Context

### Global Tags (set once at init)

| Tag | Source | Example |
|-----|--------|---------|
| `service` | hardcoded | `omni-api` |
| `environment` | `NODE_ENV` | `production` |
| `version` | `package.json` | `2.260309.1` |

### Per-Request Tags (set in middleware)

| Tag | Source | Example |
|-----|--------|---------|
| `request_id` | `x-request-id` header or generated | `req_m1abc_xyz123` |
| `http.method` | request | `POST` |
| `http.route` | Hono route pattern | `/api/v2/instances/:id/messages` |
| `api_key.name` | auth middleware | `primary` |

### Per-Event Tags (set in error/event handlers)

| Tag | Source | Example |
|-----|--------|---------|
| `instance.id` | event metadata | `uuid` |
| `channel.type` | event metadata | `whatsapp-baileys` |
| `event.type` | NATS event | `message.received` |
| `agent.provider` | dispatch context | `agno` |
| `agent.trigger_type` | dispatch logic | `dm`, `mention`, `reply` |
| `error.code` | OmniError | `CHANNEL_NOT_CONNECTED` |
| `sync.type` | sync worker | `messages`, `contacts` |
| `scheduler.job` | cron handler | `dead-letter-auto-retry` |

### Sentry Contexts

```typescript
// User context (instance-level, not person-level to avoid PII)
Sentry.setContext('instance', {
  id: instanceId,
  channel: channelType,
  name: instanceName,
});

// Agent context
Sentry.setContext('agent', {
  provider: providerSchema,
  sessionStrategy: sessionStrategy,
  triggerType: triggerType,
});
```

---

## Custom Metrics Opportunities

### What Sentry Metrics Would Add Over Prometheus

The codebase already has comprehensive Prometheus metrics (`packages/core/src/metrics/index.ts`). Sentry metrics complement these by correlating with errors:

| Metric | Type | Tags | Value |
|--------|------|------|-------|
| `agent.dispatch.duration` | distribution | `provider`, `channel_type`, `trigger_type` | ms |
| `agent.dispatch.success_rate` | counter | `provider`, `channel_type` | increment |
| `message.processing.duration` | distribution | `channel_type`, `content_type` | ms |
| `sync.job.duration` | distribution | `sync_type`, `channel_type` | ms |
| `instance.reconnect.attempts` | counter | `channel_type` | increment |
| `media.processing.duration` | distribution | `media_type`, `processing_type` | ms |

### Existing Prometheus Metrics That Map to Sentry

| Prometheus Metric | Sentry Equivalent |
|------------------|-------------------|
| `omni_http_request_duration_seconds` | Auto transaction duration |
| `omni_events_processed_total` | Custom counter |
| `omni_scheduled_job_runs_total` | Cron check-ins |
| `omni_db_query_duration_seconds` | Auto DB span duration |
| `omni_nats_publish_latency_seconds` | Custom span duration |

---

## Existing Infrastructure to Leverage

### 1. Logger Redaction (`packages/core/src/logger/redact.ts`)

Already redacts:
- Telegram bot tokens
- Bearer tokens
- API keys
- Connection strings

**Extend for Sentry:** Add phone number and JID patterns:
```typescript
const PHONE_RE = /\b\d{10,15}@[a-z.]+/g;  // WhatsApp JIDs
const PHONE_INTL_RE = /\+\d{10,15}/g;       // International phones
```

### 2. Journey Tracker (`packages/core/src/tracing/journey-tracker.ts`)

Already tracks T0→T11 message lifecycle with correlation IDs. This maps directly to Sentry distributed tracing:

| Journey Stage | Sentry Span |
|--------------|-------------|
| T0: platformReceivedAt | Start of parent transaction |
| T1: pluginReceivedAt | `channel.receive` span |
| T2: eventPublishedAt | `nats.publish` span |
| T3: eventConsumedAt | `nats.consume` span start |
| T4: dbStoredAt | `db.insert` span |
| T5: agentNotifiedAt | `agent.notify` span |
| T7: agentCompletedAt | `agent.complete` span |
| T8-T11: outbound | `channel.send` span |

### 3. Correlation IDs

Events already carry `metadata.correlationId`. This can be used as Sentry's trace ID for distributed tracing:

```typescript
// When publishing event with trace
Sentry.startSpan({
  traceId: correlationId,  // link Sentry trace to event correlation
  // ...
});
```

### 4. Error Classes (`packages/core/src/errors.ts`)

Well-structured error hierarchy:
- `OmniError` (base) with `code`, `context`, `recoverable`
- `ChannelError` with `channelType`, `instanceId`
- `AgentError` with `providerId`
- `ValidationError`, `NotFoundError`, `ConflictError`

All include `toJSON()` for serialization. These map perfectly to Sentry's error grouping.

### 5. Metrics Infrastructure (`packages/core/src/metrics/index.ts`)

Comprehensive prom-client metrics already defined. Sentry can complement but not replace these. The Prometheus metrics serve operational dashboards; Sentry correlates errors with performance.

---

## Implementation Priority

### Phase 1: Error Capture (Day 1)
1. `Sentry.init()` in `index.ts` (top of file)
2. `Sentry.captureException()` in error handler (5xx only)
3. `Sentry.close()` in shutdown handlers
4. `beforeSend` PII scrubbing

### Phase 2: Cron Monitoring (Day 1-2)
5. Wrap all 6 scheduler jobs with `Sentry.withMonitor()`
6. Configure alerting for missed crons

### Phase 3: Performance Tracing (Day 2-3)
7. HTTP request tracing (auto + Hono route naming)
8. Agent dispatch tracing
9. NATS event publish/consume spans
10. Media processing spans

### Phase 4: Breadcrumbs & Context (Day 3)
11. Logger integration (warn/error → breadcrumbs)
12. Channel connection breadcrumbs
13. Custom tags and context enrichment

### Phase 5: Advanced (Optional)
14. Sync worker long-span monitoring
15. Instance monitor health check alerts
16. Custom metrics (if Prometheus gaps exist)
17. Source maps for production stack traces

---

## Package & SDK Considerations

### SDK Choice

Use `@sentry/bun` — the official Bun SDK. It supports:
- Bun.serve auto-instrumentation
- Native fetch tracing
- Node.js API compatibility
- Performance profiling

### Installation

```bash
bun add @sentry/bun
```

### Environment Variables

```
SENTRY_DSN=https://xxx@o123.ingest.sentry.io/456
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_PROFILES_SAMPLE_RATE=0.1
```

### Source Maps

For production builds, upload source maps to Sentry:

```bash
# In CI/CD
bunx @sentry/cli sourcemaps upload ./dist --release $VERSION
```
