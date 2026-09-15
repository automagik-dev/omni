/**
 * omni events sample <eventType> (#1182)
 *
 * Prints one recent journaled payload of that type as flattened dot-paths, so
 * conditions and templates are written against real field names.
 */

import type { OmniClient } from '@omni/sdk';
import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { flattenPaths, truncateValue } from '../utils/flatten.js';

/**
 * The payload automations see for a journaled event: the platform payload
 * (`rawPayload`), whose top-level fields conditions resolve directly.
 */
export async function fetchSamplePayload(client: OmniClient, eventType: string): Promise<Record<string, unknown>> {
  const result = await client.events.list({ eventType, limit: 1 });
  const event = result.items[0] as { rawPayload?: Record<string, unknown> | null } | undefined;
  if (!event) throw new Error(`No journaled event of type "${eventType}" found`);
  return event.rawPayload ?? {};
}

export function sampleLines(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(flattenPaths(payload, 'payload')).map(([path, value]) => [path, truncateValue(value)]),
  );
}

export function createEventsSampleCommand(): Command {
  return new Command('sample')
    .description('Print one recent payload of an event type as dot-paths')
    .argument('<eventType>', 'Event type, e.g. message.received')
    .action(async (eventType: string) => {
      try {
        const lines = sampleLines(await fetchSamplePayload(getClient(), eventType));
        if (output.getCurrentFormat() === 'json') return output.data(lines);
        const width = Math.max(0, ...Object.keys(lines).map((k) => k.length));
        for (const [path, value] of Object.entries(lines)) {
          output.raw(`${path.padEnd(width)}  ${JSON.stringify(value)}`);
        }
      } catch (err) {
        output.error(`Failed to sample event: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    });
}
