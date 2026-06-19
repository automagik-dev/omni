#!/usr/bin/env bun
/**
 * Benchmark: output-redactor send-path overhead.
 *
 * Budget: p99 overhead < 10ms for a 2KB body against a 200-entry denylist.
 *
 * Method:
 *   - Compile a 200-entry preset once.
 *   - Build a representative 2KB send-like JSON body (text, caption, nested mentions, thread).
 *   - Run `redactBodyInPlace` N times, measuring per-invocation wall-clock in μs.
 *   - Report min / p50 / p95 / p99 / max. Exit non-zero if p99 >= 10_000μs.
 *
 * Run:
 *   bun run packages/api/bench/output-redactor.bench.ts
 */

import { compilePatterns, redactBodyInPlace } from '../src/middleware/output-redactor';

const P99_BUDGET_US = 10_000; // 10ms
const ITERATIONS = 5_000;
const WARMUP = 500;
const PRESET_SIZE = 200;
const TARGET_BYTES = 2_048;

function buildDenylist(size: number): string[] {
  // Mix of short + long literals; ~half of them never appear in the body.
  const out: string[] = [];
  for (let i = 0; i < size; i++) {
    const base = i % 10 === 0 ? 'sensitive-secret-' : 'never-match-';
    out.push(`${base}${i}`);
  }
  return out;
}

function buildBody(targetBytes: number): Record<string, unknown> {
  // Build a realistic-ish send payload, padded with a long caption until we hit ~target bytes.
  const body: Record<string, unknown> = {
    instanceId: '00000000-0000-0000-0000-000000000001',
    to: 'user@s.whatsapp.net',
    text: 'Please ship the sensitive-secret-0 to the vault (and mention sensitive-secret-10).',
    mentions: [
      { platformId: 'user-a', displayName: 'Alice' },
      { platformId: 'user-b', displayName: 'Bob' },
    ],
    threadId: 'topic-123',
    caption: '',
  };
  const filler = 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor. ';
  let caption = '';
  while (JSON.stringify({ ...body, caption }).length < targetBytes) {
    caption += filler;
  }
  // Embed a match somewhere in the middle of the caption.
  const mid = Math.floor(caption.length / 2);
  body.caption = `${caption.slice(0, mid)}sensitive-secret-20 ${caption.slice(mid)}`;
  return body;
}

function percentile(sortedNs: number[], p: number): number {
  const idx = Math.min(sortedNs.length - 1, Math.floor(sortedNs.length * p));
  return sortedNs[idx];
}

async function main() {
  const patterns = compilePatterns(buildDenylist(PRESET_SIZE));
  const bodyTemplate = buildBody(TARGET_BYTES);
  const templateJson = JSON.stringify(bodyTemplate);
  const byteSize = Buffer.byteLength(templateJson);

  // Warm up
  for (let i = 0; i < WARMUP; i++) {
    redactBodyInPlace(JSON.parse(templateJson), patterns);
  }

  const samples: number[] = new Array(ITERATIONS);
  for (let i = 0; i < ITERATIONS; i++) {
    const body = JSON.parse(templateJson);
    const start = performance.now();
    redactBodyInPlace(body, patterns);
    const end = performance.now();
    samples[i] = (end - start) * 1000; // → μs
  }

  samples.sort((a, b) => a - b);
  const p50 = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  const p99 = percentile(samples, 0.99);
  const min = samples[0];
  const max = samples[samples.length - 1];

  console.log('output-redactor benchmark');
  console.log('=========================');
  console.log(`body size           : ${byteSize} bytes`);
  console.log(`preset size         : ${PRESET_SIZE} patterns`);
  console.log(`iterations          : ${ITERATIONS} (${WARMUP} warmup)`);
  console.log(
    `min / p50 / p95 / p99 / max (μs): ${min.toFixed(1)} / ${p50.toFixed(1)} / ${p95.toFixed(1)} / ${p99.toFixed(1)} / ${max.toFixed(1)}`,
  );
  console.log(`budget (p99)        : < ${P99_BUDGET_US}μs`);

  if (p99 >= P99_BUDGET_US) {
    console.error(`FAIL: p99 ${p99.toFixed(1)}μs exceeds ${P99_BUDGET_US}μs budget`);
    process.exit(1);
  }
  console.log('PASS');
}

await main();
