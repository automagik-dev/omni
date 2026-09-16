/**
 * Stamp cost/usage onto the journal row of the event that woke an agent (#1064).
 *
 * The dispatcher and the automation `call_agent` action both route through
 * here, so the journal is the single ledger — no consumer has to parse
 * provider output into a side table. Same shape as the #1035 back-link in
 * message-persistence: an UPDATE on `omni_events` by id, inside the caller's
 * worker tenant scope via `scopedHandle`, a no-op when the row is not there.
 */

import { AGENT_USAGE_METADATA_KEY, type AgentUsage, createLogger, isValidUuid } from '@omni/core';
import type { Database } from '@omni/db';
import { omniEvents, triggerLogs } from '@omni/db';
import { eq, sql } from 'drizzle-orm';
import { scopedHandle } from '../tenancy/tenant-scope';

const log = createLogger('agent-usage');

export interface AgentUsageStamp {
  usage: AgentUsage;
  /** Provider round-trip; lands in the existing `agent_latency_ms` column. */
  latencyMs?: number;
}

/**
 * Merge `{ agentUsage }` into `metadata` and set `agent_latency_ms` on the
 * `omni_events` row for `eventId`. Best-effort: the reply is already on its
 * way, so a failure here is logged and never thrown.
 */
export async function stampAgentUsage(
  db: Database,
  eventId: string | undefined,
  stamp: AgentUsageStamp,
): Promise<void> {
  if (!eventId || !isValidUuid(eventId)) return;
  try {
    const patch = JSON.stringify({ [AGENT_USAGE_METADATA_KEY]: stamp.usage });
    await scopedHandle(db)
      .update(omniEvents)
      .set({
        metadata: sql`coalesce(${omniEvents.metadata}, '{}'::jsonb) || ${patch}::jsonb`,
        ...(stamp.latencyMs !== undefined ? { agentLatencyMs: Math.round(stamp.latencyMs) } : {}),
      })
      .where(eq(omniEvents.id, eventId));
  } catch (error) {
    log.warn('Failed to stamp agent usage on journal row', { eventId, error: String(error) });
  }
}

export interface AutomationTriggerLog {
  instanceId: string;
  providerId?: string;
  eventId?: string;
  eventType?: string;
  chatId: string;
  senderId?: string;
  channelType?: string;
  durationMs?: number;
  usage?: AgentUsage | null;
  error?: string;
}

/**
 * Record a `call_agent` automation run in `trigger_logs` with the tokens and
 * cost the provider reported (#1183). Unknown usage stays NULL. Best-effort.
 */
export async function recordAutomationTriggerLog(db: Database, entry: AutomationTriggerLog): Promise<void> {
  try {
    const { usage } = entry;
    await scopedHandle(db)
      .insert(triggerLogs)
      .values({
        instanceId: entry.instanceId,
        providerId: entry.providerId && isValidUuid(entry.providerId) ? entry.providerId : null,
        eventType: entry.eventType ?? 'unknown',
        eventId: entry.eventId ?? 'unknown',
        triggerType: 'automation',
        channelType: entry.channelType,
        chatId: entry.chatId,
        senderId: entry.senderId,
        mode: 'round-trip',
        respondedAt: entry.error ? null : new Date(),
        responded: !entry.error,
        durationMs: entry.durationMs !== undefined ? Math.round(entry.durationMs) : null,
        inputTokens: usage?.tokensIn ?? null,
        outputTokens: usage?.tokensOut ?? null,
        costUsd: usage?.costUsd !== undefined ? String(usage.costUsd) : null,
        error: entry.error,
      });
  } catch (error) {
    log.warn('Failed to record automation trigger log', { instanceId: entry.instanceId, error: String(error) });
  }
}
