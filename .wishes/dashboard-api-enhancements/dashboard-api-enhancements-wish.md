# Dashboard API Enhancements

> API improvements needed to power the Phase 2 "Midnight Command Center" dashboard

## Context

The UI dashboard is being overhauled (Phase 2 of the Midnight Command Center redesign). During API review, we found:

1. **The current Dashboard has a data mismatch** — it defines `EventMetrics` with fields (`byType`, `byInstance`, `avgPerHour`, `avgPerMinute`) that don't exist in the actual `GET /event-ops/metrics` response. The dashboard silently renders `0` for these.

2. **Rich endpoints exist but return data in shapes not ideal for dashboard rendering** — the analytics endpoint lacks timeline/sparkline data, channel breakdowns, and direction stats.

3. **No real-time capability** — everything is polled.

## What Exists Today (Verified)

### `GET /event-ops/metrics` → `EventMetrics`
```typescript
{
  totalEvents: number;
  eventsLast24h: number;
  eventsLast7d: number;
  completed: number;
  failed: number;
  pending: number;
  avgProcessingTimeMs: number | null;
  avgAgentLatencyMs: number | null;
  p95ProcessingTimeMs: number | null;
  failureRate: number;
  errorsByStage: Record<string, number>;
  deadLettersPending: number;
  deadLettersResolved: number;
  payloadsStored: number;
  storageSizeBytes: number;
}
```

### `GET /events/analytics` → `EventAnalytics`
```typescript
{
  totalMessages: number;
  successfulMessages: number;
  failedMessages: number;
  successRate: number;
  avgProcessingTimeMs: number | null;
  avgAgentTimeMs: number | null;
  messageTypes: Record<string, number>;   // by content type
  errorStages: Record<string, number>;
  instances: Record<string, number>;      // event count per instance
}
```

### `GET /dead-letters/stats`
```typescript
{
  total: number;
  pending: number;
  resolved: number;
  abandoned: number;
  byEventType: Record<string, number>;
}
```

### `GET /automation-metrics`
```typescript
{
  running: boolean;
  instanceQueues?: Array<{ instanceId: string; activeCount: number; pendingCount: number }>;
}
```

### `GET /health`
```typescript
{
  status: 'healthy' | 'degraded';
  version: string;
  uptime: number;
  checks: {
    database: { status: 'ok' | 'error'; latency: number };
    nats: { status: 'ok'; details: { connected: boolean } };
  };
  instances?: { total: number; connected: number; byChannel: Record<string, number> };
}
```

## What's Missing for Dashboard

### 1. Timeline / Sparkline Data

**Problem**: No hourly or sub-daily event counts for sparkline charts on metric tiles.

**Need**: Add a `timeline` field to `GET /events/analytics` or `GET /event-ops/metrics`:

```typescript
timeline: Array<{ bucket: string; count: number }>
// e.g., last 24h in hourly buckets
```

**Implementation**: SQL query with `date_trunc('hour', received_at)` grouped by bucket, filtered by last 24h.

**Query param**: `?granularity=hourly|daily` (default `hourly`)

### 2. Channel & Direction Breakdown

**Problem**: `events/analytics` breaks down by `contentType` and `instanceId`, but not by `channel` or `direction` (inbound/outbound).

**Need**: Add to `EventAnalytics` response:

```typescript
byChannel: Record<string, number>;       // { whatsapp: 150, discord: 40 }
byDirection: { inbound: number; outbound: number };
```

**Implementation**: Two more grouped queries on `omni_events.channel` and `omni_events.direction`.

### 3. Event Rate Metrics

**Problem**: The Dashboard needs events/hour and events/minute for display, but these aren't computed server-side. The old Dashboard faked these with a custom interface.

**Need**: Add to `EventMetrics`:

```typescript
eventsPerHour: number;    // eventsLast24h / 24
eventsPerMinute: number;  // eventsLastHour / 60
eventsLastHour: number;   // count where received_at > now() - interval '1 hour'
```

