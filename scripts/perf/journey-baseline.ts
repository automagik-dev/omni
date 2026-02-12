#!/usr/bin/env bun
/**
 * Journey Baseline Measurement Script
 *
 * Fetches journey data from the API and generates a performance baseline report.
 * Requires messages to have been processed with journey instrumentation enabled.
 *
 * Usage:
 *   bun scripts/perf/journey-baseline.ts
 *   bun scripts/perf/journey-baseline.ts --since 1h
 *   bun scripts/perf/journey-baseline.ts --output json
 *   bun scripts/perf/journey-baseline.ts --save   # Save to docs/performance/
 */

import { mkdirSync, writeFileSync } from 'node:fs';

const API_URL = process.env.API_URL || 'http://localhost:8882';
const API_KEY = process.env.OMNI_API_KEY || '';

interface PercentileStats {
  count: number;
  avg: number;
  min: number;
  max: number;
  p50: number;
  p95: number;
  p99: number;
}

interface JourneySummary {
  totalTracked: number;
  completedJourneys: number;
  activeJourneys: number;
  stages: Record<string, PercentileStats>;
  since: number;
}

/** Target latency thresholds from the wish doc */
const THRESHOLDS: Record<string, { acceptable: number; warning: number; critical: number }> = {
  totalInbound: { acceptable: 500, warning: 1000, critical: 2000 },
  dbWrite: { acceptable: 50, warning: 200, critical: 500 },
  natsDelivery: { acceptable: 10, warning: 50, critical: 100 },
  omniProcessing: { acceptable: 1000, warning: 2000, critical: 5000 },
  totalRoundTrip: { acceptable: 5000, warning: 10000, critical: 30000 },
};

/** Latency display names */
const STAGE_LABELS: Record<string, string> = {
  channelProcessing: 'Channel Processing (T0→T1)',
  eventPublish: 'Event Publish (T1→T2)',
  natsDelivery: 'NATS Delivery (T2→T3)',
  dbWrite: 'DB Write (T3→T4)',
  agentNotification: 'Agent Notification (T4→T5)',
  totalInbound: 'Total Inbound (T0→T5)',
  agentRoundTrip: 'Agent Round-Trip (T5→T7)',
  apiProcessing: 'API Processing (T7→T8)',
  outboundEventPublish: 'Outbound Publish (T8→T9)',
  outboundNatsDelivery: 'Outbound NATS (T9→T10)',
  platformSend: 'Platform Send (T10→T11)',
  totalOutbound: 'Total Outbound (T7→T11)',
  totalRoundTrip: 'Total Round-Trip (T0→T11)',
  omniProcessing: 'Omni Processing (excl. agent)',
};

async function fetchSummary(since?: string): Promise<JourneySummary> {
  const params = since ? `?since=${encodeURIComponent(since)}` : '';
  const res = await fetch(`${API_URL}/api/v2/journeys/summary${params}`, {
    headers: { 'x-api-key': API_KEY },
  });

  if (!res.ok) {
    throw new Error(`API returned ${res.status}: ${await res.text()}`);
  }

  return (await res.json()) as JourneySummary;
}

function assessThreshold(key: string, avgMs: number): 'OK' | 'WARNING' | 'CRITICAL' | null {
  const threshold = THRESHOLDS[key];
  if (!threshold) return null;
  if (avgMs <= threshold.acceptable) return 'OK';
  if (avgMs <= threshold.warning) return 'WARNING';
  return 'CRITICAL';
}

