import type { ZenviaConfig, ZenviaConversationRouting, ZenviaHandoffSolution } from '../types';

export const HANDOFF_NOT_CONFIGURED_ERROR =
  'Zenvia handoff refused: configure zenviaSalesApiKey with zenviaHandoffGroupId or zenviaHandoffRouting (transfer through the Sales API) or zenviaHandoffSolution (conversation routing), so there is somewhere to send the conversation';

const NOTE_REASON_LABEL = 'Motivo do handoff';
const NOTE_LEAD_LABEL = 'Dados do lead';

export type ZenviaHandoffMode = 'transfer' | 'routing';

export function resolveHandoffMode(config: ZenviaConfig): ZenviaHandoffMode | null {
  if (config.salesApiKey && (config.handoffGroupId || config.handoffRouting)) return 'transfer';
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
