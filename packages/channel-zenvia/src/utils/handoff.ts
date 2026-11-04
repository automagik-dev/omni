/**
 * Handoff planning for the Zenvia channel.
 *
 * Two modes, chosen by `resolveHandoffMode`:
 *   - `transfer`: the Sales API moves the prospect to a group (see the plugin's
 *     `transferToHuman`); the farewell is an ordinary message.
 *   - `routing`: the farewell carries the API v2 `conversation` field
 *     `{ solution, properties }`, and Zenvia routes the conversation when the
 *     contact replies.
 *
 * With neither configured the handoff is refused instead of pausing the agent
 * on a conversation no human will ever see.
 */

import type { ZenviaConfig, ZenviaConversationRouting, ZenviaHandoffSolution } from '../types';

export const HANDOFF_NOT_CONFIGURED_ERROR =
  'Zenvia handoff refused: configure zenviaSalesApiKey and zenviaHandoffGroupId (transfer through the Sales API) or zenviaHandoffSolution (conversation routing), so there is somewhere to send the conversation';

const NOTE_REASON_LABEL = 'Motivo do handoff';
const NOTE_LEAD_LABEL = 'Dados do lead';

export type ZenviaHandoffMode = 'transfer' | 'routing';

export function resolveHandoffMode(config: ZenviaConfig): ZenviaHandoffMode | null {
  if (config.salesApiKey && config.handoffGroupId) return 'transfer';
  if (config.handoffSolution) return 'routing';
  return null;
}

function formatScalar(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function formatEntries(value: unknown): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).map(([key, entry]) => `${key}: ${formatScalar(entry)}`);
  }
  return [formatScalar(value)];
}

export function buildHandoffNote(meta: Record<string, unknown>): string | null {
  const lines: string[] = [];

  const reason = meta.motivoHandoff;
  if (typeof reason === 'string' && reason.trim()) lines.push(`${NOTE_REASON_LABEL}: ${reason.trim()}`);

  const leadData = meta.dadosLead;
  if (leadData !== undefined && leadData !== null && leadData !== '') {
    lines.push(`${NOTE_LEAD_LABEL}:`, ...formatEntries(leadData));
  }

  const fields = meta.handoffFields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    lines.push(...formatEntries(fields));
  }

  return lines.length > 0 ? lines.join('\n') : null;
}

/**
 * Build the `conversation` routing for a handoff message. Explicit
 * `handoffFields` keys win over the derived ones.
 */
export function buildHandoffRouting(
  solution: ZenviaHandoffSolution,
  meta: Record<string, unknown>,
): ZenviaConversationRouting {
  const properties: Record<string, unknown> = {};

  const reason = meta.motivoHandoff;
  if (typeof reason === 'string' && reason.trim()) properties.handoffReason = reason.trim();

  const leadData = meta.dadosLead;
  if (leadData !== undefined && leadData !== null && leadData !== '') properties.leadData = leadData;

  const fields = meta.handoffFields;
  if (fields && typeof fields === 'object' && !Array.isArray(fields)) {
    Object.assign(properties, fields as Record<string, unknown>);
  }

  return Object.keys(properties).length > 0 ? { solution, properties } : { solution };
}