function generateReport(summary: JourneySummary, since?: string): string {
  const lines: string[] = [];
  const now = new Date().toISOString();

  lines.push('# Journey Performance Baseline Report');
  lines.push('');
  lines.push(`**Generated:** ${now}`);
  lines.push(`**API:** ${API_URL}`);
  if (since) lines.push(`**Period:** Since ${since}`);
  lines.push(`**Tracked Journeys:** ${summary.totalTracked}`);
  lines.push(`**Completed:** ${summary.completedJourneys}`);
  lines.push(`**Active:** ${summary.activeJourneys}`);
  lines.push('');

  if (Object.keys(summary.stages).length === 0) {
    lines.push('> No latency data available. Send messages with journey instrumentation enabled first.');
    return lines.join('\n');
  }

  // Stage metrics table
  lines.push('## Stage Latencies');
  lines.push('');
  lines.push('| Stage | Avg | P50 | P95 | P99 | Min | Max | Count | Status |');
  lines.push('|-------|-----|-----|-----|-----|-----|-----|-------|--------|');

  const stageOrder = [
    'channelProcessing',
    'eventPublish',
    'natsDelivery',
    'dbWrite',
    'agentNotification',
    'totalInbound',
    'agentRoundTrip',
    'apiProcessing',
    'outboundEventPublish',
    'outboundNatsDelivery',
    'platformSend',
    'totalOutbound',
    'totalRoundTrip',
    'omniProcessing',
  ];

  for (const key of stageOrder) {
    const stats = summary.stages[key];
    if (!stats) continue;

    const label = STAGE_LABELS[key] ?? key;
    const assessment = assessThreshold(key, stats.avg);
    const statusIcon =
      assessment === 'OK' ? 'OK' : assessment === 'WARNING' ? 'WARN' : assessment === 'CRITICAL' ? 'CRIT' : '-';

    lines.push(
      `| ${label} | ${stats.avg}ms | ${stats.p50}ms | ${stats.p95}ms | ${stats.p99}ms | ${stats.min}ms | ${stats.max}ms | ${stats.count} | ${statusIcon} |`,
    );
  }

  // Bottleneck analysis
  lines.push('');
  lines.push('## Bottleneck Analysis');
  lines.push('');

  const stageLatencies = Object.entries(summary.stages)
    .filter(([k]) => !k.startsWith('total') && k !== 'omniProcessing' && k !== 'agentRoundTrip')
    .sort((a, b) => b[1].avg - a[1].avg);

  const top3 = stageLatencies.slice(0, 3);
  if (top3.length > 0) {
    lines.push('**Top 3 Bottlenecks (by avg latency):**');
    lines.push('');
    for (const [i, [key, stats]] of top3.entries()) {
      const label = STAGE_LABELS[key] ?? key;
      lines.push(`${i + 1}. **${label}**: avg ${stats.avg}ms, p95 ${stats.p95}ms (${stats.count} samples)`);
    }
  }

  // Threshold assessment
  lines.push('');
  lines.push('## Threshold Assessment');
  lines.push('');
  lines.push('| Metric | Avg | Acceptable | Warning | Critical | Status |');
  lines.push('|--------|-----|------------|---------|----------|--------|');

  for (const [key, threshold] of Object.entries(THRESHOLDS)) {
    const stats = summary.stages[key];
    if (!stats) continue;
    const assessment = assessThreshold(key, stats.avg) ?? '-';
    const label = STAGE_LABELS[key] ?? key;
    lines.push(
      `| ${label} | ${stats.avg}ms | <${threshold.acceptable}ms | <${threshold.warning}ms | >${threshold.critical}ms | ${assessment} |`,
    );
  }

  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  const sinceArg = args.find((a) => a.startsWith('--since'));
  const since = sinceArg
    ? sinceArg.includes('=')
      ? sinceArg.split('=')[1]
      : args[args.indexOf(sinceArg) + 1]
    : undefined;
  const jsonOutput = args.includes('--output') && args.includes('json');
  const save = args.includes('--save');

  console.log('Fetching journey summary...');

  const summary = await fetchSummary(since).catch((e) => {
    console.error(`Error: Cannot fetch journey data from ${API_URL}`);
    console.error(e.message);
    process.exit(1);
  });

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  console.log(`Found ${summary.totalTracked} tracked journeys (${summary.completedJourneys} completed)\n`);

  if (summary.totalTracked === 0) {
    console.log('No journey data available yet.');
    console.log('Send messages with journey instrumentation enabled, then run this script again.');
    return;
  }

  const report = generateReport(summary, since);

  // Print to console
  console.log(report);

  // Save to file if requested
  if (save) {
    const dir = 'docs/performance';
    mkdirSync(dir, { recursive: true });
    const filename = `${dir}/journey-baseline.md`;
    writeFileSync(filename, report);
    console.log(`\nReport saved to ${filename}`);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
