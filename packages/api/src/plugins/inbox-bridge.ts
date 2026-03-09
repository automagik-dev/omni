/**
 * Inbox Bridge Plugin
 *
 * Internal API plugin that polls Claude Code team inboxes and forwards replies
 * back to the originating channel via the channel registry (no HTTP round-trip).
 *
 * - Discovers genie providers from DB every 60s to build agent name patterns
 * - For static names: polls ~/.claude/teams/{team}/inboxes/{agentName}.json
 * - For templated names: scans inboxes/ directory for matching files
 * - Uses cursor file (~/.claude/bridge/state.json) to track lastIndex per inbox
 * - Sends via channelRegistry.get(channel) -> plugin.sendMessage() directly
 * - Never writes to the inbox files (read-only)
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ChannelRegistry, OutgoingMessage } from '@omni/channel-sdk';
import { createLogger } from '@omni/core';
import type { Services } from '../services';

const log = createLogger('inbox-bridge');

const CLAUDE_TEAMS_DIR = join(homedir(), '.claude', 'teams');
const BRIDGE_STATE_PATH = join(homedir(), '.claude', 'bridge', 'state.json');
const POLL_INTERVAL_MS = 2_000;
const DISCOVERY_INTERVAL_MS = 60_000;
/** Prune cursor entries older than 24h for dynamic inboxes that no longer exist */
const CURSOR_TTL_MS = 24 * 60 * 60 * 1_000;

// ============================================================================
// Types
// ============================================================================

interface InboxMessage {
  from: string;
  text: string;
  summary: string;
  timestamp: string;
  read: boolean;
}

interface ParsedMetadata {
  instance?: string;
  chat?: string;
  msg?: string;
  replyTo?: string;
  from?: string;
  channel?: string;
  type?: string;
  thread?: string;
  cleanText: string;
}

interface CursorEntry {
  lastIndex: number;
  /** Timestamp of last successful read (for TTL-based pruning) */
  lastSeen?: number;
}

interface BridgeState {
  cursors: Record<string, CursorEntry>;
}

/**
 * An agent name pattern — either a static exact name or a template pattern
 * that matches multiple dynamic inbox files.
 */
interface AgentPattern {
  /** The raw config value (e.g. "omni" or "omni-{thread_id}") */
  raw: string;
  /** Whether the pattern contains template variables */
  isTemplate: boolean;
  /**
   * For static names: the sanitized exact name (e.g. "omni")
   * For templates: the static prefix before the first variable (e.g. "omni-")
   */
  prefix: string;
}

// ============================================================================
// Metadata parsing (reused from original inbox-bridge.ts)
// ============================================================================

/** Apply a single parsed key-value pair to the metadata result */
function applyParsedKey(result: ParsedMetadata, key: string | undefined, value: string | undefined): void {
  if (!key || !value) return;
  if (key === 'instance') result.instance = value;
  else if (key === 'chat') result.chat = value;
  else if (key === 'msg') result.msg = value;
  else if (key === 'replyTo') result.replyTo = value;
  else if (key === 'from') result.from = value;
  else if (key === 'channel') result.channel = value;
  else if (key === 'type') result.type = value;
  else if (key === 'thread') result.thread = value;
}

/** Iterate key:value matches from a header string and apply them to result */
function applyHeaderPairs(result: ParsedMetadata, header: string, pattern: RegExp): void {
  for (const [, key, value] of header.matchAll(pattern)) {
    applyParsedKey(result, key, value);
  }
}

function parseMetadata(text: string): ParsedMetadata {
  const result: ParsedMetadata = { cleanText: text.trim() };

  // New format: single bracket with space-separated key:value pairs on first line
  const singleBracket = text.match(/^\[([^\]]+)\]\s*\n?([\s\S]*)$/);
  if (singleBracket) {
    applyHeaderPairs(result, singleBracket[1] ?? '', /(\w+):(\S+)/g);
    result.cleanText = (singleBracket[2] ?? '').trim();
    return result;
  }

  // Legacy format: multiple [key:value] tags at start
  const prefixMatch = text.match(/^(\[(\w+):([^\]]+)\]\s*)+/);
  if (prefixMatch) {
    applyHeaderPairs(result, prefixMatch[0], /\[(\w+):([^\]]+)\]/g);
    result.cleanText = text.slice(prefixMatch[0].length).trim();
  }

  return result;
}

