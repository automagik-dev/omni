/**
 * Chats Endpoint Load Test
 *
 * Tests chat listing under load.
 * Target: p95 < 200ms at 50 concurrent users
 *
 * Run:
 *   k6 run scripts/load-test/k6/scenarios/chats.js
 *   k6 run --env API_URL=http://localhost:8882 --env API_KEY=your_key scripts/load-test/k6/scenarios/chats.js
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const chatsLatency = new Trend('chats_latency', true);
const chatsErrors = new Counter('chats_errors');
const chatsSuccessRate = new Rate('chats_success_rate');

export const options = {
  stages: [
    { duration: '10s', target: 10 }, // Ramp up
    { duration: '30s', target: 25 }, // Ramp to 25 VUs
    { duration: '1m', target: 50 }, // Hold at 50 VUs
    { duration: '10s', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<200', 'p(99)<500'],
    http_req_failed: ['rate<0.01'],
    chats_success_rate: ['rate>0.99'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:8882';
const API_KEY = __ENV.API_KEY || 'omni_sk_testkey12345678901234567890abc';

export default function () {
  // List chats with pagination
  const res = http.get(`${API_URL}/api/v2/chats?limit=50`, {
    headers: {
      'x-api-key': API_KEY,
      'Accept-Encoding': 'gzip',
    },
  });

  const success = check(res, {
    'status is 200': (r) => r.status === 200,
    'has data array': (r) => {
      try {
        const body = JSON.parse(r.body);
        return Array.isArray(body.data);
      } catch {
        return false;
      }
    },
    'response time < 200ms': (r) => r.timings.duration < 200,
  });

  chatsLatency.add(res.timings.duration);
  chatsSuccessRate.add(success);

  if (!success) {
    chatsErrors.add(1);
    if (res.status === 401) {
      console.log('Auth failed - check API_KEY');
    }
  }

  sleep(1); // 1s between requests per VU
}

export function handleSummary(data) {
  const metrics = data.metrics;
  return {
    stdout: `
Chats Endpoint Load Test Results
================================
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
Success Rate: ${((metrics.chats_success_rate?.values?.rate || 0) * 100).toFixed(2)}%

Thresholds:
  p95 < 200ms: ${(metrics.http_req_duration?.values?.['p(95)'] || 0) < 200 ? 'PASS' : 'FAIL'}
  p99 < 500ms: ${(metrics.http_req_duration?.values?.['p(99)'] || 0) < 500 ? 'PASS' : 'FAIL'}
  Error rate < 1%: ${(metrics.http_req_failed?.values?.rate || 0) < 0.01 ? 'PASS' : 'FAIL'}
`,
  };
}
