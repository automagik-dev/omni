/**
 * Instance Resolution
 *
 * Resolves instance identifiers (full UUID, partial UUID prefix, name) to UUIDs.
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
