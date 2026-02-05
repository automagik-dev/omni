#!/usr/bin/env bun
/**
 * Performance Baseline Measurement Script
 *
 * Measures idle and under-load resource usage for the Omni API.
 * Run this with the API already started.
 *
 * Usage:
 *   bun scripts/perf/baseline.ts
 *   bun scripts/perf/baseline.ts --warmup    # Include warmup phase
 *   bun scripts/perf/baseline.ts --output=json  # JSON output
 *
 * Requirements:
 *   - API running on API_URL (default: http://localhost:8881)
 *   - OMNI_API_KEY set in environment
 */

const API_URL = process.env.API_URL || 'http://localhost:8881';
const API_KEY = process.env.OMNI_API_KEY || '';

interface LatencyStats {
  min: number;
  max: number;
  avg: number;
  p50: number;
  p95: number;
  p99: number;
}

interface EndpointResult {
  endpoint: string;
  method: string;
  requests: number;
  successes: number;
  failures: number;
  latency: LatencyStats;
  throughput: number; // requests per second
}

interface BaselineReport {
  timestamp: string;
  apiUrl: string;
  system: {
    platform: string;
    arch: string;
    cpus: number;
    totalMemory: number;
  };
  api: {
    version: string;
    uptime: number;
    status: string;
  };
  idle: {
    memoryMB: number;
    cpuPercent: number;
    openConnections: number;
  };
  endpoints: EndpointResult[];
  summary: {
    totalRequests: number;
    totalSuccesses: number;
    totalFailures: number;
    avgLatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    avgThroughput: number;
  };
}

async function fetchJson<T>(
  url: string,
  options?: RequestInit,
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'identity', // Disable compression for benchmarking
        'x-api-key': API_KEY,
        ...options?.headers,
      },
    });
    const data = await res.json();
    if (!res.ok) {
      return { ok: false, status: res.status, error: data.error?.message || JSON.stringify(data) };
    }
    return { ok: true, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, error: String(e) };
  }
}

function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sortedValues.length) - 1;
  return sortedValues[Math.max(0, index)];
}

function calculateLatencyStats(latencies: number[]): LatencyStats {
  if (latencies.length === 0) {
    return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
    p50: calculatePercentile(sorted, 50),
    p95: calculatePercentile(sorted, 95),
    p99: calculatePercentile(sorted, 99),
  };
}

async function measureEndpoint(
  endpoint: string,
  method: string,
  options: {
    body?: unknown;
    requestCount?: number;
    concurrency?: number;
  } = {},
): Promise<EndpointResult> {
  const requestCount = options.requestCount || 100;
  const concurrency = options.concurrency || 10;
  const latencies: number[] = [];
  let successes = 0;
  let failures = 0;

  const startTime = Date.now();

  // Run requests in batches for concurrency
  for (let i = 0; i < requestCount; i += concurrency) {
    const batch = Math.min(concurrency, requestCount - i);
    const promises = Array.from({ length: batch }, async () => {
      const reqStart = performance.now();
      const res = await fetchJson(
        `${API_URL}${endpoint}`,
        method !== 'GET' ? { method, body: options.body ? JSON.stringify(options.body) : undefined } : undefined,
      );
      const latency = performance.now() - reqStart;
      latencies.push(latency);
      if (res.ok) successes++;
      else failures++;
    });
    await Promise.all(promises);
  }

  const totalTime = (Date.now() - startTime) / 1000; // seconds
  const throughput = requestCount / totalTime;

  return {
    endpoint,
    method,
    requests: requestCount,
    successes,
    failures,
    latency: calculateLatencyStats(latencies),
    throughput,
  };
}

async function getApiHealth(): Promise<{ version: string; uptime: number; status: string }> {
  const res = await fetchJson<{
    status: string;
    version: string;
    uptime: number;
  }>(`${API_URL}/api/v2/health`);

  if (!res.ok || !res.data) {
    throw new Error(`API health check failed: ${res.error}`);
  }

  return {
    version: res.data.version || 'unknown',
    uptime: res.data.uptime || 0,
    status: res.data.status || 'unknown',
  };
}

async function getSystemInfo() {
  const os = await import('node:os');
  return {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMemory: Math.round(os.totalmem() / (1024 * 1024)), // MB
  };
}

async function getIdleMetrics(): Promise<{ memoryMB: number; cpuPercent: number; openConnections: number }> {
  // Try to get metrics from the API's internal endpoint if available
  const metricsRes = await fetchJson<{ memory?: { heapUsed: number }; cpu?: number }>(`${API_URL}/_internal/health`);

  // Default values if metrics not available
  return {
    memoryMB: metricsRes.data?.memory?.heapUsed ? Math.round(metricsRes.data.memory.heapUsed / (1024 * 1024)) : 0,
    cpuPercent: metricsRes.data?.cpu || 0,
    openConnections: 0, // Would need process-level access
  };
}

async function warmup() {
  console.log('Warming up API...');
  // Send some requests to warm up connection pools, JIT, etc.
  for (let i = 0; i < 50; i++) {
    await fetchJson(`${API_URL}/api/v2/health`);
  }
  console.log('Warmup complete.\n');
}

