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

  // UUID prefix matching requires chat context for now
  // Without global message search, we can't resolve prefixes
  if (!chatId) {
    // If it looks like a UUID prefix, accept it (will fail at API if invalid)
    if (/^[0-9a-f]{2,}$/i.test(input)) {
      output.error(
        `Cannot resolve message ID prefix "${input}" without chat context. Provide full UUID or use --chat <id> option.`,
      );
    }
    output.error(`Invalid message ID: "${input}". Must be a valid UUID.`);
  }

  // With chat context, search within that chat
  const client = getClient();
  const messages = await client.chats.getMessages(chatId, { limit: 100 });

  // Partial UUID prefix (at least 2 chars, looks hex-ish)
  if (/^[0-9a-f]{2,}$/i.test(input)) {
    const matches = messages.filter((m) => (m as { id: string }).id.toLowerCase().startsWith(input.toLowerCase()));
    if (matches.length === 1) return (matches[0] as { id: string }).id;
    if (matches.length > 1) {
      const ids = matches.map((m) => `  ${(m as { id: string }).id.slice(0, 8)}`).join('\n');
      output.error(`Ambiguous ID prefix "${input}" matches ${matches.length} messages:\n${ids}`);
    }
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
