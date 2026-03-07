/**
 * Inbox Bridge Plugin
 *
 * Internal API plugin that polls Claude Code team inboxes and forwards replies
 * back to the originating channel via the channel registry (no HTTP round-trip).
 *
 * - Discovers genie providers from DB every 60s to build agentName set
 * - Polls ~/.claude/teams/{team}/inboxes/{agentName}.json every 2s
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

interface BridgeState {
  cursors: Record<string, { lastIndex: number }>;
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

// ============================================================================
// Agent discovery
// ============================================================================

async function discoverAgentNames(services: Services): Promise<Set<string>> {
  const providers = await services.providers.list({ active: true });
  const names = new Set<string>();

  for (const provider of providers) {
    if (provider.schema !== 'genie') continue;
    const config =
      typeof provider.schemaConfig === 'object' && provider.schemaConfig !== null
        ? (provider.schemaConfig as Record<string, unknown>)
        : {};
    const agentName = typeof config.agentName === 'string' ? config.agentName.replace(/[^a-zA-Z0-9_-]/g, '') : null;
    if (agentName) names.add(agentName);
  }

  return names;
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

/** Send one inbox message to the appropriate channel plugin. Returns 'retry' on exception. */
async function sendInboxMessage(
  msg: InboxMessage,
  agentName: string,
  team: string,
  channelRegistry: ChannelRegistry,
): Promise<'ok' | 'retry'> {
  // Skip messages from the agent itself (echo prevention)
  if (msg.from === agentName) return 'ok';

  const parsed = parseMetadata(msg.text);

  if (!parsed.instance || !parsed.chat || !parsed.channel) {
    log.debug('Skipping message — missing routing metadata', { team, agentName, from: msg.from });
    return 'ok';
  }

  if (!parsed.cleanText) return 'ok';

  const plugin = channelRegistry.get(parsed.channel as Parameters<typeof channelRegistry.get>[0]);
  if (!plugin) {
    log.warn('Channel plugin not found', { channel: parsed.channel, team, agentName });
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
        agentName,
        channel: parsed.channel,
        instance: parsed.instance,
        chat: parsed.chat,
        thread: parsed.thread,
        messageId: result.messageId,
      });
    } else {
      log.error('sendMessage failed', { team, agentName, channel: parsed.channel, error: result.error });
    }
    // sendMessage returned false (not a throw): advance cursor anyway to avoid an infinite
    // retry loop on persistently failing channels. The error is logged above.
    return 'ok';
  } catch (err) {
    log.error('sendMessage threw', { team, agentName, error: String(err) });
    return 'retry'; // Don't advance cursor — retry on next poll
  }
}

/**
 * Process one inbox file. Mutates state.cursors and returns true if state changed.
 * On first encounter, initializes cursor to current inbox length (skips history).
 */
async function processInbox(
  agentName: string,
  team: string,
  state: BridgeState,
  channelRegistry: ChannelRegistry,
): Promise<boolean> {
  const inboxPath = join(CLAUDE_TEAMS_DIR, team, 'inboxes', `${agentName}.json`);
  const cursorKey = `${team}/${agentName}`;

  let inbox: InboxMessage[];
  try {
    const raw = await readFile(inboxPath, 'utf-8');
    inbox = JSON.parse(raw);
    if (!Array.isArray(inbox)) return false;
  } catch {
    return false; // File doesn't exist or invalid — skip
  }

  // First time seeing this inbox: set cursor to current length (skip history)
  if (!(cursorKey in state.cursors)) {
    state.cursors[cursorKey] = { lastIndex: inbox.length };
    return true;
  }

  const { lastIndex } = state.cursors[cursorKey] ?? { lastIndex: 0 };
  if (lastIndex >= inbox.length) return false; // No new messages

  let processed = 0;
  for (const msg of inbox.slice(lastIndex)) {
    const sendResult = await sendInboxMessage(msg, agentName, team, channelRegistry);
    if (sendResult === 'retry') break; // Don't advance cursor — retry on next poll
    processed++;
  }

  if (processed > 0) {
    state.cursors[cursorKey] = { lastIndex: lastIndex + processed };
    return true;
  }

  return false;
}

async function pollInboxes(agentNames: Set<string>, channelRegistry: ChannelRegistry): Promise<void> {
  if (agentNames.size === 0) return;

  const teams = await listTeams();
  if (teams.length === 0) return;

  const state = await loadState();
  let stateChanged = false;

  for (const agentName of agentNames) {
    for (const team of teams) {
      if (await processInbox(agentName, team, state, channelRegistry)) {
        stateChanged = true;
      }
    }
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
  let agentNames: Set<string> = new Set();

  // Initial discovery
  try {
    agentNames = await discoverAgentNames(services);
    log.info('Inbox bridge started', { agents: [...agentNames] });
  } catch (err) {
    log.warn('Initial agent discovery failed', { error: String(err) });
  }

  // Discovery refresh timer
  const discoveryTimer = setInterval(async () => {
    try {
      agentNames = await discoverAgentNames(services);
      log.debug('Agent names refreshed', { agents: [...agentNames] });
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
      await pollInboxes(agentNames, channelRegistry);
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
