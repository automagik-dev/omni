/**
 * Event Commands
 *
 * omni events list --instance <id>
 * omni events stream [flags]
 * omni events trace <id>
 * omni events search <query>
 * omni events timeline <person-id>
 */

import type { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import type { Event, OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import { getOutputFormat, loadConfig } from '../config.js';
import * as output from '../output.js';
import { resolveChatId, resolveInstanceId } from '../resolve.js';

/** Replay command options */
interface ReplayOptions {
  start?: boolean;
  since?: string;
  until?: string;
  types?: string;
  instance?: string;
  speed?: number;
  dryRun?: boolean;
  status?: string;
  cancel?: string;
}

/** Parse time duration like "30min", "24h", "7d", "1w", "1m" (months) into ISO timestamp */
function parseSinceTime(since: string): string {
  const match = since.match(/^(\d+)([hdwm]|min)$/);
  if (!match) {
    // Assume ISO timestamp
    return since;
  }

  const value = Number.parseInt(match[1], 10);
  const unit = match[2];

  const now = Date.now();
  let ms: number;

  switch (unit) {
    case 'min':
      ms = value * 60 * 1000;
      break;
    case 'h':
      ms = value * 60 * 60 * 1000;
      break;
    case 'd':
      ms = value * 24 * 60 * 60 * 1000;
      break;
    case 'w':
      ms = value * 7 * 24 * 60 * 60 * 1000;
      break;
    case 'm':
      ms = value * 30 * 24 * 60 * 60 * 1000;
      break;
    default:
      return since;
  }

  return new Date(now - ms).toISOString();
}

/** Cancel a replay session */
async function cancelReplay(client: OmniClient, id: string): Promise<void> {
  await client.eventOps.cancelReplay(id);
  output.success(`Replay session cancelled: ${id}`);
}

/** Get replay session status */
async function getReplayStatus(client: OmniClient, id: string): Promise<void> {
  const session = await client.eventOps.getReplay(id);
  output.data(session);
}

/** Start a new replay session */
async function startReplay(client: OmniClient, options: ReplayOptions): Promise<void> {
  if (!options.since) {
    output.error('--since is required when starting a replay');
    return;
  }

  const session = await client.eventOps.startReplay({
    since: parseSinceTime(options.since),
    until: options.until ? parseSinceTime(options.until) : undefined,
    eventTypes: options.types?.split(','),
    instanceId: options.instance,
    speedMultiplier: options.speed,
    dryRun: options.dryRun,
  });

  output.success(`Replay session started: ${session.id}`, {
    id: session.id,
    status: session.status,
    since: session.options.since,
    until: session.options.until,
  });
}

/** List all replay sessions */
async function listReplays(client: OmniClient): Promise<void> {
  const sessions = await client.eventOps.listReplays();

  const items = sessions.map((s) => ({
    id: s.id,
    status: s.status,
    since: s.options.since,
    until: s.options.until ?? '-',
    progress: s.progress ?? '-',
  }));

  output.list(items, { emptyMessage: 'No replay sessions found.' });
}

/** Analytics response shape */
interface AnalyticsData {
  totalMessages: number;
  successfulMessages: number;
  failedMessages: number;
  successRate: number;
  avgProcessingTimeMs: number | null;
  avgAgentTimeMs: number | null;
  messageTypes: Record<string, number>;
  errorStages: Record<string, number>;
  instances: Record<string, number>;
}

/** Fetch analytics from the API */
async function fetchAnalytics(options: {
  instance?: string;
  since?: string;
  allTime?: boolean;
}): Promise<AnalyticsData> {
  const config = loadConfig();
  const baseUrl = config.apiUrl ?? 'http://localhost:8882';

  const params = new URLSearchParams();
  if (options.instance) {
    // Resolve instance name/prefix to UUID
    const instanceId = await resolveInstanceId(options.instance);
    params.set('instanceId', instanceId);
  }
  if (options.allTime) params.set('allTime', 'true');
  if (options.since) params.set('since', parseSinceTime(options.since));

  const resp = await fetch(`${baseUrl}/api/v2/events/analytics?${params}`, {
    headers: { 'x-api-key': config.apiKey ?? '' },
  });

  if (!resp.ok) {
    throw new Error(`API returned ${resp.status}: ${await resp.text()}`);
  }

  return (await resp.json()) as AnalyticsData;
}

/** Display analytics data */
function displayAnalytics(data: AnalyticsData): void {
  const format = getOutputFormat();

  // For JSON output, use proper numeric types
  if (format === 'json') {
    output.data({
      totalMessages: data.totalMessages,
      successful: data.successfulMessages,
      failed: data.failedMessages,
      successRate: data.successRate,
      avgProcessingMs: data.avgProcessingTimeMs,
      avgAgentMs: data.avgAgentTimeMs,
      messageTypes: data.messageTypes,
      instances: data.instances,
      errorStages: data.errorStages,
    });
  } else {
    // For human output, format as strings for readability
    // Note: successRate from API is already a percentage (0-100), not a fraction (0-1)
    output.data({
      totalMessages: data.totalMessages,
      successful: data.successfulMessages,
      failed: data.failedMessages,
      successRate: `${data.successRate.toFixed(1)}%`,
      avgProcessingMs: data.avgProcessingTimeMs ?? '-',
      avgAgentMs: data.avgAgentTimeMs ?? '-',
    });

    displayRecordBreakdown('Message Types', data.messageTypes, 'type');
    displayRecordBreakdown('Per Instance', data.instances, 'instanceId');
    displayRecordBreakdown('Error Stages', data.errorStages, 'stage');
  }
}

/** Display a record as a sorted list */
function displayRecordBreakdown(title: string, record: Record<string, number>, keyName: string): void {
  if (!record || Object.keys(record).length === 0) return;
  output.raw(`\n${title}:`);
  const items = Object.entries(record)
    .sort(([, a], [, b]) => b - a)
    .map(([key, count]) => ({ [keyName]: key, count }));
  output.list(items);
}

// ============================================================================
// TRACE
// ============================================================================

/** One journal row as returned inside a trace response. */
interface TraceEvent {
  id: string;
  eventType: string;
  receivedAt: string;
  causationId: string | null;
  metadata?: { correlationId?: string } | null;
  textContent?: string | null;
}

interface TraceResponse {
  data: {
    event: TraceEvent;
    ancestors: TraceEvent[];
    descendants: Array<{ event: TraceEvent; depth: number }>;
    truncated: boolean;
  };
}

/**
 * Fetch a causality trace from the API. Raw fetch (like `fetchAnalytics`)
 * because the generated SDK does not expose the trace endpoint yet — the CLI
 * still only ever talks to the API, never the database.
 */
async function fetchTrace(id: string): Promise<TraceResponse['data']> {
  const config = loadConfig();
  const baseUrl = config.apiUrl ?? 'http://localhost:8882';

  const resp = await fetch(`${baseUrl}/api/v2/events/${encodeURIComponent(id)}/trace`, {
    headers: { 'x-api-key': config.apiKey ?? '' },
  });

  if (!resp.ok) {
    throw new Error(`API returned ${resp.status}: ${await resp.text()}`);
  }

  return ((await resp.json()) as TraceResponse).data;
}

/** One human-readable trace line: type, short id, time, correlation. */
export function formatTraceLine(event: TraceEvent, marker: string): string {
  const time = new Date(event.receivedAt).toISOString().replace('T', ' ').slice(0, 19);
  const corr = event.metadata?.correlationId?.slice(0, 8) ?? '--------';
  const text = event.textContent ? `  "${event.textContent.slice(0, 40)}"` : '';
  return `${marker}${event.eventType}  ${event.id.slice(0, 8)}  ${time}  corr=${corr}${text}`;
}

/**
 * Render the chain root→focus→fan-out as an indented tree. Answers "why did
 * this event happen?" (the ancestors) and "what did it cause?" (the
 * descendants) in one view.
 */
function displayTrace(data: TraceResponse['data']): void {
  if (getOutputFormat() === 'json') {
    output.data(data);
    return;
  }

  let indent = 0;
  for (const ancestor of data.ancestors) {
    const label = indent === 0 && !ancestor.causationId ? ' (root)' : '';
    output.raw(`${'  '.repeat(indent)}${formatTraceLine(ancestor, indent === 0 ? '● ' : '└─ ')}${label}`);
    indent++;
  }

  const focusIsRoot = data.ancestors.length === 0 && !data.event.causationId;
  output.raw(
    `${'  '.repeat(indent)}${formatTraceLine(data.event, indent === 0 ? '● ' : '└─ ')}${focusIsRoot ? ' (root)' : ''}  ← trace target`,
  );

  for (const { event, depth } of data.descendants) {
    output.raw(`${'  '.repeat(indent + depth)}${formatTraceLine(event, '└─ ')}`);
  }

  if (data.descendants.length === 0) {
    output.dim('(no descendants — nothing was caused by this event)');
  }
  if (data.truncated) {
    output.warn('Trace truncated (depth/node cap reached)');
  }
}

// ============================================================================
// SCHEMA REGISTRY (issue #959)
// ============================================================================

/** A registered event schema as returned by the API. */
interface EventSchemaData {
  id: string;
  eventType: string;
  version: number;
  schema: Record<string, unknown>;
  description: string | null;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Raw CLI→API call for endpoints the generated SDK does not cover yet
 * (`fetchAnalytics` precedent above; the CLI never queries the DB directly).
 */
async function schemaApiRequest<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  const config = loadConfig();
  const baseUrl = config.apiUrl ?? 'http://localhost:8882';

  const resp = await fetch(`${baseUrl}/api/v2/events/schemas${path}`, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey ?? '' },
  });

  if (!resp.ok) {
    throw new Error(`API returned ${resp.status}: ${await resp.text()}`);
  }

  return (await resp.json()) as T;
}

