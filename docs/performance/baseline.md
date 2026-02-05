# Performance Baseline

> Measured: 2026-02-05

## Environment

| Property | Value |
|----------|-------|
| Platform | Linux x64 |
| CPUs | 16 |
| Total Memory | 32 GB |
| API Version | 2.0.0 |

## Idle Metrics

| Metric | Value | Status |
|--------|-------|--------|
| Memory Usage | ~225 MB | OK |
| CPU Usage | <1% | OK |

## Endpoint Latency (100 requests each, concurrency 10)

| Endpoint | Avg (ms) | P95 (ms) | P99 (ms) | RPS | Status |
|----------|----------|----------|----------|-----|--------|
| Health Check | 7.0 | 20.6 | 29.1 | 1087 | OK |
| Info | 3.8 | 6.8 | 7.8 | 2128 | OK |
| List Instances | 16.1 | 22.7 | 27.2 | 503 | OK |
| List Chats | 17.2 | 25.3 | 32.5 | 415 | OK |
| List Events | 28.5 | 43.5 | 48.1 | 249 | OK |
| List Messages | 116.9 | 168.4 | 173.3 | 79 | WARN |

## Profiler Results (10s, concurrency 20)

| Endpoint | Requests | RPS | Avg (ms) | P95 (ms) | P99 (ms) | Memory Delta |
|----------|----------|-----|----------|----------|----------|--------------|
| Health Check | 24,312 | 2,431 | 7.1 | 11.7 | 14.4 | +13 MB |
| Instances | 5,556 | 556 | 35.4 | 40.7 | 44.8 | +8 MB |
| Chats | 5,361 | 536 | 36.7 | 43.5 | 50.3 | +6 MB |
| Events | 5,100 | 510 | 36.7 | 41.4 | 69.3 | +5 MB |

## Identified Bottlenecks

### Priority 1 (High Impact)

1. **API Key Validation - No Caching**
   - Every request hits database for API key lookup
   - Impact: ~10-20ms added latency per authenticated request
   - Recommendation: Cache validated API keys with 60s TTL

2. **Messages Endpoint - High Latency**
   - Average 116.9ms, P99 173.3ms
   - Likely causes: Complex joins, payload decompression
   - Recommendation: Investigate query performance, add indexes

### Priority 2 (Medium Impact)

3. **No HTTP Response Compression**
   - Large JSON responses sent uncompressed
   - Impact: Higher bandwidth usage, slower transfers
   - Recommendation: Enable gzip/brotli compression

4. **No Request Timeout Middleware**
   - Slow requests could hang indefinitely
   - Impact: Resource exhaustion under load
   - Recommendation: Add 30s request timeout

5. **No Body Size Limits**
   - Large payloads could exhaust memory
   - Impact: DoS vulnerability
   - Recommendation: Add 10MB body limit

### Priority 3 (Lower Impact)

6. **Rate Limiting is In-Memory Only**
   - Won't work correctly in multi-instance deployment
   - Recommendation: Document limitation, future Redis migration

## Thresholds

| Metric | Acceptable | Warning | Critical |
|--------|------------|---------|----------|
| p50 latency | <50ms | <100ms | >200ms |
| p95 latency | <200ms | <500ms | >1000ms |
| p99 latency | <500ms | <1000ms | >2000ms |
| Error rate | <0.1% | <1% | >5% |
| Memory growth | <10MB/hour | <50MB/hour | >100MB/hour |

## Summary

Overall API performance is **acceptable** for current load levels:

- Health and Info endpoints are fast (<10ms)
- Authenticated endpoints average 15-35ms (OK)
- Messages endpoint is slow (needs investigation)
- No request failures during testing

**Key optimizations to implement:**
1. API key caching (high impact)
2. HTTP compression (medium impact)
3. Request timeout middleware (safety)
4. Body size limits (safety)

## Scripts

```bash
# Run baseline measurement
bun scripts/perf/baseline.ts

# With warmup
bun scripts/perf/baseline.ts --warmup

# JSON output
bun scripts/perf/baseline.ts --output=json

# Run profiler
bun scripts/perf/profile.ts --duration=10 --concurrency=20

# Profile specific endpoint
bun scripts/perf/profile.ts --endpoint=/api/v2/messages
```
