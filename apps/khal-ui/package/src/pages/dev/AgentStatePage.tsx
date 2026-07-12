'use client';

/**
 * Standalone agent-state debug page (/dev/agent-state). A free-form one-shot
 * read/write of the KV state machine for any (agentId, chatId) pair. The write
 * is SYNTHETIC — it pokes a KV status, not production messaging.
 */
import { PageShell } from '../../components/PageShell';
import { AgentStatePanel } from '../agents/AgentStatePanel';

export function AgentStatePage() {
  return (
    <PageShell
      eyebrow="Dev"
      title="Agent State"
      description="One-shot read/write of the agent state machine (KV). Synthetic — use scratch ids."
    >
      <AgentStatePanel />
    </PageShell>
  );
}
