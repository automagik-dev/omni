/**
 * Resource Resolution
 *
 * Resolves resource identifiers (full UUID, partial UUID prefix, name/title) to UUIDs.
 * Supports instances, chats, messages, persons, keys, automations, and batch jobs.
 */

import { getClient } from './client.js';
import * as output from './output.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolve an instance identifier to a UUID.
 *
 * Matches in order:
 *   1. Exact UUID match (skip API call)
 *   2. UUID prefix match (minimum 2 hex chars)
 *   3. Exact name match (case-insensitive)
 *   4. Name substring match (case-insensitive)
 *
 * Exits with error if no match or ambiguous.
 */
export async function resolveInstanceId(input: string): Promise<string> {
  if (UUID_RE.test(input)) return input;

  const client = getClient();
  const result = await client.instances.list({ limit: 100 });
  const instances = result.items;

  // Partial UUID prefix (at least 2 chars, looks hex-ish)
  if (/^[0-9a-f]{2,}$/i.test(input)) {
    const matches = instances.filter((i) => i.id.toLowerCase().startsWith(input.toLowerCase()));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const names = matches.map((i) => `  ${i.id.slice(0, 8)}  ${i.name}`).join('\n');
      output.error(`Ambiguous ID prefix "${input}" matches ${matches.length} instances:\n${names}`);
    }
  }

  // Exact name match (case-insensitive)
  const lower = input.toLowerCase();
  const exactName = instances.find((i) => i.name.toLowerCase() === lower);
  if (exactName) return exactName.id;

  // Name substring match
  const nameMatches = instances.filter((i) => i.name.toLowerCase().includes(lower));
  if (nameMatches.length === 1) return nameMatches[0].id;
  if (nameMatches.length > 1) {
    const names = nameMatches.map((i) => `  ${i.id.slice(0, 8)}  ${i.name}`).join('\n');
    output.error(`Ambiguous name "${input}" matches ${nameMatches.length} instances:\n${names}`);
  }

  output.error(`No instance found matching "${input}"`);
}

/**
 * Resolve a chat identifier to a UUID.
 *
 * Matches in order:
 *   1. Exact UUID match (skip API call)
 *   2. UUID prefix match (minimum 2 hex chars)
 *   3. Exact name match (case-insensitive)
 *   4. Name substring match (case-insensitive)
 *
 * Exits with error if no match or ambiguous.
 */
export async function resolveChatId(input: string): Promise<string> {
  if (UUID_RE.test(input)) return input;

  const client = getClient();
  const result = await client.chats.list({ limit: 100 });
  const chats = result.items;

  // Partial UUID prefix (at least 2 chars, looks hex-ish)
  if (/^[0-9a-f]{2,}$/i.test(input)) {
    const matches = chats.filter((c) => c.id.toLowerCase().startsWith(input.toLowerCase()));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const names = matches.map((c) => `  ${c.id.slice(0, 8)}  ${c.name || '(unnamed)'}`).join('\n');
      output.error(`Ambiguous ID prefix "${input}" matches ${matches.length} chats:\n${names}`);
    }
  }

  // Exact name match (case-insensitive)
  const lower = input.toLowerCase();
  const exactName = chats.find((c) => c.name?.toLowerCase() === lower);
  if (exactName) return exactName.id;

  // Name substring match
  const nameMatches = chats.filter((c) => c.name?.toLowerCase().includes(lower));
  if (nameMatches.length === 1) return nameMatches[0].id;
  if (nameMatches.length > 1) {
    const names = nameMatches.map((c) => `  ${c.id.slice(0, 8)}  ${c.name || '(unnamed)'}`).join('\n');
    output.error(`Ambiguous name "${input}" matches ${nameMatches.length} chats:\n${names}`);
  }

  output.error(`No chat found matching "${input}"`);
}

/**
 * Resolve a recipient identifier for the send command.
 *
 * If the input looks like a phone number (starts with '+' or all digits) or a JID
 * (contains '@'), it is passed through as-is — these are external identifiers.
 *
 * Otherwise, resolves as a chat identifier (full UUID, UUID prefix, name).
 * Exits with error if resolution fails.
 */
export async function resolveRecipient(input: string): Promise<string> {
  // Full UUID — pass through
  if (UUID_RE.test(input)) return input;

  // Phone number — pass through
  if (/^\+?\d{7,}$/.test(input)) return input;

  // JID or external ID — pass through
  if (input.includes('@')) return input;

  // Try to resolve as a chat identifier (short ID or name)
  return resolveChatId(input);
}

