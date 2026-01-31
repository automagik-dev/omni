# WISH: Unified Logging System

> Replace chaotic console.log with a performant, color-coded, filterable logging system that streams to UI and is LLM-readable.

**Status:** DRAFT
**Created:** 2026-01-31
**Author:** WISH Agent
**Beads:** omni-72g

---

## Problem Statement

Current logging is a mess:
- **25+ files** using raw `console.log` with inconsistent formats
- **Mixed patterns**: Hand-rolled logger in API, pino only for Baileys socket
- **No colors** = hard to scan
- **Verbose timestamps** eating horizontal space (`[2026-01-31T04:24:09.108Z]`)
- **No filtering** by module/source
- **No UI streaming** (v1 had this via SSE)
- **External loggers** (Baileys pino) leaking raw JSON: `{"level":40,"time":...}`

### Current Output (Bad)
```
[2026-01-31T04:24:09.108Z] INFO: Starting channel plugin discovery {"module":"plugin-loader"}
[WhatsApp Auth] Restored creds for 3f49a3b2..., registered: true
{"level":40,"time":1769833470288,"pid":504149,"hostname":"NMSTX-WORKSTATION","msg":"Timeout..."}
```

### Desired Output (Good)
```
04:24:09 INFO  plugin-loader     Starting channel plugin discovery
04:24:09 INFO  whatsapp:auth     Restored creds instanceId=3f49a3b2 registered=true
04:24:10 WARN  whatsapp:baileys  Timeout in AwaitingInitialSync, forcing state to Online
```

---

## Discovery Notes

### What Exists Today

| Component | Current State |
|-----------|---------------|
| `packages/api/src/plugins/logger.ts` | Hand-rolled console wrapper, basic context |
| `packages/channel-sdk/src/types/context.ts` | Logger interface (debug/info/warn/error/child) |
| `packages/channel-whatsapp/src/socket.ts` | Minimal pino for Baileys only |
| `packages/api/src/ws/logs.ts` | Exists but unclear if functional |
| pino dependency | Only in channel-whatsapp |

### What Omni v1 Did (Reference)

- **SSE-based streaming** to UI with file polling
- **Service color coding** (api=blue, whatsapp=green, discord=purple)
- **Level detection** via heuristics
- **Circular buffer** (500 entries) for recent history
- **PM2 integration** for process management
- **Multi-format parser** normalizing heterogeneous sources

Key files:
- `/home/cezar/dev/omni/gateway/src/logs.ts` (486 lines)
- `/home/cezar/dev/omni/resources/ui/src/hooks/useLogStream.ts`
- `/home/cezar/dev/omni/resources/omni-whatsapp-core/src/config/logger.config.ts`

---

## Decisions

| ID | Decision | Rationale |
|----|----------|-----------|
| DEC-1 | Use **pino** as unified logger | Already installed, fastest Node.js logger, structured JSON native |
| DEC-2 | **pino-pretty** for dev TTY | Colors, compact format, human-readable |
| DEC-3 | **Structured JSON** in production | Loki/Datadog compatible, LLM parseable |
| DEC-4 | **In-memory ring buffer** for UI | No DB storage needed, 1000 entries max |
| DEC-5 | **SSE streaming** to UI | Proven pattern from v1, simpler than WebSocket |
| DEC-6 | **Module tagging** via child loggers | `logger.child({ module: 'whatsapp:auth' })` |
| DEC-7 | **No emojis** in logs | ASCII colors only as requested |
| DEC-8 | **Async logging** | Don't block event loop, OK with log loss on crash |
| DEC-9 | **Pipe external loggers** | Baileys pino routed through our formatter |
| DEC-10 | **Optional file rotation** | Via pino-roll, configurable, not default |

---

## Assumptions

| ID | Assumption | Risk if Wrong |
|----|------------|---------------|
| ASM-1 | pino-pretty works well with Bun | May need Bun-specific config |
| ASM-2 | In-memory buffer sufficient for UI | Users may want persistent log history |
| ASM-3 | SSE works through any reverse proxy | May need nginx config hints |
| ASM-4 | Log volume < 10k/sec typical | May need sampling at higher volumes |

---

## Risks

| ID | Risk | Mitigation |
|----|------|------------|
| RISK-1 | Breaking existing logger interface | Keep same interface, swap implementation |
| RISK-2 | Baileys pino conflicts | Create adapter that captures and reformats |
| RISK-3 | Performance regression | Benchmark before/after, async by default |
| RISK-4 | Too many console.log to replace | Codemod script + ESLint rule |

---

## Scope

### IN SCOPE

1. **Core Logger Package** (`packages/core/src/logger/`)
   - Pino-based logger factory
   - Pretty formatter for TTY
   - JSON formatter for production
   - Child logger with module context
   - Log level configuration via env

2. **Log Buffer & Streaming**
   - In-memory ring buffer (1000 entries)
   - SSE endpoint `/api/v2/logs/stream`
   - Recent logs endpoint `/api/v2/logs/recent`
   - Filter by module, level