// ============================================================================
// Agent pattern helpers
// ============================================================================

/** Sanitize a string for use in file paths — same logic as genie-client.ts */
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Extract the static prefix from a template string.
 * "omni-{thread_id}" → "omni-"
 * "{channel}-{thread_id}" → "" (empty — matches everything)
 * "omni" → "omni" (no template — exact match)
 */
function extractStaticPrefix(template: string): string {
  const firstBrace = template.indexOf('{');
  if (firstBrace === -1) return sanitize(template);
  // Sanitize only the portion before the first template variable
  return sanitize(template.substring(0, firstBrace));
}

/**
 * Build AgentPattern from a raw config value.
 */
function buildPattern(raw: string): AgentPattern {
  const isTemplate = /\{\w+\}/.test(raw);
  return {
    raw,
    isTemplate,
    prefix: isTemplate ? extractStaticPrefix(raw) : sanitize(raw),
  };
}

/** Check if a filename (without .json) matches any of the template prefixes */
function matchesAnyPrefix(baseName: string, prefixes: string[]): boolean {
  for (const prefix of prefixes) {
    // Empty prefix means the entire name is templated — match everything
    if (prefix === '' || baseName.startsWith(prefix)) return true;
  }
  return false;
}

/** Separate patterns into static names and template prefixes */
function partitionPatterns(patterns: AgentPattern[]): { staticNames: string[]; templatePrefixes: string[] } {
  const staticNames: string[] = [];
  const templatePrefixes: string[] = [];
  for (const pattern of patterns) {
    if (pattern.isTemplate) {
      templatePrefixes.push(pattern.prefix);
    } else if (pattern.prefix) {
      staticNames.push(pattern.prefix);
    }
  }
  return { staticNames, templatePrefixes };
}

/** Scan an inboxes directory for .json files matching any template prefix */
async function scanInboxDir(inboxDir: string, prefixes: string[]): Promise<string[]> {
  const matched: string[] = [];
  try {
    const entries = await readdir(inboxDir);
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.endsWith('.tmp') || entry.endsWith('.lock')) continue;
      const baseName = entry.slice(0, -5); // strip .json
      if (baseName && matchesAnyPrefix(baseName, prefixes)) {
        matched.push(baseName);
      }
    }
  } catch {
    // Directory doesn't exist yet — fine, no inboxes to poll
  }
  return matched;
}

/**
 * Given a set of patterns and an inboxes directory, resolve the actual inbox
 * file names we should poll. Static patterns produce exact names; template
 * patterns scan the directory and match by prefix.
 */
async function resolveInboxNames(patterns: AgentPattern[], inboxDir: string): Promise<string[]> {
  const { staticNames, templatePrefixes } = partitionPatterns(patterns);
  const names = new Set<string>(staticNames);

  if (templatePrefixes.length > 0) {
    const dynamicNames = await scanInboxDir(inboxDir, templatePrefixes);
    for (const name of dynamicNames) names.add(name);
  }

  return [...names];
}

// ============================================================================
// State management
// ============================================================================

async function loadState(): Promise<BridgeState> {
  try {
    const raw = await readFile(BRIDGE_STATE_PATH, 'utf-8');
    return JSON.parse(raw) as BridgeState;
  } catch {
    return { cursors: {} };
  }
}

