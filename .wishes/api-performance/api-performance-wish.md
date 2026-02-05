# WISH: API Performance Evaluation & Optimization

> Benchmark, profile, and optimize the API for production-ready concurrent load.

**Status:** REVIEW
**Created:** 2026-02-05
**Author:** WISH Agent
**Beads:** omni-e5p

---

## Context

The API is functionally complete but hasn't been stress-tested. Before scaling to production, we need to:

1. **Establish baselines** - CPU, memory, latency at idle and under load
2. **Identify bottlenecks** - Through profiling and load testing
3. **Optimize critical paths** - Fix gaps discovered through testing
4. **Validate** - Pass load tests representing production traffic

### Current Performance Posture

**Already optimized:**
- Connection pooling (postgres-js, 10 max)
- Payload compression for storage
- Media streaming + 1-year cache headers
- Health endpoints + Prometheus metrics
- Graceful shutdown

**Known gaps (from code analysis):**
| Gap | Impact | Priority |
|-----|--------|----------|
| No HTTP response compression (gzip/brotli) | High | P1 |
| No API key caching (DB hit every request) | High | P1 |
| No request timeouts | Medium | P2 |
| No response caching/ETags | Medium | P2 |
| In-memory rate limiting only | Medium | P2 |
| Low connection pool (10 max) | Medium | P2 |
| No body size limits | Low | P3 |

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | Current load is low; production will have 10-100x more traffic |
| **ASM-2** | Assumption | PostgreSQL and NATS are not the bottleneck (can scale independently) |
| **ASM-3** | Assumption | Bun runtime performance is acceptable |
| **DEC-1** | Decision | Benchmark first, then optimize based on data |
| **DEC-2** | Decision | In-memory cache with TTL (no Redis yet) |
| **DEC-3** | Decision | Pluggable cache interface for future Redis migration |
| **DEC-4** | Decision | Use k6 for load testing (industry standard, scriptable) |
| **DEC-5** | Decision | Success = passes load test without degradation |
| **RISK-1** | Risk | Profiling may reveal deep architectural issues → mitigate with time-boxed investigation |
| **RISK-2** | Risk | Load testing may crash dev environment → use isolated test instance |

---

## Scope

### IN SCOPE

- **Profiling infrastructure**
  - Memory/CPU baseline measurements
  - Heap snapshots under load
  - Request latency percentiles (p50, p95, p99)

- **Load testing infrastructure**
  - k6 test scripts for key scenarios
  - CI-compatible test runner
  - Results reporting

- **Caching layer**
  - Pluggable cache interface (`CacheProvider`)
  - In-memory implementation with TTL
  - API key caching
  - Health/status response caching

- **Quick-win optimizations** (based on known gaps)
  - HTTP response compression
  - Request timeout middleware
  - Body size limits

- **Tuning**
  - Connection pool sizing
  - Rate limit adjustments

### OUT OF SCOPE

- Redis integration (future wish - interface ready)
- APM integration (Sentry Performance, OpenTelemetry)
- Database query optimization (separate concern)
- Horizontal scaling / load balancing
- CDN integration
- WebSocket performance (separate concern)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| api | middleware, services, config | Core changes |
| core | types | Cache interface types |
| db | - | No changes |
| sdk | - | No API surface changes |
| cli | - | No changes |

### System Checklist

- [ ] **Events**: No changes
- [ ] **Database**: No schema changes
- [ ] **SDK**: No regeneration needed
- [ ] **CLI**: No changes
- [ ] **Tests**: Add load test scripts, cache tests

---

## Success Criteria

### Load Test Scenarios

| Scenario | Target | Metric |
|----------|--------|--------|
| **Idle baseline** | <100MB memory, <5% CPU | Resource usage |
| **Health check spam** | 1000 req/s, p99 <50ms | Latency |
| **Message send burst** | 100 concurrent, p95 <500ms | Latency |
| **Chat list + messages** | 50 concurrent, p95 <200ms | Latency |
| **Mixed workload** | 200 concurrent users, no errors | Error rate |
| **Sustained load** | 30 min at 50% capacity, stable memory | Memory leak check |

### Performance Thresholds

| Metric | Acceptable | Warning | Critical |
|--------|------------|---------|----------|
| p50 latency | <50ms | <100ms | >200ms |
| p95 latency | <200ms | <500ms | >1000ms |
| p99 latency | <500ms | <1000ms | >2000ms |
| Error rate | <0.1% | <1% | >5% |
| Memory growth | <10MB/hour | <50MB/hour | >100MB/hour |

---

## Execution Group A: Profiling & Baseline

**Goal:** Establish performance baselines and identify bottlenecks.

**Packages:** api

**Deliverables:**
- [ ] `scripts/perf/profile.ts` - Profiling script (heap, CPU)
- [ ] `scripts/perf/baseline.ts` - Baseline measurement script
- [ ] `docs/performance-baseline.md` - Documented baselines
- [ ] Identify top 3 bottlenecks from profiling

**Tasks:**
1. Measure idle resource usage (memory, CPU, open handles)
2. Profile hot paths under simulated load:
   - `/api/v2/messages` (send)
   - `/api/v2/chats` (list)
   - `/api/v2/events` (list with filters)
   - `/api/v2/health`
3. Generate heap snapshots, identify memory hotspots
4. Document findings

**Acceptance Criteria:**
- [ ] Baseline numbers documented
- [ ] Heap snapshot analysis complete
- [ ] Top bottlenecks identified and prioritized

**Validation:**
```bash
bun scripts/perf/baseline.ts
# Review docs/performance-baseline.md
```

---

## Execution Group B: Caching Layer & Quick Wins

**Goal:** Implement pluggable caching and fix known performance gaps.

**Packages:** api, core

**Deliverables:**