**Implementation**: One additional count query with 1-hour window + simple division.

### 4. Richer Automation Metrics

**Problem**: Current `/automation-metrics` only returns queue state, no execution history.

**Need**: Enhance response:

```typescript
{
  running: boolean;
  totalExecutions: number;
  totalActions: number;
  successRate: number;            // % of successful executions
  avgExecutionTimeMs: number;
  recentFailures: number;         // failures in last 24h
  instanceQueues: Array<{ instanceId: string; activeCount: number; pendingCount: number }>;
}
```

**Implementation**: Query `automation_logs` table for aggregate stats. The `automation_logs` table and `GET /automation-logs` endpoint already exist — this just surfaces aggregates.

### 5. Dashboard Summary Endpoint (Optional, Nice-to-Have)

**Problem**: Dashboard currently needs 4+ API calls to render.

**Need**: Single `GET /api/v2/dashboard` that combines:

```typescript
{
  instances: { total: number; connected: number; byChannel: Record<string, number> };
  events: {
    total: number;
    last24h: number;
    lastHour: number;
    perHour: number;
    perMinute: number;
    timeline: Array<{ bucket: string; count: number }>;  // last 24h hourly
    byChannel: Record<string, number>;
    byDirection: { inbound: number; outbound: number };
    failureRate: number;
  };
  deadLetters: { pending: number; total: number };
  automations: { running: boolean; totalExecutions: number; successRate: number };
  system: { status: string; uptime: number; dbLatency: number; natsConnected: boolean };
}
```

This would let the dashboard load in a single request.

### 6. Real-Time Event Stream (Future)

**Problem**: Dashboard polls every 30s. Activity feed feels stale.

**Need**: `GET /api/v2/events/stream` returning Server-Sent Events (SSE):

```
event: event.received
data: {"id":"...","eventType":"message.received","instanceId":"...","receivedAt":"..."}

event: instance.status
data: {"instanceId":"...","isConnected":true}
```

**Implementation**: NATS subscription → SSE bridge. Low priority, but would enable live dashboard.

## Priority Order

| # | Enhancement | Effort | Impact |
|---|------------|--------|--------|
| 1 | Event rate metrics (eventsLastHour, perHour, perMinute) | Small | High — fixes broken dashboard stats |
| 2 | Timeline sparkline data (hourly buckets) | Small | High — enables metric tile sparklines |
| 3 | Channel & direction breakdown | Small | Medium — enables channel distribution charts |
| 4 | Richer automation metrics | Medium | Medium — enables automation health tile |
| 5 | Dashboard summary endpoint | Medium | Medium — performance optimization |
| 6 | Real-time SSE stream | Large | High — but can defer |

## Files to Modify

- `packages/api/src/services/event-ops.ts` — Add `eventsLastHour`, `eventsPerHour`, `eventsPerMinute`, `timeline`
- `packages/api/src/services/events.ts` — Add `byChannel`, `byDirection` to `getAnalytics()`
- `packages/api/src/services/automations.ts` — Enhance `getMetrics()` with log aggregates
- `packages/api/src/schemas/openapi/event-ops.ts` — Update `EventMetricsSchema`
- `packages/api/src/schemas/openapi/events.ts` — Update `EventAnalyticsSchema`
- `packages/sdk/src/client.ts` — Will auto-update with SDK regeneration
- (Optional) New `packages/api/src/routes/v2/dashboard.ts` for summary endpoint

## Acceptance Criteria

- [ ] `GET /event-ops/metrics` returns `eventsLastHour`, `eventsPerHour`, `eventsPerMinute`
- [ ] `GET /events/analytics?granularity=hourly` returns `timeline[]` with hourly buckets
- [ ] `GET /events/analytics` returns `byChannel` and `byDirection`
- [ ] `GET /automation-metrics` returns execution stats from automation_logs
- [ ] All new fields have OpenAPI schema definitions
- [ ] SDK regenerated with new types
- [ ] Existing consumers unaffected (additive changes only)
