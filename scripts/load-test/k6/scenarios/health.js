/**
 * Health Endpoint Stress Test
 *
 * Tests the health endpoint under high load.
 * Target: 1000 req/s with p99 < 50ms
 *
 * Run:
 *   k6 run scripts/load-test/k6/scenarios/health.js
 *   k6 run --env API_URL=http://localhost:8882 scripts/load-test/k6/scenarios/health.js
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const healthLatency = new Trend('health_latency', true);
const healthErrors = new Counter('health_errors');
const healthSuccessRate = new Rate('health_success_rate');

export const options = {
  stages: [
    { duration: '10s', target: 100 }, // Ramp up to 100 VUs
    { duration: '30s', target: 500 }, // Ramp up to 500 VUs
    { duration: '1m', target: 1000 }, // Hold at 1000 VUs
    { duration: '10s', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<50', 'p(99)<100'],
    http_req_failed: ['rate<0.01'],
    health_success_rate: ['rate>0.99'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:8882';

export default function () {
  const res = http.get(`${API_URL}/api/v2/health`, {
    headers: {
      'Accept-Encoding': 'gzip',
    },
  });

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'status is healthy': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'healthy';
      } catch {
        return false;
      }
    },
    'response time < 50ms': (r) => r.timings.duration < 50,
  });

  healthLatency.add(res.timings.duration);
  healthSuccessRate.add(success);

  if (!success) {
    healthErrors.add(1);
  }

  sleep(0.1); // 100ms between requests per VU
}

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

function textSummary(data) {
  const metrics = data.metrics;
  return `
Health Endpoint Load Test Results
=================================
Total Requests: ${metrics.http_reqs?.values?.count || 0}
Request Rate: ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)} req/s

Latency (ms):
  avg: ${metrics.http_req_duration?.values?.avg?.toFixed(2) || 0}
  p50: ${metrics.http_req_duration?.values?.['p(50)']?.toFixed(2) || 0}
  p90: ${metrics.http_req_duration?.values?.['p(90)']?.toFixed(2) || 0}
  p95: ${metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) || 0}
  p99: ${metrics.http_req_duration?.values?.['p(99)']?.toFixed(2) || 0}
  max: ${metrics.http_req_duration?.values?.max?.toFixed(2) || 0}

Error Rate: ${((metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(2)}%
Success Rate: ${((metrics.health_success_rate?.values?.rate || 0) * 100).toFixed(2)}%

Thresholds:
  p95 < 50ms: ${(metrics.http_req_duration?.values?.['p(95)'] || 0) < 50 ? 'PASS' : 'FAIL'}
  p99 < 100ms: ${(metrics.http_req_duration?.values?.['p(99)'] || 0) < 100 ? 'PASS' : 'FAIL'}
  Error rate < 1%: ${(metrics.http_req_failed?.values?.rate || 0) < 0.01 ? 'PASS' : 'FAIL'}
`;
}