### B1: Pluggable Cache Interface
- [ ] `packages/core/src/cache/types.ts` - Cache provider interface
```typescript
interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}
```
- [ ] `packages/api/src/cache/memory-cache.ts` - In-memory implementation with TTL
- [ ] `packages/api/src/cache/index.ts` - Factory for cache provider

### B2: API Key Caching
- [ ] Cache validated API keys (TTL: 60s)
- [ ] Invalidation on key update/delete
- [ ] Bypass cache for scope/access checks (always fresh)

### B3: Response Caching
- [ ] Health endpoint caching (TTL: 5s)
- [ ] Info endpoint caching (TTL: 30s)
- [ ] Settings caching (TTL: 60s)

### B4: HTTP Compression
- [ ] `packages/api/src/middleware/compression.ts` - gzip/brotli middleware
- [ ] Configurable min size threshold (default: 1KB)
- [ ] Content-type filtering (JSON, text only)

### B5: Request Safety
- [ ] `packages/api/src/middleware/timeout.ts` - Request timeout (default: 30s)
- [ ] `packages/api/src/middleware/body-limit.ts` - Body size limit (default: 10MB)

**Acceptance Criteria:**
- [ ] Cache interface is pluggable (easy to swap for Redis)
- [ ] API key lookup hits cache >90% of time
- [ ] Health endpoint responds in <10ms (cached)
- [ ] Responses are gzip compressed (verify with curl)
- [ ] Requests timeout after 30s
- [ ] Large bodies (>10MB) are rejected

**Validation:**
```bash
# Cache tests
bun test packages/api/src/cache

# Compression check
curl -H "Accept-Encoding: gzip" http://localhost:8881/api/v2/health -v 2>&1 | grep "Content-Encoding"

# Timeout check (should timeout)
# Requires a slow endpoint for testing

# Body limit check
dd if=/dev/zero bs=11M count=1 | curl -X POST -d @- http://localhost:8881/api/v2/test
# Should return 413 Payload Too Large
```

---

## Execution Group C: Load Testing & Validation

**Goal:** Validate API passes load tests representing production traffic.

**Packages:** api (scripts only)

**Deliverables:**
- [ ] `scripts/load-test/k6/scenarios/` - k6 test scenarios
  - `health.js` - Health endpoint stress test
  - `messages.js` - Message send/receive load test
  - `chats.js` - Chat operations load test
  - `mixed.js` - Mixed workload simulation
  - `soak.js` - Sustained load test (30 min)
- [ ] `scripts/load-test/run.sh` - Test runner script
- [ ] `scripts/load-test/README.md` - Usage documentation
- [ ] `docs/load-test-results.md` - Results from test runs

**k6 Test Structure:**
```javascript
// Example: messages.js
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },   // Ramp up
    { duration: '1m', target: 100 },   // Hold
    { duration: '30s', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const res = http.post(`${__ENV.API_URL}/api/v2/messages/send`, payload, {
    headers: { 'x-api-key': __ENV.API_KEY },
  });
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
```

**Acceptance Criteria:**
- [ ] All scenarios pass thresholds
- [ ] No memory leaks detected in soak test
- [ ] Error rate <0.1% under load
- [ ] Results documented with graphs

**Validation:**
```bash
# Install k6
brew install k6  # or equivalent

# Run load tests
./scripts/load-test/run.sh --scenario mixed --duration 5m

# Check results
cat docs/load-test-results.md
```

---

## Technical Notes

### Cache Provider Interface

```typescript
// packages/core/src/cache/types.ts
export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
  clear(): Promise<void>;

  // Optional: for debugging/metrics
  stats?(): Promise<{ hits: number; misses: number; size: number }>;
}

export interface CacheConfig {
  defaultTtlMs: number;
  maxSize?: number;  // Max entries (LRU eviction)
  onEvict?: (key: string, value: unknown) => void;
}
```

### In-Memory Cache Implementation

```typescript
// packages/api/src/cache/memory-cache.ts
export class MemoryCache implements CacheProvider {
  private store = new Map<string, { value: unknown; expiresAt: number }>();
  private cleanupInterval: Timer;

  constructor(private config: CacheConfig) {
    // Periodic cleanup of expired entries
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = Date.now() + (ttlMs ?? this.config.defaultTtlMs);
    this.store.set(key, { value, expiresAt });
  }

  // ... rest of implementation
}
```

### Compression Middleware

```typescript
// packages/api/src/middleware/compression.ts
import { compress } from 'hono/compress';

export const compressionMiddleware = compress({
  encoding: 'gzip',  // or 'br' for brotli
});
```

Note: Hono has built-in compression middleware. Verify it works with Bun.

### API Key Cache Strategy

```typescript
// Cache key format: `api-key:${hashedKey}`
// TTL: 60 seconds
// Invalidation: On key update/delete via event

// What to cache:
{
  id: string;
  organizationId: string;
  status: 'active' | 'revoked';
  expiresAt: Date | null;
  scopes: string[];
  instanceIds: string[] | null;  // null = all instances
}

// What NOT to cache (always check fresh):
// - Rate limit counters
// - Usage tracking
```

### k6 Installation

```bash
# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Docker
docker run --rm -i grafana/k6 run - <script.js
```

---

## Dependencies

- None (API already exists)

## Enables

- Production deployment confidence
- Scaling decisions based on data
- Future Redis integration (interface ready)
- Performance regression testing in CI

---

## Future Considerations

After this wish ships:

1. **Redis caching** - Swap MemoryCache for RedisCache using the interface
2. **APM integration** - Sentry Performance or OpenTelemetry for ongoing monitoring
3. **Database optimization** - Query analysis, indexing, N+1 detection
4. **CDN integration** - Static asset offloading
5. **WebSocket performance** - Separate load testing for real-time features
