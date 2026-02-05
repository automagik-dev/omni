# Load Testing

Performance load tests for the Omni API using [k6](https://k6.io/).

## Prerequisites

Install k6:

```bash
# macOS
brew install k6

# Linux (Debian/Ubuntu)
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg \
    --keyserver hkp://keyserver.ubuntu.com:80 \
    --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | \
    sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# Docker (no install needed)
docker run -i grafana/k6 run - <script.js
```

## Quick Start

```bash
# Ensure API is running
pm2 status omni-v2-api

# Quick smoke test (5 VUs, 10 seconds)
./scripts/load-test/run.sh --quick

# Run all standard scenarios
./scripts/load-test/run.sh

# Run specific scenario
./scripts/load-test/run.sh --scenario health
./scripts/load-test/run.sh --scenario messages
./scripts/load-test/run.sh --scenario chats
./scripts/load-test/run.sh --scenario mixed
./scripts/load-test/run.sh --scenario soak  # 30+ minutes!
```

## Scenarios

| Scenario | Target | Duration | Description |
|----------|--------|----------|-------------|
| `health` | 1000 req/s, p99 <100ms | ~2 min | Health endpoint stress test |
| `chats` | 50 VUs, p95 <200ms | ~2 min | Chat listing load test |
| `messages` | 100 VUs, p95 <500ms | ~2 min | Message listing load test |
| `mixed` | 200 VUs, no errors | ~4 min | Realistic mixed workload |
| `soak` | 50 VUs, stable memory | 30 min | Memory leak detection |

## Environment Variables

```bash
# API URL (default: http://localhost:8882)
export API_URL=http://localhost:8882

# API Key for authenticated endpoints
export API_KEY=your_api_key_here

# Run with custom config
./scripts/load-test/run.sh --scenario mixed
```

## Running Individual Tests

```bash
# Direct k6 command
k6 run scripts/load-test/k6/scenarios/health.js

# With environment variables
k6 run --env API_URL=http://localhost:8882 \
       --env API_KEY=your_key \
       scripts/load-test/k6/scenarios/mixed.js

# Override VUs and duration
k6 run --vus 50 --duration 1m scripts/load-test/k6/scenarios/health.js
```

## Performance Thresholds

| Metric | Acceptable | Warning | Critical |
|--------|------------|---------|----------|
| p50 latency | <50ms | <100ms | >200ms |
| p95 latency | <200ms | <500ms | >1000ms |
| p99 latency | <500ms | <1000ms | >2000ms |
| Error rate | <0.1% | <1% | >5% |
| Memory growth | <10MB/hour | <50MB/hour | >100MB/hour |

## Output

Results are printed to stdout. For JSON output:

```bash
k6 run --out json=results.json scripts/load-test/k6/scenarios/health.js
```

For InfluxDB/Grafana visualization:

```bash
k6 run --out influxdb=http://localhost:8086/k6 scripts/load-test/k6/scenarios/health.js
```

## Troubleshooting

### API not reachable
```bash
pm2 restart omni-v2-api
pm2 logs omni-v2-api --lines 20
```

### Auth failures
```bash
# Check your API key
curl -H "x-api-key: $API_KEY" http://localhost:8882/api/v2/instances
```

### High error rate
1. Check API logs: `pm2 logs omni-v2-api`
2. Check database connections: `make db-studio`
3. Reduce VU count and retry

### Memory growth during soak test
```bash
# Monitor memory during test
watch -n 5 'pm2 describe omni-v2-api | grep memory'
```
