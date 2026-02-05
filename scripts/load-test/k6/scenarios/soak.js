/**
 * Soak Test (Sustained Load)
 *
 * Tests memory stability over 30 minutes of sustained load.
 * Target: No memory leaks (memory growth < 10MB/hour)
 *
 * Run:
 *   k6 run scripts/load-test/k6/scenarios/soak.js
 *   k6 run --env API_URL=http://localhost:8882 --env API_KEY=your_key scripts/load-test/k6/scenarios/soak.js
 *
 * NOTE: This is a long-running test (30+ minutes).
 * Monitor API memory usage separately during this test.
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const soakLatency = new Trend('soak_latency', true);
const soakErrors = new Counter('soak_errors');
const soakSuccessRate = new Rate('soak_success_rate');

export const options = {
  stages: [
    { duration: '2m', target: 50 }, // Ramp up to 50% capacity
    { duration: '30m', target: 50 }, // Sustained load for 30 minutes
    { duration: '2m', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.001'], // Very low error rate for soak
    soak_success_rate: ['rate>0.999'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:8882';
const API_KEY = __ENV.API_KEY || 'omni_sk_testkey12345678901234567890abc';

// Endpoints to rotate through
const endpoints = [
  { path: '/api/v2/health', needsAuth: false },
  { path: '/api/v2/info', needsAuth: false },
  { path: '/api/v2/instances', needsAuth: true },
  { path: '/api/v2/chats?limit=20', needsAuth: true },
  { path: '/api/v2/messages?limit=20', needsAuth: true },
  { path: '/api/v2/events?limit=20', needsAuth: true },
];

let requestIndex = 0;

export default function () {
  // Round-robin through endpoints
  const endpoint = endpoints[requestIndex % endpoints.length];
  requestIndex++;

  const headers = {
    'Accept-Encoding': 'gzip',
  };

  if (endpoint.needsAuth) {
    headers['x-api-key'] = API_KEY;
  }

  const res = http.get(`${API_URL}${endpoint.path}`, { headers });

  const success = check(res, {
    'status is 2xx': (r) => r.status >= 200 && r.status < 300,
    'response time < 1000ms': (r) => r.timings.duration < 1000,
  });

  soakLatency.add(res.timings.duration);
  soakSuccessRate.add(success);

  if (!success) {
    soakErrors.add(1);
    console.log(`[${new Date().toISOString()}] Error on ${endpoint.path}: ${res.status}`);
  }

  sleep(1); // 1 request per second per VU
}

export function handleSummary(data) {
  const metrics = data.metrics;
  const duration = data.state?.testRunDurationMs || 0;
  const durationMinutes = Math.round(duration / 60000);

  return {
    stdout: `
Soak Test Results (${durationMinutes} minutes)
================================
Total Requests: ${metrics.http_reqs?.values?.count || 0}
Request Rate: ${(metrics.http_reqs?.values?.rate || 0).toFixed(2)} req/s
Total Duration: ${durationMinutes} minutes

Latency (ms):
  avg: ${metrics.http_req_duration?.values?.avg?.toFixed(2) || 0}
  p50: ${metrics.http_req_duration?.values?.['p(50)']?.toFixed(2) || 0}
  p90: ${metrics.http_req_duration?.values?.['p(90)']?.toFixed(2) || 0}
  p95: ${metrics.http_req_duration?.values?.['p(95)']?.toFixed(2) || 0}
  p99: ${metrics.http_req_duration?.values?.['p(99)']?.toFixed(2) || 0}
  max: ${metrics.http_req_duration?.values?.max?.toFixed(2) || 0}

Error Rate: ${((metrics.http_req_failed?.values?.rate || 0) * 100).toFixed(4)}%
Total Errors: ${metrics.soak_errors?.values?.count || 0}
Success Rate: ${((metrics.soak_success_rate?.values?.rate || 0) * 100).toFixed(4)}%

Memory Leak Check:
  Monitor API memory separately during test.
  Target: Memory growth < 10MB/hour

  Check with: pm2 describe omni-v2-api | grep memory

Thresholds:
  p95 < 500ms: ${(metrics.http_req_duration?.values?.['p(95)'] || 0) < 500 ? 'PASS' : 'FAIL'}
  Error rate < 0.1%: ${(metrics.http_req_failed?.values?.rate || 0) < 0.001 ? 'PASS' : 'FAIL'}
  Success rate > 99.9%: ${(metrics.soak_success_rate?.values?.rate || 0) > 0.999 ? 'PASS' : 'FAIL'}
`,
  };
}
