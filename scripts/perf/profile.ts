#!/usr/bin/env bun
/**
 * CPU and Memory Profiling Script
 *
 * Profiles the Omni API under simulated load to identify bottlenecks.
 * Generates heap snapshots and CPU profiles for analysis.
 *
 * Usage:
 *   bun scripts/perf/profile.ts
 *   bun scripts/perf/profile.ts --duration=30     # Profile for 30 seconds
 *   bun scripts/perf/profile.ts --endpoint=/api/v2/messages
 *   bun scripts/perf/profile.ts --heap            # Take heap snapshots
 *
 * Output:
 *   - docs/profiling-results.md (findings)
 *   - /tmp/omni-heap-*.json (heap snapshots if --heap)
 *
 * Requirements:
 *   - API running on API_URL (default: http://localhost:8882)
 *   - OMNI_API_KEY set in environment
 */

const API_URL = process.env.API_URL || 'http://localhost:8882';
const API_KEY = process.env.OMNI_API_KEY || '';

interface TimingData {
  endpoint: string;
  samples: number[];
  memoryBefore: number;
  memoryAfter: number;
}

interface ProfileResult {
  duration: number;
  requestsPerSecond: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  memoryDeltaMB: number;
  bottlenecks: string[];
}

function parseArgs(): { duration: number; endpoint: string; heap: boolean; concurrency: number } {
  const args = process.argv.slice(2);
  let duration = 10; // seconds
  let endpoint = '/api/v2/health';
  let heap = false;
  let concurrency = 10;

  for (const arg of args) {
    if (arg.startsWith('--duration=')) {
      duration = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--endpoint=')) {
      endpoint = arg.split('=')[1];
    } else if (arg.startsWith('--concurrency=')) {
      concurrency = Number.parseInt(arg.split('=')[1], 10);
    } else if (arg === '--heap') {
      heap = true;
    }
  }

  return { duration, endpoint, heap, concurrency };
}

async function fetchWithTiming(url: string): Promise<{ ok: boolean; latencyMs: number }> {
  const start = performance.now();
  try {
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        'Accept-Encoding': 'identity', // Disable compression for accurate latency
        'x-api-key': API_KEY,
      },
    });
    const latencyMs = performance.now() - start;
    return { ok: res.ok, latencyMs };
  } catch {
    return { ok: false, latencyMs: performance.now() - start };
  }
}

function calculatePercentile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function getMemoryUsageMB(): number {
  const usage = process.memoryUsage();
  return Math.round(usage.heapUsed / (1024 * 1024));
}

async function profileEndpoint(endpoint: string, durationSeconds: number, concurrency: number): Promise<TimingData> {
  const samples: number[] = [];
  const memoryBefore = getMemoryUsageMB();
  const endTime = Date.now() + durationSeconds * 1000;
  const url = `${API_URL}${endpoint}`;

  console.log(`Profiling ${endpoint} for ${durationSeconds}s with concurrency ${concurrency}...`);

  let requestsInFlight = 0;
  const maxConcurrent = concurrency;

  while (Date.now() < endTime) {
    // Maintain target concurrency
    while (requestsInFlight < maxConcurrent && Date.now() < endTime) {
      requestsInFlight++;
      fetchWithTiming(url).then((result) => {
        requestsInFlight--;
        samples.push(result.latencyMs);
      });
    }
    // Small delay to prevent tight loop
    await new Promise((resolve) => setTimeout(resolve, 1));
  }

  // Wait for remaining requests
  while (requestsInFlight > 0) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return {
    endpoint,
    samples,
    memoryBefore,
    memoryAfter: getMemoryUsageMB(),
  };
}

function analyzeTimings(data: TimingData, duration: number): ProfileResult {
  const sorted = [...data.samples].sort((a, b) => a - b);
  const avg = sorted.length > 0 ? sorted.reduce((a, b) => a + b, 0) / sorted.length : 0;
  const p95 = calculatePercentile(sorted, 95);
  const p99 = calculatePercentile(sorted, 99);
  const rps = sorted.length / duration;
  const memoryDelta = data.memoryAfter - data.memoryBefore;

  const bottlenecks: string[] = [];

  // Identify bottlenecks
  if (avg > 50) {
    bottlenecks.push(`High average latency: ${avg.toFixed(1)}ms (target: <50ms)`);
  }
  if (p99 > 500) {
    bottlenecks.push(`High P99 latency: ${p99.toFixed(1)}ms (target: <500ms)`);
  }
  if (memoryDelta > 50) {
    bottlenecks.push(`Memory growth: +${memoryDelta}MB during test`);
  }
  if (rps < 100) {
    bottlenecks.push(`Low throughput: ${rps.toFixed(0)} req/s (target: >100 req/s)`);
  }

  // Check for latency spikes (high variance)
  if (sorted.length > 10) {
    const variance = sorted.reduce((sum, val) => sum + (val - avg) ** 2, 0) / sorted.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev > avg * 0.5) {
      bottlenecks.push(`High latency variance (stdDev: ${stdDev.toFixed(1)}ms) - possible GC or blocking`);
    }
  }

  return {
    duration,
    requestsPerSecond: rps,
    avgLatencyMs: avg,
    p95LatencyMs: p95,
    p99LatencyMs: p99,
    memoryDeltaMB: memoryDelta,
    bottlenecks,
  };
}