/** Load the JSON Schema artifact from --file or inline --schema (exactly one). */
function loadSchemaArtifact(options: { file?: string; schema?: string }): Record<string, unknown> {
  if ((options.file ? 1 : 0) + (options.schema ? 1 : 0) !== 1) {
    throw new Error('Provide the JSON Schema via exactly one of --file <path> or --schema <json>');
  }
  const raw = options.file ? readFileSync(options.file, 'utf-8') : (options.schema as string);
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('The JSON Schema artifact must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

function summarizeSchemaRow(row: EventSchemaData): Record<string, unknown> {
  return {
    eventType: row.eventType,
    version: row.version,
    enabled: row.enabled,
    description: row.description ?? '-',
    updatedAt: row.updatedAt,
  };
}

function createSchemaCommand(): Command {
  const schema = new Command('schema').description('Manage the event schema registry (per-type payload contracts)');

  schema
    .command('register <eventType>')
    .description('Register (or compatibly revise) the JSON Schema for an event type')
    .option('--file <path>', 'Path to a JSON Schema file')
    .option('--schema <json>', 'Inline JSON Schema')
    .option('--description <text>', 'Description for the registration')
    .option('--disabled', 'Register with the validation gate disabled')
    .action(
      async (
        eventType: string,
        options: { file?: string; schema?: string; description?: string; disabled?: boolean },
      ) => {
        try {
          const artifact = loadSchemaArtifact(options);

          const result = await schemaApiRequest<{ data: EventSchemaData }>('', {
            method: 'POST',
            body: JSON.stringify({
              eventType,
              schema: artifact,
              description: options.description,
              enabled: options.disabled ? false : undefined,
            }),
          });

          output.success(`Schema registered: ${result.data.eventType} (version ${result.data.version})`, {
            eventType: result.data.eventType,
            version: result.data.version,
            enabled: result.data.enabled,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to register schema: ${message}`);
        }
      },
    );

  schema
    .command('list')
    .description('List registered event schemas')
    .option('--enabled', 'Only schemas with an active validation gate')
    .action(async (options: { enabled?: boolean }) => {
      try {
        const query = options.enabled ? '?enabled=true' : '';
        const result = await schemaApiRequest<{ items: EventSchemaData[] }>(query);
        output.list(result.items.map(summarizeSchemaRow), { emptyMessage: 'No event schemas registered.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to list schemas: ${message}`);
      }
    });

  schema
    .command('get <eventType>')
    .description('Show the registered schema for an event type')
    .action(async (eventType: string) => {
      try {
        const result = await schemaApiRequest<{ data: EventSchemaData }>(`/${encodeURIComponent(eventType)}`);
        output.data(result.data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get schema: ${message}`);
      }
    });

  return schema;
}

export const __testables = { schemaApiRequest, loadSchemaArtifact, summarizeSchemaRow };

// ============================================================================
// STREAM
// ============================================================================

/**
 * High-frequency event types hidden by default on `omni events stream`.
 * `--all` surfaces them. Mirrors `genie events stream --all`.
 */
const NOISY_EVENT_TYPES: ReadonlySet<string> = new Set([
  'presence.typing',
  'presence.online',
  'presence.offline',
  'message.delivered',
  'message.read',
  'sync.progress',
  'batch-job.progress',
]);

/** True when event_type denotes a failure/denial — used by --errors-only. */
export function isErrorEvent(eventType: string): boolean {
  return eventType.endsWith('.failed') || eventType === 'access.denied' || eventType.endsWith('.processing.failed');
}

/** True when event_type is considered noisy and should be hidden unless --all is set. */
export function isNoisyEvent(eventType: string): boolean {
  return NOISY_EVENT_TYPES.has(eventType);
}

/** Filter predicate matrix for `omni events stream`. Exported for unit tests. */
export interface StreamFilterOptions {
  instanceId?: string;
  channel?: string;
  type?: string;
  chatId?: string;
  personId?: string;
  errorsOnly?: boolean;
  all?: boolean;
}

/**
 * Return true when event should be emitted given the filter options.
 * The API pre-filters by instanceId / channel / eventType / since, so this
 * is primarily a post-fetch sieve for filters the list API does not support
 * (chat-id, person-id, errors-only, noise suppression).
 */
export function passesStreamFilters(event: Event, options: StreamFilterOptions): boolean {
  if (options.instanceId && event.instanceId !== options.instanceId) return false;
  if (options.type && event.eventType !== options.type) return false;
  if (options.chatId && event.chatUuid !== options.chatId) return false;
  if (options.personId && event.personId !== options.personId) return false;
  if (options.errorsOnly && !isErrorEvent(event.eventType)) return false;
  if (!options.all && isNoisyEvent(event.eventType)) return false;
  return true;
}

/** Format an event as a single human-readable line. */
export function formatEventLine(event: Event): string {
  const time = new Date(event.receivedAt).toISOString().slice(11, 19);
  const instance = event.instanceId?.slice(0, 8) ?? '--------';
  const chat = event.chatUuid?.slice(0, 8) ?? '--------';
  const summary = event.textContent ?? event.transcription ?? event.imageDescription ?? '';
  const trimmed = summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
  return `${time}  ${event.eventType.padEnd(28)}  ${instance}/${chat}  ${event.direction.padEnd(8)}  ${trimmed}`.trimEnd();
}

/** Emit an event through the drain-safe stdout helper — never raw console.log. */
function emitStreamEvent(event: Event, ndjson: boolean): void {
  if (ndjson) {
    output.raw(JSON.stringify(event));
  } else {
    output.raw(formatEventLine(event));
  }
}

interface StreamOptions {
  instance?: string;
  channel?: string;
  type?: string;
  chatId?: string;
  personId?: string;
  since?: string;
  errorsOnly?: boolean;
  all?: boolean;
  ndjson?: boolean;
  pollMs?: number;
}

/**
 * Poll `/events` and emit new rows as they arrive.
 *
 * Transport: polls `client.events.list({ since })` because the API does not
 * currently expose an SSE/WS stream for events. Polling keeps the CLI thin,
 * reuses the list query path (zero schema/regression risk), and mirrors
 * `genie events stream`'s internal follower cadence. An SSE/WS endpoint is
 * a follow-up (see issue #415 non-goals).
 */
interface StreamState {
  sinceIso: string;
  seen: Set<string>;
}

async function fetchStreamBatch(
  client: OmniClient,
  filters: StreamFilterOptions,
  channel: string | undefined,
  type: string | undefined,
  sinceIso: string,
): Promise<Event[]> {
  try {
    const result = await client.events.list({
      instanceId: filters.instanceId,
      channel,
      eventType: type,
      since: sinceIso,
      limit: 100,
    });
    return result.items;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    output.warn(`events stream: ${message}`);
    return [];
  }
}

function processStreamBatch(items: Event[], filters: StreamFilterOptions, state: StreamState, ndjson: boolean): void {
  const ascending = [...items].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (const ev of ascending) {
    if (state.seen.has(ev.id)) continue;
    state.seen.add(ev.id);
    if (!passesStreamFilters(ev, filters)) continue;
    emitStreamEvent(ev, ndjson);
    if (ev.receivedAt > state.sinceIso) state.sinceIso = ev.receivedAt;
  }
  // Bound the dedupe set — once the cursor moves past events we cannot
  // re-observe them, so a periodic flush keeps memory O(poll window).
  // Keep the most recent batch's IDs to avoid re-emitting events returned
  // again by an inclusive `since: state.sinceIso` query on the next poll.
  if (state.seen.size > 5000 && items.length > 0) {
    state.seen = new Set(items.map((ev) => ev.id));
  }
}

async function streamEvents(client: OmniClient, options: StreamOptions): Promise<void> {
  const ndjson = options.ndjson === true || getOutputFormat() === 'json';
  const pollMs = Math.max(250, options.pollMs ?? 2000);
  const instanceId = options.instance ? await resolveInstanceId(options.instance) : undefined;
  const chatId = options.chatId ? await resolveChatId(options.chatId) : undefined;

  const state: StreamState = {
    sinceIso: options.since ? parseSinceTime(options.since) : new Date().toISOString(),
    seen: new Set<string>(),
  };
  const filters: StreamFilterOptions = {
    instanceId,
    channel: options.channel,
    type: options.type,
    chatId,
    personId: options.personId,
    errorsOnly: options.errorsOnly,
    all: options.all,
  };

  let stopped = false;
  const shutdown = (): void => {
    stopped = true;
  };
  // Bun narrows Process.off() to Bun-only events, while signal listeners use
  // the standard EventEmitter contract shared by Node and Bun.
  const processEvents: EventEmitter = process;
  processEvents.on('SIGINT', shutdown);
  processEvents.on('SIGTERM', shutdown);

  if (!ndjson) output.dim(`Streaming events (poll=${pollMs}ms). Ctrl+C to stop.`);

  try {
    while (!stopped) {
      const items = await fetchStreamBatch(client, filters, options.channel, options.type, state.sinceIso);
      processStreamBatch(items, filters, state, ndjson);
      if (stopped) break;
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    processEvents.off('SIGINT', shutdown);
    processEvents.off('SIGTERM', shutdown);
    await output.flushStdout();
  }
}

export function createEventsCommand(): Command {
  const events = new Command('events').description('Query events');

  // omni events schema register|list|get (issue #959)
  events.addCommand(createSchemaCommand());

  // omni events list
  events
    .command('list')
    .description('List events')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--channel <type>', 'Filter by channel type')
    .option('--type <type>', 'Filter by event type')
    .option('--chat-id <id>', 'Filter by chat ID')
    .option('--since <time>', 'Events since (e.g., 24h, 7d, or ISO timestamp)')
    .option('--until <time>', 'Events until (ISO timestamp)')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 50)
    .action(
      async (options: {
        instance?: string;
        channel?: string;
        type?: string;
        chatId?: string;
        since?: string;
        until?: string;
        limit?: number;
      }) => {
        const client = getClient();

        try {
          const instanceId = options.instance ? await resolveInstanceId(options.instance) : undefined;
          // Note: chatId resolution added, but SDK doesn't support it yet
          // This will be a no-op until the SDK is updated
          if (options.chatId) {
            await resolveChatId(options.chatId);
          }

          const result = await client.events.list({
            instanceId,
            channel: options.channel,
            eventType: options.type,
            // chatId parameter not yet supported by SDK
            since: options.since ? parseSinceTime(options.since) : undefined,
            until: options.until,
            limit: options.limit,
          });

          const items = result.items.map((e) => ({
            id: e.id,
            type: e.eventType,
            instanceId: e.instanceId,
            direction: e.direction,
            receivedAt: e.receivedAt,
          }));

          output.list(items, { emptyMessage: 'No events found.' });
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to list events: ${message}`);
        }
      },
    );

  // omni events stream
  events
    .command('stream')
    .description('Stream events in real-time (tail -f style). Ctrl+C to stop.')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--channel <type>', 'Filter by channel type')
    .option('--type <type>', 'Filter by event type')
    .option('--chat-id <id>', 'Filter by chat ID')
    .option('--person-id <id>', 'Filter by person ID')
    .option('--since <time>', 'Start cursor (e.g., 5min, 24h, 7d, or ISO timestamp)')
    .option('--errors-only', 'Show only error/failure events')
    .option('--all', 'Include noisy event types (presence, delivered, read, progress)')
    .option('--ndjson', 'Emit JSON Lines (one event per line) — same as global --json in stream mode')
    .option('--poll-ms <n>', 'Polling interval in milliseconds', (v) => Number.parseInt(v, 10), 2000)
    .action(
      async (options: {
        instance?: string;
        channel?: string;
        type?: string;
        chatId?: string;
        personId?: string;
        since?: string;
        errorsOnly?: boolean;
        all?: boolean;
        ndjson?: boolean;
        pollMs?: number;
      }) => {
        const client = getClient();
        try {
          await streamEvents(client, options);
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          output.error(`Failed to stream events: ${message}`);
        }
      },
    );

  // omni events get <id>
  events
    .command('get <id>')
    .description('Get full details for a single event by ID')
    .action(async (id: string) => {
      const client = getClient();

      try {
        const event = await client.events.get(id);
        output.data(event);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get event: ${message}`);
      }
    });

  // omni events trace <id>
  events
    .command('trace <id>')
    .description('Walk the causality chain around an event: root → parents → this event → everything it caused')
    .action(async (id: string) => {
      try {
        const data = await fetchTrace(id);
        displayTrace(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to trace event: ${message}`);
      }
    });

  // omni events search <query>
  events
    .command('search <query>')
    .description('Search events by content')
    .option('--since <time>', 'Events since (e.g., 24h, 7d)')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 50)
    .action(async (query: string, options: { since?: string; limit?: number }) => {
      const client = getClient();

      try {
        const result = await client.events.list({
          search: query,
          since: options.since ? parseSinceTime(options.since) : undefined,
          limit: options.limit,
        });

        const items = result.items.map((e) => ({
          id: e.id,
          type: e.eventType,
          instanceId: e.instanceId,
          direction: e.direction,
          receivedAt: e.receivedAt,
        }));

        output.list(items, { emptyMessage: 'No matching events found.' });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to search events: ${message}`);
      }
    });

  // omni events timeline <person-id>
  events
    .command('timeline <personId>')
    .description('Show event timeline for a person')
    .option('--limit <n>', 'Limit results', (v) => Number.parseInt(v, 10), 50)
    .action(async (personId: string, options: { limit?: number }) => {
      const client = getClient();

      try {
        // Get events related to this person
        // Note: The API might need a specific endpoint for person timeline
        // For now, we search by person ID
        const result = await client.events.list({
          search: personId,
          limit: options.limit,
        });

        const items = result.items.map((e) => ({
          id: e.id,
          type: e.eventType,
          instanceId: e.instanceId,
          direction: e.direction,
          receivedAt: e.receivedAt,
        }));

        output.list(items, { emptyMessage: `No events found for person: ${personId}` });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get timeline: ${message}`);
      }
    });

  // omni events metrics
  events
    .command('metrics')
    .description('Get event processing metrics')
    .action(async () => {
      const client = getClient();

      try {
        const metrics = await client.eventOps.metrics();
        output.data(metrics);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get metrics: ${message}`);
      }
    });

  // omni events analytics
  events
    .command('analytics')
    .description('Show event analytics summary')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--since <time>', 'Events since (e.g., 24h, 7d, or ISO timestamp)')
    .option('--all-time', 'Show all-time stats (default: last 24h)')
    .action(async (options: { instance?: string; since?: string; allTime?: boolean }) => {
      try {
        const data = await fetchAnalytics(options);
        displayAnalytics(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to get analytics: ${message}`);
      }
    });

  // omni events replay
  events
    .command('replay')
    .description('Start, list, or manage replay sessions')
    .option('--start', 'Start a new replay session')
    .option('--since <time>', 'Replay events since (required with --start)')
    .option('--until <time>', 'Replay events until')
    .option('--types <types>', 'Comma-separated event types to replay')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--speed <n>', 'Speed multiplier', (v) => Number.parseFloat(v))
    .option('--dry-run', "Dry run (don't actually process)")
    .option('--status <id>', 'Get status of a replay session')
    .option('--cancel <id>', 'Cancel a replay session')
    .action(async (options: ReplayOptions) => {
      const client = getClient();

      try {
        if (options.cancel) {
          await cancelReplay(client, options.cancel);
        } else if (options.status) {
          await getReplayStatus(client, options.status);
        } else if (options.start) {
          await startReplay(client, options);
        } else {
          await listReplays(client);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        output.error(`Failed to manage replay: ${message}`);
      }
    });

  return events;
}
