/**
 * Inbox Bridge — watches omni-telegram inbox and forwards replies to Telegram via Omni API
 *
 * Polls ~/.claude/teams/<team>/inboxes/<agent>.json for unread messages,
 * parses single-bracket metadata header [channel:x instance:y chat:z msg:id from:name type:t],
 * sends via POST /api/v2/messages/send, then marks as read.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Config from env or defaults
const TEAM_NAME = process.env.BRIDGE_TEAM ?? 'genie';
const AGENT_NAME = process.env.BRIDGE_AGENT ?? 'omni-telegram';
const OMNI_API = process.env.OMNI_API_URL ?? 'http://localhost:8882';
const API_KEY = process.env.OMNI_API_KEY ?? '';
const POLL_MS = Number(process.env.BRIDGE_POLL_MS ?? '2000');

const inboxPath = join(homedir(), '.claude', 'teams', TEAM_NAME, 'inboxes', `${AGENT_NAME}.json`);

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
  cleanText: string;
}

/** Parse single-bracket metadata header from message text.
 *  New format: [channel:x instance:y chat:z msg:id from:name type:t]\nclean text
 *  Also supports legacy multi-tag format: [key:val] [key:val] text */
function parseMetadata(text: string): ParsedMetadata {
  const result: ParsedMetadata = { cleanText: text.trim() };

  // New format: single bracket with space-separated key:value pairs on first line
  const singleBracket = text.match(/^\[([^\]]+)\]\s*\n?([\s\S]*)$/);
  if (singleBracket) {
    const header = singleBracket[1];
    const rest = singleBracket[2];

    // Parse key:value pairs from header
    for (const [, key, value] of header.matchAll(/(\w+):(\S+)/g)) {
      if (key === 'instance') result.instance = value;
      else if (key === 'chat') result.chat = value;
      else if (key === 'msg') result.msg = value;
      else if (key === 'replyTo') result.replyTo = value;
      else if (key === 'from') result.from = value;
      else if (key === 'channel') result.channel = value;
      else if (key === 'type') result.type = value;
    }

    result.cleanText = rest.trim();
    return result;
  }

  // Legacy format: multiple [key:value] tags at start
  const prefixPattern = /^(\[(\w+):([^\]]+)\]\s*)+/;
  const prefixMatch = text.match(prefixPattern);
  if (prefixMatch) {
    const prefix = prefixMatch[0];
    for (const [, key, value] of prefix.matchAll(/\[(\w+):([^\]]+)\]/g)) {
      if (key === 'instance') result.instance = value;
      else if (key === 'chat') result.chat = value;
      else if (key === 'msg') result.msg = value;
      else if (key === 'from') result.from = value;
      else if (key === 'channel') result.channel = value;
    }
    result.cleanText = text.slice(prefix.length).trim();
  }

  return result;
}

/** Send message via Omni API */
async function sendToOmni(instanceId: string, chatId: string, text: string, replyTo?: string): Promise<boolean> {
  try {
    const body: Record<string, string> = { instanceId, to: chatId, text };
    if (replyTo) body.replyTo = replyTo;

    const res = await fetch(`${OMNI_API}/api/v2/messages/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error(`[bridge] Omni API error ${res.status}: ${err}`);
      return false;
    }

    const data = (await res.json()) as { data?: { messageId?: string } };
    console.log(`[bridge] Sent to ${chatId} via ${instanceId}: messageId=${data.data?.messageId}`);
    return true;
  } catch (err) {
    console.error('[bridge] Failed to send:', err);
    return false;
  }
}

/** Read inbox, process unread messages, mark as read */
async function poll(): Promise<void> {
  let inbox: InboxMessage[];
  try {
    const raw = await readFile(inboxPath, 'utf-8');
    inbox = JSON.parse(raw);
    if (!Array.isArray(inbox)) return;
  } catch {
    return; // File doesn't exist or invalid
  }

  let changed = false;

  for (const msg of inbox) {
    if (msg.read) continue;
    if (msg.from === AGENT_NAME) continue; // Skip messages FROM omni-telegram itself

    const parsed = parseMetadata(msg.text);

    if (!parsed.instance || !parsed.chat) {
      console.log(`[bridge] Skipping message from ${msg.from} — no instance/chat metadata`);
      msg.read = true;
      changed = true;
      continue;
    }

    if (!parsed.cleanText) {
      msg.read = true;
      changed = true;
      continue;
    }

    const sent = await sendToOmni(parsed.instance, parsed.chat, parsed.cleanText, parsed.replyTo);
    if (sent) {
      msg.read = true;
      changed = true;
    }
  }

  if (changed) {
    await writeFile(inboxPath, JSON.stringify(inbox, null, 2), 'utf-8');
  }
}

// Main loop
console.log('[bridge] Starting inbox bridge');
console.log(`[bridge] Inbox: ${inboxPath}`);
console.log(`[bridge] API: ${OMNI_API}`);
console.log(`[bridge] Poll interval: ${POLL_MS}ms`);

if (!API_KEY) {
  console.error('[bridge] OMNI_API_KEY is required!');
  process.exit(1);
}

setInterval(poll, POLL_MS);
poll(); // Run immediately