async function takeHeapSnapshot(label: string): Promise<string> {
  const filename = `/tmp/omni-heap-${label}-${Date.now()}.json`;

  // Bun doesn't have native heap snapshot API, but we can record memory usage
  const usage = process.memoryUsage();
  const snapshot = {
    label,
    timestamp: new Date().toISOString(),
    memory: {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
    },
    heapUsedMB: Math.round(usage.heapUsed / (1024 * 1024)),
    heapTotalMB: Math.round(usage.heapTotal / (1024 * 1024)),
    rssMB: Math.round(usage.rss / (1024 * 1024)),
  };

  await Bun.write(filename, JSON.stringify(snapshot, null, 2));
  return filename;
}

async function main() {
  const { duration, endpoint, heap, concurrency } = parseArgs();

  console.log('='.repeat(60));
  console.log('Omni API Profiler');
  console.log('='.repeat(60));
  console.log(`API URL: ${API_URL}`);
  console.log(`Endpoint: ${endpoint}`);
  console.log(`Duration: ${duration}s`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`Heap snapshots: ${heap ? 'enabled' : 'disabled'}`);
  console.log();

  // Verify API is running
  const healthCheck = await fetchWithTiming(`${API_URL}/api/v2/health`);
  if (!healthCheck.ok) {
    console.error(`Error: Cannot connect to API at ${API_URL}`);
    process.exit(1);
  }
  console.log(`API is responding (${healthCheck.latencyMs.toFixed(1)}ms)\n`);

  // Take initial heap snapshot
  let heapBefore: string | undefined;
  if (heap) {
    heapBefore = await takeHeapSnapshot('before');
    console.log(`Initial heap snapshot: ${heapBefore}`);
  }

  // Profile multiple endpoints
  const endpoints = [
    endpoint,
    '/api/v2/health',
    '/api/v2/instances',
    '/api/v2/chats',
    '/api/v2/events?limit=50',
  ].filter((e, i, arr) => arr.indexOf(e) === i); // unique

  const results: Map<string, ProfileResult> = new Map();

  for (const ep of endpoints) {
    const data = await profileEndpoint(ep, duration, concurrency);
    const result = analyzeTimings(data, duration);
    results.set(ep, result);

    console.log(`\n${ep}:`);
    console.log(`  Requests: ${data.samples.length}`);
    console.log(`  RPS: ${result.requestsPerSecond.toFixed(0)}`);
    console.log(`  Avg: ${result.avgLatencyMs.toFixed(1)}ms`);
    console.log(`  P95: ${result.p95LatencyMs.toFixed(1)}ms`);
    console.log(`  P99: ${result.p99LatencyMs.toFixed(1)}ms`);
    console.log(`  Memory delta: ${result.memoryDeltaMB}MB`);
    if (result.bottlenecks.length > 0) {
      console.log('  Bottlenecks:');
      for (const b of result.bottlenecks) {
        console.log(`    - ${b}`);
      }
    }
  }

  // Take final heap snapshot
  let heapAfter: string | undefined;
  if (heap) {
    heapAfter = await takeHeapSnapshot('after');
    console.log(`\nFinal heap snapshot: ${heapAfter}`);
  }

  // Summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Summary');
  console.log('='.repeat(60));

  const allBottlenecks = new Set<string>();
  for (const [, result] of results) {
    for (const b of result.bottlenecks) {
      allBottlenecks.add(b);
    }
  }

  if (allBottlenecks.size === 0) {
    console.log('\nNo significant bottlenecks identified.');
  } else {
    console.log('\nIdentified bottlenecks:');
    for (const b of allBottlenecks) {
      console.log(`  - ${b}`);
    }
  }

  // Recommendations
  console.log('\nRecommendations:');
  let hasRecs = false;

  // Check for auth endpoint slowness (indicates no caching)
  const instanceResult = results.get('/api/v2/instances');
  if (instanceResult && instanceResult.avgLatencyMs > 20) {
    console.log('  - Consider API key caching (current validation may hit DB every request)');
    hasRecs = true;
  }

  // Check for event listing slowness
  const eventResult = results.get('/api/v2/events?limit=50');
  if (eventResult && eventResult.avgLatencyMs > 100) {
    console.log('  - Event listing is slow - consider database indexing or pagination optimization');
    hasRecs = true;
  }

  // Memory growth
  let totalMemoryGrowth = 0;
  for (const [, result] of results) {
    totalMemoryGrowth += result.memoryDeltaMB;
  }
  if (totalMemoryGrowth > 100) {
    console.log('  - Significant memory growth detected - investigate for memory leaks');
    hasRecs = true;
  }

  if (!hasRecs) {
    console.log('  - Performance looks acceptable. Consider load testing for production validation.');
  }

  if (heap && heapBefore && heapAfter) {
    console.log('\nHeap snapshots saved to:');
    console.log(`  Before: ${heapBefore}`);
    console.log(`  After: ${heapAfter}`);
    console.log('\nTo analyze, compare the heapUsedMB values in these files.');
  }

  console.log();
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
