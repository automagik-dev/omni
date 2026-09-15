/**
 * omni automations scaffold <eventType> [--action <type>] (#1182)
 *
 * Derives a ready-to-edit automation definition from a real journaled event:
 * trigger, one condition on a real top-level field, one action stub whose
 * payloadTemplate references real paths.
 */

import { Command } from 'commander';
import { getClient } from '../client.js';
import * as output from '../output.js';
import { flattenPaths } from '../utils/flatten.js';
import { fetchSamplePayload } from './events-sample.js';

/** Condition field preference: chat identifier, then instance identifier. */
const PREFERRED_CONDITION_FIELDS = [/chat.?id$/i, /instance.?id$/i];

export function buildScaffold(eventType: string, payload: Record<string, unknown>, action = 'emit_event') {
  const scalar = (v: unknown) => v !== null && typeof v !== 'object';
  const topLevel = Object.entries(payload).filter(([, v]) => scalar(v));
  const preferred = PREFERRED_CONDITION_FIELDS.map((re) => topLevel.find(([k]) => re.test(k))).find(Boolean);
  const [field, value] = preferred ?? topLevel[0] ?? [];
  const paths = Object.entries(flattenPaths(payload))
    .filter(([, v]) => scalar(v))
    .map(([p]) => p)
    .slice(0, 2);
  const payloadTemplate = Object.fromEntries(paths.map((p) => [p.split('.').pop() as string, `{{payload.${p}}}`]));
  return {
    triggerEventType: eventType,
    conditions: field === undefined ? [] : [{ field, operator: 'eq', value }],
    actions: [
      {
        type: action,
        config: action === 'emit_event' ? { eventType: `custom.${eventType}`, payloadTemplate } : { payloadTemplate },
      },
    ],
  };
}

export function createAutomationsScaffoldCommand(): Command {
  return new Command('scaffold')
    .description('Print an automation definition derived from a real event of this type')
    .argument('<eventType>', 'Trigger event type, e.g. message.received')
    .option('--action <type>', 'Action type for the stub', 'emit_event')
    .action(async (eventType: string, options: { action: string }) => {
      try {
        const payload = await fetchSamplePayload(getClient(), eventType);
        output.raw(JSON.stringify(buildScaffold(eventType, payload, options.action), null, 2));
      } catch (err) {
        output.error(`Failed to scaffold automation: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    });
}