async function saveState(state: BridgeState): Promise<void> {
  await mkdir(join(homedir(), '.claude', 'bridge'), { recursive: true });
  await writeFile(BRIDGE_STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Prune cursor entries that haven't been seen in CURSOR_TTL_MS.
 * Dynamic inboxes come and go — without pruning, state.json grows unbounded.
 */
function pruneStaleCursors(state: BridgeState): boolean {
  const now = Date.now();
  let pruned = false;
  for (const key of Object.keys(state.cursors)) {
    const entry = state.cursors[key];
    if (entry?.lastSeen && now - entry.lastSeen > CURSOR_TTL_MS) {
      delete state.cursors[key];
      pruned = true;
    }
  }
  return pruned;
}

// ============================================================================
// Agent discovery
// ============================================================================

/**
 * Discover agent patterns from active genie providers.
 * Returns patterns that may be static names or template patterns.
 */
async function discoverAgentPatterns(services: Services): Promise<AgentPattern[]> {
  const providers = await services.providers.list({ active: true });
  const patterns: AgentPattern[] = [];
  const seen = new Set<string>();

  for (const provider of providers) {
    if (provider.schema !== 'genie') continue;
    const config =
      typeof provider.schemaConfig === 'object' && provider.schemaConfig !== null
        ? (provider.schemaConfig as Record<string, unknown>)
        : {};
    const agentName = typeof config.agentName === 'string' ? config.agentName : null;
    if (!agentName || seen.has(agentName)) continue;
    seen.add(agentName);

    const pattern = buildPattern(agentName);
    // Skip patterns that resolve to empty prefix with no template
    // (e.g. someone stored agentName = "!!!" → sanitize → "")
    if (!pattern.isTemplate && !pattern.prefix) continue;
    patterns.push(pattern);
  }

  return patterns;
}

// ============================================================================
// Poll loop
// ============================================================================

async function listTeams(): Promise<string[]> {
  try {
    const entries = await readdir(CLAUDE_TEAMS_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * Check if a message sender matches any of the configured agent patterns.
 * Used for echo prevention — we skip messages that the agent itself sent.
 *
 * For static configs: msg.from === "omni" matches pattern prefix "omni"
 * For template configs: msg.from === "omni-123" matches pattern prefix "omni-"
 */
function isSelfMessage(from: string, inboxName: string, patterns: AgentPattern[]): boolean {
  // Direct match: the message sender is the inbox owner
  if (from === inboxName) return true;

  // Pattern match: sender matches any configured agent pattern
  for (const pattern of patterns) {
    if (pattern.isTemplate) {
      // For templates, the sender's name starts with the same prefix
      if (pattern.prefix === '' || from.startsWith(pattern.prefix)) return true;
    } else {
      if (from === pattern.prefix) return true;
    }
  }

  return false;
}

/** Send one inbox message to the appropriate channel plugin. Returns 'retry' on exception. */
async function sendInboxMessage(
  msg: InboxMessage,
  inboxName: string,
  team: string,
  channelRegistry: ChannelRegistry,
  patterns: AgentPattern[],
): Promise<'ok' | 'retry'> {
  // Skip messages from the agent itself (echo prevention)
  if (isSelfMessage(msg.from, inboxName, patterns)) return 'ok';

  const parsed = parseMetadata(msg.text);

  if (!parsed.instance || !parsed.chat || !parsed.channel) {
    log.debug('Skipping message — missing routing metadata', { team, inboxName, from: msg.from });
    return 'ok';
  }

  if (!parsed.cleanText) return 'ok';

  const plugin = channelRegistry.get(parsed.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    log.warn('Channel plugin not found', { channel: parsed.channel, team, inboxName });
    return 'ok';
  }

  const outgoing: OutgoingMessage = {
    to: parsed.chat,
    threadId: parsed.thread,
    replyTo: parsed.replyTo,
    content: { type: 'text', text: parsed.cleanText },
  };

  try {
    const result = await plugin.sendMessage(parsed.instance, outgoing);
    if (result.success) {
      log.info('Forwarded reply', {
        team,
        inboxName,
        channel: parsed.channel,
        instance: parsed.instance,
        chat: parsed.chat,
        thread: parsed.thread,
        messageId: result.messageId,
      });
    } else {
      log.error('sendMessage failed', { team, inboxName, channel: parsed.channel, error: result.error });
    }
    // sendMessage returned false (not a throw): advance cursor anyway to avoid an infinite
    // retry loop on persistently failing channels. The error is logged above.
    return 'ok';
  } catch (err) {
    log.error('sendMessage threw', { team, inboxName, error: String(err) });
    return 'retry'; // Don't advance cursor — retry on next poll
  }
}

/**
 * Process one inbox file. Mutates state.cursors and returns true if state changed.
 * On first encounter, initializes cursor to current inbox length (skips history).
 */
async function processInbox(
  inboxName: string,
  team: string,
  state: BridgeState,
  channelRegistry: ChannelRegistry,
  patterns: AgentPattern[],
): Promise<boolean> {
  const inboxPath = join(CLAUDE_TEAMS_DIR, team, 'inboxes', `${inboxName}.json`);
  const cursorKey = `${team}/${inboxName}`;

  let inbox: InboxMessage[];
  try {
    const raw = await readFile(inboxPath, 'utf-8');
    inbox = JSON.parse(raw);
    if (!Array.isArray(inbox)) return false;
  } catch {
    return false; // File doesn't exist or invalid — skip
  }

  const now = Date.now();

  // First time seeing this inbox: set cursor to current length (skip history)
  if (!(cursorKey in state.cursors)) {
    state.cursors[cursorKey] = { lastIndex: inbox.length, lastSeen: now };
    return true;
  }

  const entry = state.cursors[cursorKey] ?? { lastIndex: 0 };
  let { lastIndex } = entry;

  // Edge case: inbox was truncated/rotated — reset cursor to avoid being stuck forever
  if (lastIndex > inbox.length) {
    log.warn('Inbox shrank (truncated/rotated), resetting cursor', {
      team,
      inboxName,
      oldCursor: lastIndex,
      newLength: inbox.length,
    });
    lastIndex = 0;
  }

  if (lastIndex >= inbox.length) {
    // No new messages, but update lastSeen for TTL tracking
    state.cursors[cursorKey] = { lastIndex, lastSeen: now };
    return false;
  }

  let processed = 0;
  for (const msg of inbox.slice(lastIndex)) {
    const sendResult = await sendInboxMessage(msg, inboxName, team, channelRegistry, patterns);
    if (sendResult === 'retry') break; // Don't advance cursor — retry on next poll
    processed++;
  }

  if (processed > 0) {
    state.cursors[cursorKey] = { lastIndex: lastIndex + processed, lastSeen: now };
    return true;
  }

  return false;
}

async function pollInboxes(patterns: AgentPattern[], channelRegistry: ChannelRegistry): Promise<void> {
  if (patterns.length === 0) return;

  const teams = await listTeams();
  if (teams.length === 0) return;

  const state = await loadState();
  let stateChanged = false;

  for (const team of teams) {
    const inboxDir = join(CLAUDE_TEAMS_DIR, team, 'inboxes');
    // Resolve dynamic inbox names by scanning the directory for template patterns
    const inboxNames = await resolveInboxNames(patterns, inboxDir);

    for (const inboxName of inboxNames) {
      if (await processInbox(inboxName, team, state, channelRegistry, patterns)) {
        stateChanged = true;
      }
    }
  }

  // Periodically prune stale cursor entries from deleted dynamic inboxes
  if (pruneStaleCursors(state)) {
    stateChanged = true;
  }

  if (stateChanged) {
    await saveState(state);
  }
}

// ============================================================================
// Setup
// ============================================================================

export async function setupInboxBridge(
  services: Services,
  channelRegistry: ChannelRegistry,
): Promise<() => Promise<void>> {
  let patterns: AgentPattern[] = [];

  // Initial discovery
  try {
    patterns = await discoverAgentPatterns(services);
    log.info('Inbox bridge started', {
      patterns: patterns.map((p) => ({ raw: p.raw, isTemplate: p.isTemplate, prefix: p.prefix })),
    });
  } catch (err) {
    log.warn('Initial agent discovery failed', { error: String(err) });
  }

  // Discovery refresh timer
  const discoveryTimer = setInterval(async () => {
    try {
      patterns = await discoverAgentPatterns(services);
      log.debug('Agent patterns refreshed', {
        patterns: patterns.map((p) => ({ raw: p.raw, isTemplate: p.isTemplate, prefix: p.prefix })),
      });
    } catch (err) {
      log.warn('Agent discovery refresh failed', { error: String(err) });
    }
  }, DISCOVERY_INTERVAL_MS);
  discoveryTimer.unref();

  // Poll timer
  let polling = false;
  const pollTimer = setInterval(async () => {
    if (polling) return;
    polling = true;
    try {
      await pollInboxes(patterns, channelRegistry);
    } catch (err) {
      log.error('Poll cycle error', { error: String(err) });
    } finally {
      polling = false;
    }
  }, POLL_INTERVAL_MS);
  pollTimer.unref();

  return async () => {
    clearInterval(discoveryTimer);
    clearInterval(pollTimer);
    log.info('Inbox bridge stopped');
  };
}
