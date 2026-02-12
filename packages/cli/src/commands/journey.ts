/**
 * Journey Commands
 *
 * omni journey show <correlationId>  - Display journey timeline
 * omni journey summary [--since <duration>] - Display aggregated metrics
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { loadConfig } from '../config.js';
import * as output from '../output.js';

/** Stage display names for human-readable output */
const STAGE_LABELS: Record<string, string> = {
  T0: 'Platform received',
  T1: 'Plugin received',
  T2: 'Event published',
  T3: 'Event consumed',
  T4: 'DB stored',
  T5: 'Agent notified',
  T7: 'Agent completed',
  T8: 'API processed',
  T9: 'Event published',
  T10: 'Plugin sent',
  T11: 'Platform delivered',
};

/** Latency display names */
const LATENCY_LABELS: Record<string, string> = {
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

/** Journey response from API */
interface JourneyResponse {
  correlationId: string;
  checkpoints: Array<{ name: string; stage: string; timestamp: number }>;
  startedAt: number;
  completedAt?: number;
  latencies: Record<string, number>;
}

/** Summary response from API */
interface SummaryResponse {
  totalTracked: number;
  completedJourneys: number;
  activeJourneys: number;
  stages: Record<
    string,
    { count: number; avg: number; min: number; max: number; p50: number; p95: number; p99: number }
  >;
  since: number;
}

/** Build a visual timing bar */
function timingBar(ms: number, maxMs: number, width = 20): string {
  if (maxMs <= 0) return '';
  const filled = Math.max(1, Math.round((ms / maxMs) * width));
  const empty = width - filled;
  return `${'█'.repeat(filled)}${'░'.repeat(Math.max(0, empty))}`;
}

/** Format milliseconds with color */
function formatMs(ms: number): string {
  if (ms < 50) return chalk.green(`${ms}ms`);
  if (ms < 200) return chalk.yellow(`${ms}ms`);
  if (ms < 1000) return chalk.red(`${ms}ms`);
  return chalk.red.bold(`${ms}ms`);
}

/** Fetch from API */
async function apiFetch(path: string): Promise<Response> {
  const config = loadConfig();
  const baseUrl = config.apiUrl ?? 'http://localhost:8882';
  return fetch(`${baseUrl}/api/v2/journeys${path}`, {
    headers: { 'x-api-key': config.apiKey ?? '' },
  });
}

/** Print a flow section (inbound, agent, outbound) with optional total */
function printFlowSection(
  title: string,
  checkpoints: Array<{ name: string; stage: string; timestamp: number }>,
  baseTime: number,
  maxDelta: number,
  totalLabel: string,
  totalMs: number | undefined,
): void {
  if (checkpoints.length === 0) return;
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`\n${chalk.bold(`${title}:`)}`);
  printCheckpoints(checkpoints, baseTime, maxDelta);
  if (totalMs != null) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(chalk.dim('  ─'.repeat(12)));
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`  ${totalLabel}: ${formatMs(totalMs)}`);
  }
}

/** Print journey totals and bottleneck */
function printJourneySummaryFooter(latencies: Record<string, number>): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(`\n${chalk.dim('━'.repeat(50))}`);
  if (latencies.totalRoundTrip != null) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`  Total Round-Trip: ${formatMs(latencies.totalRoundTrip)}`);
  }
  if (latencies.omniProcessing != null) {
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`  Omni Processing:  ${formatMs(latencies.omniProcessing)} ${chalk.dim('(excl. agent)')}`);
  }

  const stageLatencies = Object.entries(latencies)
    .filter(([k]) => !k.startsWith('total') && k !== 'omniProcessing' && k !== 'agentRoundTrip')
    .filter(([, v]) => v != null && v > 0);

  if (stageLatencies.length > 0) {
    const [bottleneckKey, bottleneckMs] = stageLatencies.sort((a, b) => b[1] - a[1])[0];
    const omniTime = latencies.omniProcessing;
    const pct = omniTime ? Math.round((bottleneckMs / omniTime) * 100) : 0;
    const label = LATENCY_LABELS[bottleneckKey] ?? bottleneckKey;
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(
      `\n  ${chalk.yellow('Bottleneck:')} ${label} took ${formatMs(bottleneckMs)}${pct > 0 ? ` — ${pct}% of Omni time` : ''}`,
    );
  }
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('');
}

