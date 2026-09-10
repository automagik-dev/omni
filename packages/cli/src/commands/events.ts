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
import { type AutomationCondition, evaluateConditions } from '@omni/core';
import type { Event, OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { z } from 'zod';
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

export { schemaApiRequest };
export const __testables = { schemaApiRequest, loadSchemaArtifact, summarizeSchemaRow };

/**
 * Table projection for list-shaped event commands. Human-readable output only:
 * JSON mode emits the raw API rows via `rawData` so `eventType` (and every
 * other field) survives intact (#1028).
 */
export function eventListRow(e: Event): {
  id: string;
  type: string;
  instanceId: string;
  direction: string;
  receivedAt: string;
} {
  return { id: e.id, type: e.eventType, instanceId: e.instanceId, direction: e.direction, receivedAt: e.receivedAt };
}

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

/**
 * Match an event type against a `--type` filter value (#966). A trailing `*`
 * makes the filter a prefix glob (`custom.*` matches every custom event);
 * anything else is an exact match. Same contract as the API-side list filter
 * (EventService.list) — keep the two in sync.
 */
export function matchesEventTypeFilter(eventType: string, filter: string): boolean {
  return filter.endsWith('*') ? eventType.startsWith(filter.slice(0, -1)) : eventType === filter;
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
  if (options.type && !matchesEventTypeFilter(event.eventType, options.type)) return false;
  if (options.chatId && event.chatUuid !== options.chatId) return false;
  if (options.personId && event.personId !== options.personId) return false;
  if (options.errorsOnly && !isErrorEvent(event.eventType)) return false;
  if (!options.all && isNoisyEvent(event.eventType)) return false;
  return true;
}

/**
 * The journal row as GET /events actually returns it (full omni_events row —
 * the SDK `Event` type is a projection). `stream` reads the raw platform
 * chat id (#1036 ask 3) and sender hints out of the extra columns.
 */
export type StreamEventRow = Event & {
  chatId?: string | null;
  metadata?: { from?: string } | null;
  rawPayload?: { pushName?: string; key?: { fromMe?: boolean } } | null;
};

/** id → display name lookups for `stream` (null = looked up, nothing found). */
export interface StreamNames {
  instances: Map<string, string | null>;
  chats: Map<string, string | null>;
  persons: Map<string, string | null>;
}

export interface FormatLineOptions {
  /** Add sender / fromMe / contentType columns (#1036 ask 1). */
  verbose?: boolean;
  /** Print raw uuid8 ids even when a name is known (#1036 ask 2, `--ids`). */
  ids?: boolean;
  names?: StreamNames;
}

function labelFor(id: string | null | undefined, names: Map<string, string | null> | undefined, ids: boolean): string {
  if (!id) return '';
  const name = ids ? undefined : names?.get(id);
  return name ? name.slice(0, 16) : id.slice(0, 8);
}

/** Sender label: resolved person name, then channel push name, then raw `from`. */
export function senderLabel(event: StreamEventRow, names?: StreamNames): string {
  const person = event.personId ? names?.persons.get(event.personId) : undefined;
  return person ?? event.rawPayload?.pushName ?? event.metadata?.from ?? '';
}

/** Format an event as a single human-readable line. */
export function formatEventLine(event: StreamEventRow, options: FormatLineOptions = {}): string {
  const ids = options.ids === true;
  const time = new Date(event.receivedAt).toISOString().slice(11, 19);
  const instance = labelFor(event.instanceId, options.names?.instances, ids) || '--------';
  // Unlinked chats (chatUuid null) fall back to the raw platform chat id.
  const chat = labelFor(event.chatUuid, options.names?.chats, ids) || event.chatId || '--------';
  const summary = event.textContent ?? event.transcription ?? event.imageDescription ?? '';
  const trimmed = summary.length > 80 ? `${summary.slice(0, 77)}...` : summary;
  const cols = [time, event.eventType.padEnd(28), `${instance}/${chat}`, event.direction.padEnd(8)];
  if (options.verbose) {
    const fromMe = event.rawPayload?.key?.fromMe === true || event.direction === 'outbound';
    cols.push(fromMe ? 'me' : '  ', (event.contentType ?? '-').padEnd(8), senderLabel(event, options.names).padEnd(16));
  }
  return `${cols.join('  ')}  ${trimmed}`.trimEnd();
}

/**
 * Fill the name caches for every id in the batch that has not been looked up
 * yet. Instances load once as a list; chats/persons are fetched per id and
 * misses are cached as null so a dead id costs one request, not one per poll.
 */
async function warmStreamNames(client: OmniClient, names: StreamNames, events: StreamEventRow[]): Promise<void> {
  const lookup = async (map: Map<string, string | null>, id: string, fetch: () => Promise<string | null>) => {
    if (map.has(id)) return;
    map.set(id, await fetch().catch(() => null));
  };
  if (names.instances.size === 0 && events.length > 0) {
    const list = await client.instances.list({ limit: 100 }).catch(() => ({ items: [] }));
    for (const i of list.items) names.instances.set(i.id, i.name);
  }
  for (const ev of events) {
    if (ev.chatUuid) {
      await lookup(names.chats, ev.chatUuid, async () => (await client.chats.get(ev.chatUuid as string)).name ?? null);
    }
    if (ev.personId) {
      await lookup(
        names.persons,
        ev.personId,
        async () => (await client.persons.get(ev.personId as string)).displayName,
      );
    }
  }
}

/** Emit an event through the drain-safe stdout helper — never raw console.log. */
function emitStreamEvent(event: StreamEventRow, ndjson: boolean, format: FormatLineOptions): void {
  if (ndjson) {
    output.raw(JSON.stringify(event));
  } else {
    output.raw(formatEventLine(event, format));
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
  verbose?: boolean;
  ids?: boolean;
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

async function processStreamBatch(
  client: OmniClient,
  items: StreamEventRow[],
  filters: StreamFilterOptions,
  state: StreamState,
  ndjson: boolean,
  format: FormatLineOptions,
): Promise<void> {
  const ascending = [...items].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const fresh = ascending.filter((ev) => !state.seen.has(ev.id) && passesStreamFilters(ev, filters));
  if (!ndjson && !format.ids && format.names) await warmStreamNames(client, format.names, fresh);
  for (const ev of ascending) {
    if (state.seen.has(ev.id)) continue;
    state.seen.add(ev.id);
    if (!passesStreamFilters(ev, filters)) continue;
    emitStreamEvent(ev, ndjson, format);
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
  const format: FormatLineOptions = {
    verbose: options.verbose,
    ids: options.ids,
    names: { instances: new Map(), chats: new Map(), persons: new Map() },
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
      await processStreamBatch(client, items, filters, state, ndjson, format);
      if (stopped) break;
      await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
    }
  } finally {
    processEvents.off('SIGINT', shutdown);
    processEvents.off('SIGTERM', shutdown);
    await output.flushStdout();
  }
}

// ============================================================================
// WAIT (issue #966)
// ============================================================================

/**
 * The journal row as the API actually returns it: the generated SDK `Event`
 * type is a projection, but GET /events returns full omni_events rows —
 * including rawPayload, which is where the `custom.>` journal subscriber puts
 * the published payload. `wait --filter` matches against those top-level
 * payload fields.
 */
type WaitEventRow = Event & { rawPayload?: Record<string, unknown> | null };

/** `--filter` entries must look like key=value (dot paths allowed on the key). */
const WaitFilterEntrySchema = z
  .string()
  .regex(/^[^=\s]+=/, 'each --filter must look like key=value (dot paths allowed, e.g. --filter user.id=42)');

/** Validated `omni events wait` inputs (Zod on external input, repo contract). */
const WaitOptionsSchema = z.object({
  timeout: z.coerce.number().positive().max(86400).optional(),
  pollMs: z.coerce.number().int().min(250).max(60000).default(2000),
  filter: z.array(WaitFilterEntrySchema).default([]),
});

/**
 * Turn `--filter k=v` entries into automation trigger conditions — the SAME
 * matcher automations use (`evaluateConditions`, @omni/core), per the issue's
 * contract. Values parse as JSON when valid (`count=5` → number 5,
 * `ok=true` → boolean) and fall back to the raw string (`status=open`).
 */
export function parseWaitFilters(entries: string[]): AutomationCondition[] {
  return entries.map((entry) => {
    const idx = entry.indexOf('=');
    const raw = entry.slice(idx + 1);
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    return { field: entry.slice(0, idx), operator: 'eq', value };
  });
}

interface WaitParams {
  filters: StreamFilterOptions;
  conditions: AutomationCondition[];
  sinceIso: string;
  pollMs: number;
  /** Absent = wait forever (until the process is interrupted). */
  timeoutMs?: number;
}

/** True when the row passes the envelope filters AND the payload conditions. */
export function matchesWaitEvent(
  event: WaitEventRow,
  filters: StreamFilterOptions,
  conditions: AutomationCondition[],
): boolean {
  if (!passesStreamFilters(event, filters)) return false;
  return evaluateConditions(conditions, event.rawPayload ?? {});
}

/**
 * One-shot blocking subscription (#966): poll the same list endpoint
 * `omni events stream` uses (`fetchStreamBatch`) and resolve with the FIRST
 * matching event, or null once the deadline passes. DB polling is the
 * accepted transport (the issue's non-goal keeps SSE/WS out of scope).
 */
export async function waitForEvent(client: OmniClient, params: WaitParams): Promise<WaitEventRow | null> {
  const deadline = params.timeoutMs === undefined ? undefined : Date.now() + params.timeoutMs;
  const state: StreamState = { sinceIso: params.sinceIso, seen: new Set<string>() };

  for (;;) {
    const items = await fetchStreamBatch(
      client,
      params.filters,
      params.filters.channel,
      params.filters.type,
      state.sinceIso,
    );
    const ascending = [...items].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
    for (const ev of ascending) {
      if (state.seen.has(ev.id)) continue;
      state.seen.add(ev.id);
      if (ev.receivedAt > state.sinceIso) state.sinceIso = ev.receivedAt;
      if (matchesWaitEvent(ev, params.filters, params.conditions)) return ev;
    }
    // Same dedupe-set bound as processStreamBatch — an open-ended wait must
    // not grow memory with every observed-but-unmatched event.
    if (state.seen.size > 5000 && items.length > 0) {
      state.seen = new Set(items.map((ev) => ev.id));
    }
    const remaining = deadline === undefined ? params.pollMs : deadline - Date.now();
    if (remaining <= 0) return null;
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(params.pollMs, remaining)));
  }
}

// ============================================================================
// DURABLE CONSUMERS (issue #989, RFC #925 G7)
// ============================================================================

/** A durable consumer as the API returns it (registration + live lag). */
interface ConsumerData {
  id: string;
  name: string;
  eventType: string;
  filters: AutomationCondition[] | null;
  cursor: number;
  head: number;
  lag: number;
  createdAt: string;
  updatedAt: string;
}

/** One `pull` page: matching rows + the scanned-cursor to ack. */
interface ConsumerPullPage {
  consumer: string;
  items: WaitEventRow[];
  cursor: number;
  head: number;
  hasMore: boolean;
}

/**
 * Raw CLI→API call for the consumer endpoints — the generated SDK does not
 * cover them yet (`schemaApiRequest` precedent; the CLI only ever talks to
 * the API, never the database).
 */
export async function consumersApiRequest<T>(path: string, init: { method?: string; body?: string } = {}): Promise<T> {
  const config = loadConfig();
  const baseUrl = config.apiUrl ?? 'http://localhost:8882';

  const resp = await fetch(`${baseUrl}/api/v2/events/consumers${path}`, {
    method: init.method ?? 'GET',
    body: init.body,
    headers: { 'content-type': 'application/json', 'x-api-key': config.apiKey ?? '' },
  });

  if (!resp.ok) {
    throw new Error(`API returned ${resp.status}: ${await resp.text()}`);
  }

  return (await resp.json()) as T;
}

export function summarizeConsumerRow(row: ConsumerData): Record<string, unknown> {
  return {
    name: row.name,
    eventType: row.eventType,
    filters: row.filters?.length
      ? row.filters.map((f) => `${f.field} ${f.operator} ${JSON.stringify(f.value)}`).join(' AND ')
      : '-',
    cursor: row.cursor,
    lag: row.lag,
    updatedAt: row.updatedAt,
  };
}

export interface FollowParams {
  consumer: string;
  /** Max rows scanned per pull page. */
  limit: number;
  /** Server-side long-poll window per pull when the journal is idle. */
  waitMs: number;
  /** Advance the cursor as pages are printed (default). false = peek one page, exit. */
  ack: boolean;
  /** Exit 0 once caught up (no new rows scanned) instead of tailing forever. */
  untilIdle: boolean;
  /** External stop signal (SIGINT). */
  isStopped?: () => boolean;
  /** Line sink — defaults to output.raw (stdout). Injected by tests. */
  emit?: (line: string) => void;
  /** Consecutive transport failures tolerated before giving up (default 5). */
  maxRetries?: number;
  /** First backoff delay; doubles per retry up to 30s (default 1000). */
  retryBaseMs?: number;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** HTTP-level failures (4xx/5xx) are surfaced by consumersApiRequest as "API returned N"; everything else is transport. */
const isTransportError = (err: unknown): boolean => !(err instanceof Error && err.message.startsWith('API returned '));

/**
 * Pull one page, reconnecting with exponential backoff when the long-poll
 * socket drops (issue #1029). Safe to retry: the stored cursor only moves on
 * ack, so a re-pull replays the same page at worst.
 */
async function pullWithRetry(params: FollowParams): Promise<ConsumerPullPage> {
  const maxRetries = params.maxRetries ?? 5;
  const baseMs = params.retryBaseMs ?? 1000;
  const path = `/${encodeURIComponent(params.consumer)}/pull?limit=${params.limit}&waitMs=${params.waitMs}`;
  for (let attempt = 0; ; attempt++) {
    try {
      return await consumersApiRequest<ConsumerPullPage>(path, { method: 'POST' });
    } catch (err) {
      if (!isTransportError(err) || attempt >= maxRetries || params.isStopped?.()) throw err;
      const delay = Math.min(baseMs * 2 ** attempt, 30000);
      process.stderr.write(
        `⚠ Pull failed (${errorMessage(err)}); reconnecting in ${delay}ms (${attempt + 1}/${maxRetries})\n`,
      );
      await sleep(delay);
    }
  }
}

/**
 * The `omni events follow` loop: pull a page from the stored cursor, print
 * each event as a JSON line, ack the SCANNED cursor (so filtered-out rows are
 * skipped too), repeat. Resumes exactly-after-cursor across restarts because
 * progress lives server-side.
 *
 * With `ack: false` the stored cursor never moves, so a loop would replay the
 * same page forever — peek mode prints ONE page and returns.
 */
export async function followConsumer(params: FollowParams): Promise<void> {
  const emit = params.emit ?? output.raw;
  // Locally tracked last-acked cursor: -1 = "unknown" (before the first pull).
  let acked = -1;
  for (;;) {
    if (params.isStopped?.()) return;

    const page = await pullWithRetry(params);

    for (const item of page.items) {
      emit(JSON.stringify(item));
    }

    if (!params.ack) {
      await output.flushStdout();
      return; // peek mode: one page, cursor untouched
    }

    if (page.cursor > acked) {
      // Ack the SCANNED cursor: it also skips rows the payload conditions
      // rejected, so a sparse filter never re-scans. An ack equal to the
      // stored cursor is an idempotent no-op server-side (first iteration).
      await consumersApiRequest(`/${encodeURIComponent(params.consumer)}/ack`, {
        method: 'POST',
        body: JSON.stringify({ cursor: page.cursor }),
      });
    }

    // Progress = anything printed, a full page (more waiting), or a cursor
    // bump past filtered-out rows. `acked >= 0` excludes the first
    // iteration's baseline, which is a position, not progress.
    const progressed = page.items.length > 0 || page.hasMore || (acked >= 0 && page.cursor > acked);
    acked = Math.max(acked, page.cursor);

    if (params.untilIdle && !progressed && !page.hasMore) {
      await output.flushStdout();
      return;
    }
    // Idle pacing floor: the server long-poll (waitMs) is the primary pause,
    // but a short window must not turn an idle tail into a tight loop.
    if (!progressed && params.waitMs < 1000) {
      await sleep(1000);
    }
  }
}

function createConsumersCommand(): Command {
  const consumers = new Command('consumers').description(
    'Manage durable event consumers (named cursors over the event journal)',
  );

  consumers
    .command('create <name>')
    .description('Register a durable consumer')
    .requiredOption('--type <type>', 'Event type filter (trailing * = prefix glob, e.g. custom.github.*)')
    .option(
      '--filter <k=v>',
      'Payload condition, repeatable (dot paths + JSON values — same matcher as events wait)',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option('--from-beginning', 'Start the cursor at 0 (replay the full journal) instead of the current head')
    .action(async (name: string, options: { type: string; filter: string[]; fromBeginning?: boolean }) => {
      try {
        const filters = parseWaitFilters(WaitOptionsSchema.shape.filter.parse(options.filter));
        const result = await consumersApiRequest<{ data: ConsumerData }>('', {
          method: 'POST',
          body: JSON.stringify({
            name,
            eventType: options.type,
            filters: filters.length ? filters : undefined,
            startFrom: options.fromBeginning ? 'beginning' : undefined,
          }),
        });
        output.success(`Consumer registered: ${result.data.name} (cursor ${result.data.cursor})`, {
          name: result.data.name,
          eventType: result.data.eventType,
          cursor: result.data.cursor,
          lag: result.data.lag,
        });
      } catch (err) {
        output.error(`Failed to create consumer: ${errorMessage(err)}`);
      }
    });

  consumers
    .command('ls')
    .description('List durable consumers with their cursor and lag')
    .action(async () => {
      try {
        const result = await consumersApiRequest<{ items: ConsumerData[] }>('');
        output.list(result.items.map(summarizeConsumerRow), { emptyMessage: 'No durable consumers registered.' });
      } catch (err) {
        output.error(`Failed to list consumers: ${errorMessage(err)}`);
      }
    });

  consumers
    .command('inspect <name>')
    .description('Show one consumer: filter, cursor, journal head, lag')
    .action(async (name: string) => {
      try {
        const result = await consumersApiRequest<{ data: ConsumerData }>(`/${encodeURIComponent(name)}`);
        output.data(result.data);
      } catch (err) {
        output.error(`Failed to inspect consumer: ${errorMessage(err)}`);
      }
    });

  consumers
    .command('rm <name>')
    .description('Delete a consumer registration (the journal itself is untouched)')
    .action(async (name: string) => {
      try {
        await consumersApiRequest(`/${encodeURIComponent(name)}`, { method: 'DELETE' });
        output.success(`Consumer removed: ${name}`);
      } catch (err) {
        output.error(`Failed to remove consumer: ${errorMessage(err)}`);
      }
    });

  return consumers;
}

function errorMessage(err: unknown): string {
  if (err instanceof z.ZodError) return err.issues.map((i) => i.message).join('; ');
  return err instanceof Error ? err.message : 'Unknown error';
}

export function createEventsCommand(): Command {
  const events = new Command('events').description('Query events');

  // omni events schema register|list|get (issue #959)
  events.addCommand(createSchemaCommand());

  // omni events consumers create|ls|inspect|rm (issue #989)
  events.addCommand(createConsumersCommand());

  // omni events list
  events
    .command('list')
    .description('List events')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--channel <type>', 'Filter by channel type')
    .option('--type <type>', 'Filter by event type (trailing * = prefix glob, e.g. custom.*)')
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

          output.list(result.items.map(eventListRow), { emptyMessage: 'No events found.', rawData: result.items });
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
    .option('--type <type>', 'Filter by event type (trailing * = prefix glob, e.g. custom.*)')
    .option('--chat-id <id>', 'Filter by chat ID')
    .option('--person-id <id>', 'Filter by person ID')
    .option('--since <time>', 'Start cursor (e.g., 5min, 24h, 7d, or ISO timestamp)')
    .option('--errors-only', 'Show only error/failure events')
    .option('--all', 'Include noisy event types (presence, delivered, read, progress)')
    .option('--ndjson', 'Emit JSON Lines (one event per line) — same as global --json in stream mode')
    .option('-v, --verbose', 'Add sender, fromMe marker and contentType columns')
    .option('--ids', 'Print raw ids instead of resolved instance/chat names')
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
        verbose?: boolean;
        ids?: boolean;
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

  // omni events wait (issue #966) — one-shot blocking subscription
  events
    .command('wait')
    .description('Block until the first matching event, print it as JSON, exit 0. Exits non-zero on --timeout.')
    .option('--instance <id>', 'Filter by instance ID')
    .option('--channel <type>', 'Filter by channel type')
    .option('--type <type>', 'Filter by event type (trailing * = prefix glob, e.g. custom.*)')
    .option('--chat-id <id>', 'Filter by chat ID')
    .option('--person-id <id>', 'Filter by person ID')
    .option(
      '--filter <k=v>',
      'Payload condition, repeatable (dot paths + JSON values, e.g. --filter user.id=42 --filter status=open)',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option('--timeout <seconds>', 'Give up after N seconds: exit non-zero, nothing on stdout')
    .option('--since <time>', 'Start cursor (e.g., 5min, ISO timestamp; default: now)')
    .option('--poll-ms <n>', 'Polling interval in milliseconds', (v) => Number.parseInt(v, 10), 2000)
    .action(
      async (options: {
        instance?: string;
        channel?: string;
        type?: string;
        chatId?: string;
        personId?: string;
        filter: string[];
        timeout?: string;
        since?: string;
        pollMs?: number;
      }) => {
        const client = getClient();
        try {
          const parsed = WaitOptionsSchema.parse({
            timeout: options.timeout,
            pollMs: options.pollMs,
            filter: options.filter,
          });
          const instanceId = options.instance ? await resolveInstanceId(options.instance) : undefined;
          const chatId = options.chatId ? await resolveChatId(options.chatId) : undefined;

          const event = await waitForEvent(client, {
            // all: true — an explicit wait must also see "noisy" types
            // (message.delivered/read etc.) the stream hides by default.
            filters: {
              instanceId,
              channel: options.channel,
              type: options.type,
              chatId,
              personId: options.personId,
              all: true,
            },
            conditions: parseWaitFilters(parsed.filter),
            sinceIso: options.since ? parseSinceTime(options.since) : new Date().toISOString(),
            pollMs: parsed.pollMs,
            timeoutMs: parsed.timeout === undefined ? undefined : parsed.timeout * 1000,
          });

          if (event) {
            output.raw(JSON.stringify(event));
            await output.flushStdout();
            return;
          }
          output.error(`Timed out after ${parsed.timeout}s waiting for a matching event`);
        } catch (err) {
          const message =
            err instanceof z.ZodError
              ? err.issues.map((i) => i.message).join('; ')
              : err instanceof Error
                ? err.message
                : 'Unknown error';
          output.error(`Failed to wait for event: ${message}`);
        }
      },
    );

  // omni events follow (issue #989) — durable tail: resume from the consumer's cursor
  events
    .command('follow')
    .description(
      'Tail the journal through a durable consumer: resumes from its stored cursor, prints JSON lines, acks as it goes.',
    )
    .requiredOption('--consumer <name>', 'Durable consumer to follow (create with: omni events consumers create)')
    .option('--limit <n>', 'Max journal rows scanned per pull', (v) => Number.parseInt(v, 10), 100)
    .option(
      '--wait-ms <n>',
      'Server-side long-poll window per pull when idle (max 30000)',
      (v) => Number.parseInt(v, 10),
      10000,
    )
    .option('--no-ack', 'Peek: print one page without advancing the cursor, then exit')
    .option('--until-idle', 'Exit 0 once caught up with the journal instead of tailing forever')
    .option('--ndjson', 'Accepted for symmetry with `events stream` — follow always emits JSON Lines')
    .action(async (options: { consumer: string; limit: number; waitMs: number; ack: boolean; untilIdle?: boolean }) => {
      let stopped = false;
      const shutdown = (): void => {
        stopped = true;
      };
      const processEvents: EventEmitter = process;
      processEvents.on('SIGINT', shutdown);
      processEvents.on('SIGTERM', shutdown);
      try {
        await followConsumer({
          consumer: options.consumer,
          limit: Math.min(Math.max(options.limit, 1), 500),
          waitMs: Math.min(Math.max(options.waitMs, 0), 30000),
          ack: options.ack,
          untilIdle: options.untilIdle === true,
          isStopped: () => stopped,
        });
      } catch (err) {
        output.error(`Failed to follow consumer: ${errorMessage(err)}`);
        process.exitCode = 1;
      } finally {
        processEvents.off('SIGINT', shutdown);
        processEvents.off('SIGTERM', shutdown);
        await output.flushStdout();
      }
    });

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

        output.list(result.items.map(eventListRow), {
          emptyMessage: 'No matching events found.',
          rawData: result.items,
        });
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

        output.list(result.items.map(eventListRow), {
          emptyMessage: `No events found for person: ${personId}`,
          rawData: result.items,
        });
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