async function main() {
  const args = process.argv.slice(2);
  const doWarmup = args.includes('--warmup');
  const jsonOutput = args.includes('--output=json');

  if (!jsonOutput) {
    console.log('='.repeat(60));
    console.log('Omni API Performance Baseline');
    console.log('='.repeat(60));
    console.log(`API URL: ${API_URL}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log();
  }

  // Verify API is running
  const apiHealth = await getApiHealth().catch((e) => {
    console.error(`Error: Cannot connect to API at ${API_URL}`);
    console.error(e.message);
    process.exit(1);
  });

  if (!jsonOutput) {
    console.log(`API Version: ${apiHealth.version}`);
    console.log(`API Status: ${apiHealth.status}`);
    console.log(`API Uptime: ${Math.round(apiHealth.uptime)}s`);
    console.log();
  }

  if (doWarmup) {
    await warmup();
  }

  const system = await getSystemInfo();
  const idle = await getIdleMetrics();

  if (!jsonOutput) {
    console.log('System Info:');
    console.log(`  Platform: ${system.platform} ${system.arch}`);
    console.log(`  CPUs: ${system.cpus}`);
    console.log(`  Total Memory: ${system.totalMemory} MB`);
    console.log();
    console.log('Idle Metrics:');
    console.log(`  Memory Usage: ${idle.memoryMB} MB`);
    console.log();
  }

  // Define endpoints to test
  const endpoints = [
    { endpoint: '/api/v2/health', method: 'GET', name: 'Health Check' },
    { endpoint: '/api/v2/info', method: 'GET', name: 'Info' },
    { endpoint: '/api/v2/instances', method: 'GET', name: 'List Instances' },
    { endpoint: '/api/v2/chats', method: 'GET', name: 'List Chats' },
    { endpoint: '/api/v2/events?limit=50', method: 'GET', name: 'List Events' },
    { endpoint: '/api/v2/messages?limit=50', method: 'GET', name: 'List Messages' },
  ];

  if (!jsonOutput) {
    console.log('Running baseline measurements...\n');
    console.log('Endpoint                     | Reqs | OK   | Fail | Avg(ms) | P95(ms) | P99(ms) | RPS');
    console.log('-'.repeat(95));
  }

  const results: EndpointResult[] = [];

  for (const ep of endpoints) {
    const result = await measureEndpoint(ep.endpoint, ep.method, {
      requestCount: 100,
      concurrency: 10,
    });
    results.push(result);

    if (!jsonOutput) {
      const epName = ep.name.padEnd(28);
      const reqs = result.requests.toString().padStart(4);
      const ok = result.successes.toString().padStart(4);
      const fail = result.failures.toString().padStart(4);
      const avg = result.latency.avg.toFixed(1).padStart(7);
      const p95 = result.latency.p95.toFixed(1).padStart(7);
      const p99 = result.latency.p99.toFixed(1).padStart(7);
      const rps = result.throughput.toFixed(0).padStart(5);
      console.log(`${epName} | ${reqs} | ${ok} | ${fail} | ${avg} | ${p95} | ${p99} | ${rps}`);
    }
  }

  // Calculate summary
  const totalRequests = results.reduce((sum, r) => sum + r.requests, 0);
  const totalSuccesses = results.reduce((sum, r) => sum + r.successes, 0);
  const totalFailures = results.reduce((sum, r) => sum + r.failures, 0);
  const avgLatency = results.reduce((sum, r) => sum + r.latency.avg, 0) / results.length;
  const avgP95 = results.reduce((sum, r) => sum + r.latency.p95, 0) / results.length;
  const avgP99 = results.reduce((sum, r) => sum + r.latency.p99, 0) / results.length;
  const avgThroughput = results.reduce((sum, r) => sum + r.throughput, 0) / results.length;

  const report: BaselineReport = {
    timestamp: new Date().toISOString(),
    apiUrl: API_URL,
    system,
    api: apiHealth,
    idle,
    endpoints: results,
    summary: {
      totalRequests,
      totalSuccesses,
      totalFailures,
      avgLatencyMs: Math.round(avgLatency * 100) / 100,
      p95LatencyMs: Math.round(avgP95 * 100) / 100,
      p99LatencyMs: Math.round(avgP99 * 100) / 100,
      avgThroughput: Math.round(avgThroughput),
    },
  };

  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log('-'.repeat(95));
    console.log();
    console.log('Summary:');
    console.log(`  Total Requests: ${totalRequests}`);
    console.log(`  Successes: ${totalSuccesses} (${((totalSuccesses / totalRequests) * 100).toFixed(1)}%)`);
    console.log(`  Failures: ${totalFailures} (${((totalFailures / totalRequests) * 100).toFixed(1)}%)`);
    console.log(`  Average Latency: ${avgLatency.toFixed(2)} ms`);
    console.log(`  P95 Latency: ${avgP95.toFixed(2)} ms`);
    console.log(`  P99 Latency: ${avgP99.toFixed(2)} ms`);
    console.log(`  Average Throughput: ${avgThroughput.toFixed(0)} req/s`);
    console.log();
    console.log('='.repeat(60));

    // Performance assessment
    console.log('\nPerformance Assessment:');

    if (avgLatency < 50) {
      console.log('  [OK] Average latency under 50ms - Acceptable');
    } else if (avgLatency < 100) {
      console.log('  [WARN] Average latency between 50-100ms - Warning');
    } else {
      console.log('  [CRITICAL] Average latency over 100ms - Critical');
    }

    if (avgP95 < 200) {
      console.log('  [OK] P95 latency under 200ms - Acceptable');
    } else if (avgP95 < 500) {
      console.log('  [WARN] P95 latency between 200-500ms - Warning');
    } else {
      console.log('  [CRITICAL] P95 latency over 500ms - Critical');
    }

    if (totalFailures === 0) {
      console.log('  [OK] No request failures - Acceptable');
    } else if (totalFailures / totalRequests < 0.01) {
      console.log('  [WARN] Error rate under 1% - Warning');
    } else {
      console.log('  [CRITICAL] Error rate over 1% - Critical');
    }
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