/** Display a journey timeline */
async function showJourney(correlationId: string): Promise<void> {
  try {
    const resp = await apiFetch(`/${correlationId}`);

    if (!resp.ok) {
      if (resp.status === 404) {
        output.error(`No journey found for: ${correlationId}`);
      }
      output.error(`API returned ${resp.status}: ${await resp.text()}`);
    }

    const journey = (await resp.json()) as JourneyResponse;

    if (output.getCurrentFormat() === 'json') {
      output.data(journey);
      return;
    }

    const sorted = [...journey.checkpoints].sort((a, b) => a.timestamp - b.timestamp);
    if (sorted.length === 0) {
      output.warn('Journey has no checkpoints');
      return;
    }

    const baseTime = sorted[0].timestamp;
    const deltas: number[] = [];
    for (let i = 1; i < sorted.length; i++) {
      deltas.push(sorted[i].timestamp - sorted[i - 1].timestamp);
    }
    const maxDelta = Math.max(...deltas, 1);

    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`\n${chalk.bold(`Message Journey: ${correlationId}`)}`);
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(chalk.dim('━'.repeat(50)));

    const inbound = sorted.filter((cp) => ['T0', 'T1', 'T2', 'T3', 'T4', 'T5'].includes(cp.stage));
    const agent = sorted.filter((cp) => cp.stage === 'T7');
    const outbound = sorted.filter((cp) => ['T8', 'T9', 'T10', 'T11'].includes(cp.stage));

    printFlowSection('Inbound Flow', inbound, baseTime, maxDelta, 'Total Inbound', journey.latencies.totalInbound);
    printFlowSection(
      'Agent Processing',
      agent,
      baseTime,
      maxDelta,
      `Agent Time ${chalk.dim('(T5→T7, external)')}`,
      journey.latencies.agentRoundTrip,
    );
    printFlowSection('Outbound Flow', outbound, baseTime, maxDelta, 'Total Outbound', journey.latencies.totalOutbound);
    printJourneySummaryFooter(journey.latencies);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to fetch journey: ${message}`);
  }
}

/** Print a list of checkpoints with timing bars */
function printCheckpoints(
  checkpoints: Array<{ name: string; stage: string; timestamp: number }>,
  baseTime: number,
  maxDelta: number,
): void {
  let prevTs = baseTime;
  for (const cp of checkpoints) {
    const delta = cp.timestamp - prevTs;
    const label = STAGE_LABELS[cp.stage] ?? cp.name;
    const stageTag = chalk.dim(cp.stage.padEnd(4));

    if (cp === checkpoints[0] && cp.stage === 'T0') {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(`  ${chalk.green('✓')} ${label.padEnd(24)} ${stageTag}  ${chalk.dim('0ms')}`);
    } else {
      const bar = timingBar(delta, maxDelta);
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(
        `  ${chalk.green('✓')} ${label.padEnd(24)} ${stageTag} ${formatMs(delta).padStart(8)}  ${chalk.cyan(bar)}`,
      );
    }
    prevTs = cp.timestamp;
  }
}

const SUMMARY_SEPARATOR = `  ${'─'.repeat(34)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(7)} ${'─'.repeat(6)}`;

/** Ordered stage keys for summary table */
const SUMMARY_STAGE_ORDER = [
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

/** Print the summary stage stats table */
function printSummaryStageTable(stages: SummaryResponse['stages']): void {
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(
    `\n  ${chalk.bold('Stage'.padEnd(34))} ${chalk.bold('Avg'.padStart(7))} ${chalk.bold('P50'.padStart(7))} ${chalk.bold('P95'.padStart(7))} ${chalk.bold('P99'.padStart(7))} ${chalk.bold('Count'.padStart(6))}`,
  );
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log(chalk.dim(SUMMARY_SEPARATOR));

  for (const key of SUMMARY_STAGE_ORDER) {
    const stats = stages[key];
    if (!stats) continue;

    const label = (LATENCY_LABELS[key] ?? key).padEnd(34);
    const isTotal = key.startsWith('total') || key === 'omniProcessing';
    const line = `  ${isTotal ? chalk.bold(label) : label} ${formatMs(stats.avg).padStart(7)} ${formatMs(stats.p50).padStart(7)} ${formatMs(stats.p95).padStart(7)} ${formatMs(stats.p99).padStart(7)} ${String(stats.count).padStart(6)}`;

    if (isTotal) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(chalk.dim(SUMMARY_SEPARATOR));
    }
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(line);
  }
  // biome-ignore lint/suspicious/noConsole: CLI output
  console.log('');
}

/** Display aggregated journey summary */
async function showSummary(since?: string): Promise<void> {
  try {
    const query = since ? `?since=${encodeURIComponent(since)}` : '';
    const resp = await apiFetch(`/summary${query}`);

    if (!resp.ok) {
      output.error(`API returned ${resp.status}: ${await resp.text()}`);
    }

    const summary = (await resp.json()) as SummaryResponse;

    if (output.getCurrentFormat() === 'json') {
      output.data(summary);
      return;
    }

    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(`\n${chalk.bold('Journey Summary')}`);
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(chalk.dim('━'.repeat(50)));
    // biome-ignore lint/suspicious/noConsole: CLI output
    console.log(
      `  Tracked: ${chalk.bold(String(summary.totalTracked))}  Completed: ${chalk.green(String(summary.completedJourneys))}  Active: ${chalk.yellow(String(summary.activeJourneys))}`,
    );

    if (Object.keys(summary.stages).length === 0) {
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log(chalk.dim('\n  No latency data available yet.'));
      // biome-ignore lint/suspicious/noConsole: CLI output
      console.log('');
      return;
    }

    printSummaryStageTable(summary.stages);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.error(`Failed to fetch summary: ${message}`);
  }
}

export function createJourneyCommand(): Command {
  const journey = new Command('journey').description('Message journey tracing');

  journey
    .command('show <correlationId>')
    .description('Display journey timeline with timing bars')
    .action(async (correlationId: string) => {
      await showJourney(correlationId);
    });

  journey
    .command('summary')
    .description('Display aggregated journey metrics')
    .option('--since <duration>', 'Filter by time (e.g., 1h, 30m, 24h, or ISO date)')
    .action(async (options: { since?: string }) => {
      await showSummary(options.since);
    });

  return journey;
}
