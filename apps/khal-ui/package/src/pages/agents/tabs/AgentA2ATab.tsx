'use client';

/**
 * A2A view for an agent: its agent-card overrides plus a read-only lookup into
 * the A2A discovery surface (GET /a2a/agents, GET /a2a/agents/:id/card). Both
 * are observes-only reads — useful for confirming what other agents would see
 * when they discover this one.
 */
import { Button, Note } from '@khal-os/ui';
import type { AgentRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { JsonInspector } from '../../../components/JsonInspector';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../../instances/components';

export function AgentA2ATab({ agent }: { agent: AgentRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const discovery = useOmniQuery(['a2a', 'agents'], () => ext.a2a.agents());
  const items = discovery.data?.items ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel title="Agent card" description="A2A agent-card overrides declared on this agent.">
        {agent.agentCard ? (
          <JsonInspector value={agent.agentCard} />
        ) : (
          <Note type="default">No agent-card overrides set. Edit them on the Overview tab.</Note>
        )}
      </Panel>

      <Panel
        title="A2A discovery"
        description="Read-only — what the A2A registry exposes to other agents."
        actions={
          <Button size="small" variant="secondary" onClick={() => void discovery.refetch()}>
            Refresh
          </Button>
        }
      >
        <span style={{ fontSize: 12, color: T.muted }}>{items.length} discoverable agent(s)</span>
        {items.length > 0 && <JsonInspector value={items} />}
        <div style={{ marginTop: 8 }}>
          <ActionButton
            label="Fetch this agent's A2A card"
            effect="read-only"
            targetName={agent.name}
            targetId={agent.id}
            run={() => ext.a2a.card(agent.id)}
          />
        </div>
      </Panel>
    </div>
  );
}