/**
 * Resolve a message identifier to a UUID.
 *
 * Messages don't have names, so this only resolves:
 *   1. Exact UUID match (skip API call)
 *   2. UUID prefix match (minimum 2 hex chars) - with chat context
 *
 * Note: Message list API requires chat context. Without it, we can only validate UUIDs.
 *
 * Exits with error if no match or ambiguous.
 */
export async function resolveMessageId(input: string, chatId?: string): Promise<string> {
  if (UUID_RE.test(input)) return input;

  const isHex = /^[0-9a-f]{2,}$/i.test(input);

  // Without chat context, we can only validate UUIDs
  if (!chatId) {
    if (isHex) {
      output.error(
        `Cannot resolve message ID prefix "${input}" without chat context. Provide full UUID or use --chat <id> option.`,
      );
    }
    output.error(`Invalid message ID: "${input}". Must be a valid UUID.`);
  }

  // With chat context and a hex string, try UUID prefix match first
  if (isHex) {
    let messages: Array<{ id: string }> = [];
    try {
      const client = getClient();
      messages = (await client.chats.getMessages(chatId, { limit: 100 })) as Array<{ id: string }>;
    } catch (err) {
      // Message search may fail (e.g., chatId is a JID not a UUID) — fall through
      output.warn(`Message search failed for chat "${chatId}": ${String(err)}`);
    }

    if (messages.length > 0) {
      const matches = messages.filter((m) => m.id.toLowerCase().startsWith(input.toLowerCase()));
      if (matches.length === 1) return matches[0].id;
      if (matches.length > 1) {
        const ids = matches.map((m) => `  ${m.id.slice(0, 8)}`).join('\n');
        output.error(`Ambiguous ID prefix "${input}" matches ${matches.length} messages:\n${ids}`);
      }
    }

    // No UUID prefix match — pass through as external ID (e.g., WhatsApp message ID like 3EB0A1B2C3D4E5F6)
    return input;
  }

  output.error(`No message found matching "${input}" in chat ${chatId}`);
}

/**
 * Resolve a person identifier to a UUID.
 *
 * Persons can be searched by phone/email/name, so we use the search API.
 *
 * Matches in order:
 *   1. Exact UUID match (skip API call)
 *   2. Search by name/phone/email (SDK search returns array directly)
 *
 * Exits with error if no match or ambiguous.
 */
export async function resolvePersonId(input: string): Promise<string> {
  if (UUID_RE.test(input)) return input;

  const client = getClient();

  // Search by query (name, phone, email)
  // The search API returns an array directly, not a paginated response
  const searchResult = await client.persons.search({ search: input, limit: 20 });
  if (searchResult.length === 1) return searchResult[0].id;
  if (searchResult.length > 1) {
    const names = searchResult
      .map((p) => {
        const person = p as { id: string; displayName: string | null; phone: string | null };
        return `  ${person.id.slice(0, 8)}  ${person.displayName || person.phone || '(unknown)'}`;
      })
      .join('\n');
    output.error(`Ambiguous query "${input}" matches ${searchResult.length} persons:\n${names}`);
  }

  output.error(`No person found matching "${input}"`);
}

/**
 * Resolve an API key identifier to a UUID.
 *
 * Matches in order:
 *   1. Exact UUID match (skip API call)
 *   2. UUID prefix match (minimum 2 hex chars)
 *   3. Name match (case-insensitive)
 *
 * Exits with error if no match or ambiguous.
 */
export async function resolveKeyId(input: string): Promise<string> {
  if (UUID_RE.test(input)) return input;

  const client = getClient();
  const result = await client.keys.list({ limit: 100 });
  const keys = result.items;

  // Partial UUID prefix (at least 2 chars, looks hex-ish)
  if (/^[0-9a-f]{2,}$/i.test(input)) {
    const matches = keys.filter((k) => k.id.toLowerCase().startsWith(input.toLowerCase()));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const names = matches.map((k) => `  ${k.id.slice(0, 8)}  ${k.name}`).join('\n');
      output.error(`Ambiguous ID prefix "${input}" matches ${matches.length} keys:\n${names}`);
    }
  }

  // Exact name match (case-insensitive)
  const lower = input.toLowerCase();
  const exactName = keys.find((k) => k.name.toLowerCase() === lower);
  if (exactName) return exactName.id;

  // Name substring match
  const nameMatches = keys.filter((k) => k.name.toLowerCase().includes(lower));
  if (nameMatches.length === 1) return nameMatches[0].id;
  if (nameMatches.length > 1) {
    const names = nameMatches.map((k) => `  ${k.id.slice(0, 8)}  ${k.name}`).join('\n');
    output.error(`Ambiguous name "${input}" matches ${nameMatches.length} keys:\n${names}`);
  }

  output.error(`No API key found matching "${input}"`);
}

