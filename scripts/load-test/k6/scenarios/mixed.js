/**
 * Mixed Workload Load Test
 *
 * Simulates realistic traffic pattern with multiple endpoints.
 * Target: 200 concurrent users with no errors
 *
 * Run:
 *   k6 run scripts/load-test/k6/scenarios/mixed.js
 *   k6 run --env API_URL=http://localhost:8882 --env API_KEY=your_key scripts/load-test/k6/scenarios/mixed.js
 */

import { check, sleep } from 'k6';
import http from 'k6/http';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const endpointLatency = new Trend('endpoint_latency', true);
const totalErrors = new Counter('total_errors');
const overallSuccessRate = new Rate('overall_success_rate');

export const options = {
  stages: [
    { duration: '30s', target: 50 }, // Ramp up
    { duration: '1m', target: 100 }, // Hold at 100
    { duration: '1m', target: 200 }, // Peak at 200
    { duration: '1m', target: 100 }, // Step down
    { duration: '30s', target: 0 }, // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    overall_success_rate: ['rate>0.99'],
  },
};

const API_URL = __ENV.API_URL || 'http://localhost:8882';
const API_KEY = __ENV.API_KEY || 'omni_sk_testkey12345678901234567890abc';

// Weighted endpoint selection (simulates realistic traffic)
const endpoints = [
  { path: '/api/v2/health', weight: 20, needsAuth: false },
  { path: '/api/v2/info', weight: 10, needsAuth: false },
  { path: '/api/v2/instances', weight: 15, needsAuth: true },
  { path: '/api/v2/chats?limit=20', weight: 25, needsAuth: true },
  { path: '/api/v2/messages?limit=20', weight: 20, needsAuth: true },
  { path: '/api/v2/events?limit=20', weight: 10, needsAuth: true },
];

function selectEndpoint() {
  const totalWeight = endpoints.reduce((sum, e) => sum + e.weight, 0);
  let random = Math.random() * totalWeight;

  for (const endpoint of endpoints) {
    random -= endpoint.weight;
    if (random <= 0) {
      return endpoint;
    }
  }
  return endpoints[0];
}

export default function () {
  const endpoint = selectEndpoint();

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

  endpointLatency.add(res.timings.duration);
  overallSuccessRate.add(success);

  if (!success) {
    totalErrors.add(1);
    console.log(`Error on ${endpoint.path}: ${res.status}`);
  }

  // Variable sleep based on endpoint type
  if (endpoint.path.includes('health')) {
    sleep(0.1); // Frequent health checks
  } else {
    sleep(0.5 + Math.random() * 0.5); // 0.5-1s for other endpoints
  }
}

export function handleSummary(data) {
  const metrics = data.metrics;
  return {
    stdout: `
Mixed Workload Load Test Results
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
Success Rate: ${((metrics.overall_success_rate?.values?.rate || 0) * 100).toFixed(2)}%

Thresholds:
  p95 < 500ms: ${(metrics.http_req_duration?.values?.['p(95)'] || 0) < 500 ? 'PASS' : 'FAIL'}
  Error rate < 1%: ${(metrics.http_req_failed?.values?.rate || 0) < 0.01 ? 'PASS' : 'FAIL'}
  Success rate > 99%: ${(metrics.overall_success_rate?.values?.rate || 0) > 0.99 ? 'PASS' : 'FAIL'}
`,
  };
}