3. **Console.log Migration**
   - Replace all 25+ files
   - ESLint rule to prevent new console.log
   - Codemod script for bulk replacement

4. **External Logger Integration**
   - Baileys pino adapter
   - Future: Discord.js, Telegram adapters

5. **Configuration**
   - `LOG_LEVEL` env var (debug/info/warn/error)
   - `LOG_FORMAT` env var (pretty/json)
   - `LOG_FILE` env var (optional file path)
   - `LOG_FILE_MAX_SIZE` (rotation threshold)

### OUT OF SCOPE

- Database log storage
- Log aggregation service integration (Loki/Datadog) - just ensure JSON compatibility
- UI component (separate wish)
- Log search/query language
- Log retention policies beyond rotation

---

## Execution Groups

### Group A: Core Logger Infrastructure

**Goal:** Create the unified logging package that all other packages will use.

**Deliverables:**
- [ ] `packages/core/src/logger/index.ts` - Main logger factory
- [ ] `packages/core/src/logger/formatters.ts` - Pretty and JSON formatters
- [ ] `packages/core/src/logger/buffer.ts` - Ring buffer for UI streaming
- [ ] `packages/core/src/logger/types.ts` - TypeScript interfaces
- [ ] `packages/core/src/logger/adapters/baileys.ts` - Baileys pino adapter
- [ ] Update `packages/core/package.json` with pino dependencies
- [ ] Export logger from `packages/core/src/index.ts`

**Acceptance Criteria:**
- [ ] Logger creates child loggers with module context
- [ ] Pretty output has colors, compact timestamps (`HH:mm:ss`)
- [ ] JSON output is valid, parseable, includes all context
- [ ] Ring buffer stores last 1000 entries
- [ ] Baileys logs routed through unified logger
- [ ] `LOG_LEVEL` respected (debug logs hidden unless enabled)

**Validation:**
```bash
bun test packages/core --grep logger
LOG_LEVEL=debug bun run packages/core/src/logger/example.ts
```

---

### Group B: API Integration & Streaming

**Goal:** Wire up SSE streaming and replace console.log in API package.

**Deliverables:**
- [ ] `packages/api/src/routes/v2/logs.ts` - SSE stream + recent logs endpoints
- [ ] Update `packages/api/src/plugins/logger.ts` to use core logger
- [ ] Replace all console.log in `packages/api/src/**/*.ts` (~15 files)
- [ ] Add log buffer to app context
- [ ] Heartbeat mechanism for SSE keep-alive

**Acceptance Criteria:**
- [ ] `GET /api/v2/logs/stream?modules=whatsapp,api&level=info` works
- [ ] `GET /api/v2/logs/recent?limit=100` returns JSON array
- [ ] No raw console.log remains in API package
- [ ] SSE survives 60s+ without timeout
- [ ] Filter by module works correctly

**Validation:**
```bash
curl -N "http://localhost:8881/api/v2/logs/stream" # Should stream
curl "http://localhost:8881/api/v2/logs/recent?limit=10" | jq
bun test packages/api
```

---

### Group C: Channel Plugin Migration & ESLint

**Goal:** Migrate channel-whatsapp and enforce no console.log via ESLint.

**Deliverables:**
- [ ] Replace all console.log in `packages/channel-whatsapp/src/**/*.ts` (~10 files)
- [ ] Update `packages/channel-sdk` logger interface if needed
- [ ] ESLint rule: `no-console` with autofix suggestion
- [ ] `.eslintrc` update to enforce rule
- [ ] Migration script for bulk console.log → logger replacement

**Acceptance Criteria:**
- [ ] No console.log in channel-whatsapp
- [ ] ESLint fails on new console.log usage
- [ ] Baileys internal logs formatted consistently
- [ ] All existing tests pass
- [ ] Log output is scannable and informative

**Validation:**
```bash
bun run lint # Should pass with no console.log violations
bun test packages/channel-whatsapp
grep -r "console.log" packages/channel-whatsapp/src/ # Should return nothing
```

---

## Log Format Specification

### Pretty Format (TTY/Dev)

```
HH:mm:ss LEVEL module           message key=value key2=value2
```

**Examples:**
```
04:24:09 INFO  api:startup       Server listening host=0.0.0.0 port=8881
04:24:09 DEBUG plugin-loader     Discovered packages count=1
04:24:10 WARN  whatsapp:socket   Connection retry attempt=2 delay=5000
04:24:10 ERROR whatsapp:auth     Auth failed instanceId=abc123 reason="timeout"
```

**Colors:**
- `DEBUG` = cyan
- `INFO` = green
- `WARN` = yellow
- `ERROR` = red
- Module = dim/gray
- Key-value = default

**Timestamp:** `HH:mm:ss` only (we know the date, save space)

### JSON Format (Production/LLM)

```json
{"level":"info","time":1706678400000,"module":"api:startup","msg":"Server listening","host":"0.0.0.0","port":8881}
```