/**
 * Resolve an automation identifier to a UUID.
 *
 * Matches in order:
 *   1. Exact UUID match (skip API call)
 *   2. UUID prefix match (minimum 2 hex chars)
 *   3. Exact name match (case-insensitive)
 *   4. Name substring match (case-insensitive)
 *
 * Exits with error if no match or ambiguous.
 */
export async function resolveAutomationId(input: string): Promise<string> {
  if (UUID_RE.test(input)) return input;

  const client = getClient();
  const automations = await client.automations.list({});

  // Partial UUID prefix (at least 2 chars, looks hex-ish)
  if (/^[0-9a-f]{2,}$/i.test(input)) {
    const matches = automations.filter((a) => a.id.toLowerCase().startsWith(input.toLowerCase()));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const names = matches.map((a) => `  ${a.id.slice(0, 8)}  ${a.name}`).join('\n');
      output.error(`Ambiguous ID prefix "${input}" matches ${matches.length} automations:\n${names}`);
    }
  }

  // Exact name match (case-insensitive)
  const lower = input.toLowerCase();
  const exactName = automations.find((a) => a.name.toLowerCase() === lower);
  if (exactName) return exactName.id;

  // Name substring match
  const nameMatches = automations.filter((a) => a.name.toLowerCase().includes(lower));
  if (nameMatches.length === 1) return nameMatches[0].id;
  if (nameMatches.length > 1) {
    const names = nameMatches.map((a) => `  ${a.id.slice(0, 8)}  ${a.name}`).join('\n');
    output.error(`Ambiguous name "${input}" matches ${nameMatches.length} automations:\n${names}`);
  }

  output.error(`No automation found matching "${input}"`);
}

/**
 * Resolve a batch job identifier to a UUID.
 *
 * Matches in order:
 *   1. Exact UUID match (skip API call)
 *   2. UUID prefix match (minimum 2 hex chars)
 *
 * Batch jobs don't have names, only IDs.
 *
 * Exits with error if no match or ambiguous.
 */
export async function resolveBatchJobId(input: string): Promise<string> {
  if (UUID_RE.test(input)) return input;

  const client = getClient();
  const result = await client.batchJobs.list({ limit: 100 });
  const jobs = result.items;

  // Partial UUID prefix (at least 2 chars, looks hex-ish)
  if (/^[0-9a-f]{2,}$/i.test(input)) {
    const matches = jobs.filter((j) => j.id.toLowerCase().startsWith(input.toLowerCase()));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const ids = matches.map((j) => `  ${j.id.slice(0, 8)}  ${j.jobType} (${j.status})`).join('\n');
      output.error(`Ambiguous ID prefix "${input}" matches ${matches.length} batch jobs:\n${ids}`);
    }
  }

  output.error(`No batch job found matching "${input}"`);
}

/**
 * Resolve an agent route identifier to a UUID.
 *
 * Routes are scoped to an instance, so instanceId must already be resolved.
 *
 * Matches in order:
 *   1. Exact UUID match (skip API call)
 *   2. UUID prefix match (minimum 2 hex chars)
 *
 * Routes don't have names, only IDs.
 *
 * Exits with error if no match or ambiguous.
 */
export async function resolveRouteId(instanceId: string, input: string): Promise<string> {
  if (UUID_RE.test(input)) return input;

  const client = getClient();
  const routes = await client.routes.list(instanceId, {});

  // Partial UUID prefix (at least 2 chars, looks hex-ish)
  if (/^[0-9a-f]{2,}$/i.test(input)) {
    const matches = routes.filter((r) => r.id.toLowerCase().startsWith(input.toLowerCase()));
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) {
      const ids = matches.map((r) => `  ${r.id}  ${r.scope} (${r.isActive ? 'active' : 'inactive'})`).join('\n');
      output.error(`Ambiguous ID prefix "${input}" matches ${matches.length} routes:\n${ids}`);
    }
  }

  output.error(`No route found matching "${input}"`);
}