**Required fields:**
- `level` - debug/info/warn/error
- `time` - Unix timestamp ms
- `module` - Hierarchical module path
- `msg` - Human-readable message

**Optional fields:**
- Any additional context key-values

---

## Module Naming Convention

Hierarchical, colon-separated:

| Module | Description |
|--------|-------------|
| `api:startup` | API server initialization |
| `api:http` | HTTP request handling |
| `api:ws` | WebSocket connections |
| `nats` | NATS event bus |
| `db` | Database operations |
| `plugin-loader` | Plugin discovery/loading |
| `instance-monitor` | Health checks, reconnection |
| `whatsapp:plugin` | WhatsApp plugin lifecycle |
| `whatsapp:socket` | Baileys socket operations |
| `whatsapp:auth` | Auth state management |
| `whatsapp:messages` | Message handling |
| `whatsapp:events` | Event processing |
| `discord:plugin` | Discord plugin (future) |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LOG_LEVEL` | `info` | Minimum level (debug/info/warn/error) |
| `LOG_FORMAT` | `auto` | Output format (auto/pretty/json). Auto = pretty if TTY, else JSON |
| `LOG_FILE` | - | Optional file path for persistent logs |
| `LOG_FILE_MAX_SIZE` | `10m` | Rotation threshold (e.g., 10m, 100k) |
| `LOG_MODULES` | `*` | Filter modules (e.g., `whatsapp:*,api:*`) |

### Programmatic

```typescript
import { createLogger, configureLogging } from '@omni/core';

// Global config (call once at startup)
configureLogging({
  level: 'debug',
  format: 'pretty',
  file: '/var/log/omni.log',
});

// Create module logger
const logger = createLogger('whatsapp:auth');
logger.info('Credentials restored', { instanceId, registered: true });

// Child logger for sub-context
const socketLogger = logger.child({ socketId: 'abc123' });
socketLogger.debug('Sending message', { to: '5511999990001' });
```

---

## API Endpoints

### GET /api/v2/logs/stream

SSE endpoint for real-time log streaming.

**Query Parameters:**
- `modules` - Comma-separated module filters (supports wildcards: `whatsapp:*`)
- `level` - Minimum level (debug/info/warn/error)

**Response:** `text/event-stream`

```
event: connected
data: {"modules":["whatsapp:*","api:*"],"level":"info"}

event: log
data: {"level":"info","time":1706678400000,"module":"api:startup","msg":"Server listening"}

: heartbeat 1706678430000

event: log
data: {"level":"warn","time":1706678435000,"module":"whatsapp:socket","msg":"Reconnecting"}
```

### GET /api/v2/logs/recent

Get recent logs from buffer.

**Query Parameters:**
- `modules` - Comma-separated module filters
- `level` - Minimum level
- `limit` - Max entries (1-1000, default 100)

**Response:**
```json
{
  "items": [
    {"level":"info","time":1706678400000,"module":"api:startup","msg":"Server listening"}
  ],
  "meta": {
    "total": 1,
    "bufferSize": 1000
  }
}
```

---

## Migration Checklist

Files requiring console.log replacement:

### packages/api/src/ (~15 files)
- [ ] `index.ts` (20+ calls)
- [ ] `middleware/error.ts`
- [ ] `plugins/context.ts`
- [ ] `plugins/event-listeners.ts`
- [ ] `plugins/instance-monitor.ts`
- [ ] `plugins/qr-store.ts`
- [ ] `plugins/storage.ts`
- [ ] `routes/v2/instances.ts`
- [ ] `ws/chats.ts`
- [ ] `ws/events.ts`
- [ ] `ws/instances.ts`
- [ ] `ws/logs.ts`

### packages/channel-whatsapp/src/ (~10 files)
- [ ] `auth.ts` (11+ calls)
- [ ] `handlers/connection.ts` (30+ calls)
- [ ] `handlers/messages.ts`
- [ ] `handlers/all-events.ts` (20+ calls)

### packages/core/src/ (~5 files)
- [ ] `events/nats/*.ts`

### packages/db/src/
- [ ] `migrate.ts`

### packages/channel-sdk/src/
- [ ] `discovery/loader.ts`

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Console.log calls remaining | 0 |
| Log format consistency | 100% (all through unified logger) |
| Pretty output readability | Human can scan 100 lines in <10s |
| JSON parseability | 100% valid JSON |
| Performance overhead | <1ms per log call |
| ESLint violations | 0 (enforced) |

---

## References

- [pino documentation](https://getpino.io/)
- [pino-pretty](https://github.com/pinojs/pino-pretty)
- [pino-roll](https://github.com/flarelabs-net/pino-roll)
- Omni v1: `/home/cezar/dev/omni/gateway/src/logs.ts`
- Omni v1: `/home/cezar/dev/omni/resources/ui/src/hooks/useLogStream.ts`

---

## Notes

- UI LogsTab component is OUT OF SCOPE (separate wish for dashboard)
- PM2 integration deferred (not using PM2 in v2 yet)
- Future: Add sampling for high-volume scenarios
- Future: Correlation IDs across distributed requests
