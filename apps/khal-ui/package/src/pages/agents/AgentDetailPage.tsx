'use client';

/**
 * Per-agent detail. The header carries identity, status, and a gated soft-delete
 * (DELETE sets isActive=false); the body organises every capability into tabs —
 * overview/edit, A2A card + discovery, identities, tasks, follow-up config,
 * routes-using-this-agent, and an agent-state debug panel.
 */
import { Badge, Button, Note, Spinner, StatusDot } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { PageShell } from '../../components/PageShell';
import { ResourceDetail } from '../../components/ResourceDetail';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { ActionButton, type TabDef, Tabs } from '../instances/components';
import { AgentStatePanel } from './AgentStatePanel';
import { agentTypeLabel, providerBadgeVariant } from './agent-helpers';
import { AgentA2ATab } from './tabs/AgentA2ATab';
import { AgentFollowUpTab } from './tabs/AgentFollowUpTab';
import { AgentIdentitiesTab } from './tabs/AgentIdentitiesTab';
import { AgentOverviewTab } from './tabs/AgentOverviewTab';
import { AgentRoutesTab } from './tabs/AgentRoutesTab';
import { AgentTasksTab } from './tabs/AgentTasksTab';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'a2a', label: 'A2A Card' },
  { id: 'identities', label: 'Identities' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'followup', label: 'Follow-up' },
  { id: 'routes', label: 'Routes' },
  { id: 'state', label: 'State (debug)' },
];

export function AgentDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { ext } = useOmniClient();
  const [tab, setTab] = useState('overview');

  const query = useOmniQuery(['agents', id, 'detail'], () => ext.agents.get(id), { enabled: Boolean(id) });
  const agent = query.data?.data;
  const refetch = () => void query.refetch();

  if (query.isLoading) {
    return (
      <PageShell eyebrow="Agents & Automation" title="Agent">
        <Spinner size="md" />
      </PageShell>
    );
  }

  if (query.error || !agent) {
    return (
      <PageShell
        eyebrow="Agents & Automation"
        title="Agent"
        actions={
          <Button size="small" variant="secondary" onClick={() => navigate('/agents')}>
            Back
          </Button>
        }
      >
        <Note type="error">{query.error ? (query.error as Error).message : 'Agent not found.'}</Note>
      </PageShell>
    );
  }

  return (
    <PageShell eyebrow="Agents & Automation" title={agent.name}>
      <ResourceDetail
        title={agent.name}
        id={agent.id}
        subtitle={`${agent.provider} · ${agentTypeLabel(agent.agentType)}`}
        status={
          <>
            <StatusDot state={agent.isActive ? 'active' : 'idle'} size="sm" pulse={agent.isActive} />
            <Badge variant={providerBadgeVariant(agent.provider)}>{agent.provider}</Badge>
            <Badge variant={agent.isActive ? 'green' : 'gray'}>{agent.isActive ? 'active' : 'inactive'}</Badge>
            {agent.isInternal && <Badge variant="blue">internal</Badge>}
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small" variant="secondary" onClick={() => navigate('/agents')}>
              Back
            </Button>
            <Button size="small" variant="secondary" onClick={refetch}>
              Refresh
            </Button>
            <ActionButton
              label="Deactivate (soft-delete)"
              effect="live"
              destructive
              targetName={agent.name}
              targetId={agent.id}
              confirmDescription="Soft-deletes the agent (sets isActive = false). It stays in the registry, inactive."
              onDone={refetch}
              run={() => ext.agents.remove(agent.id)}
            />
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <div style={{ minWidth: 0 }}>
            {tab === 'overview' && <AgentOverviewTab agent={agent} refetch={refetch} />}
            {tab === 'a2a' && <AgentA2ATab agent={agent} refetch={refetch} />}
            {tab === 'identities' && <AgentIdentitiesTab agent={agent} refetch={refetch} />}
            {tab === 'tasks' && <AgentTasksTab agent={agent} refetch={refetch} />}
            {tab === 'followup' && <AgentFollowUpTab agent={agent} refetch={refetch} />}
            {tab === 'routes' && <AgentRoutesTab agent={agent} refetch={refetch} />}
            {tab === 'state' && <AgentStatePanel agentId={agent.id} lockAgentId />}
          </div>
        </div>
      </ResourceDetail>
    </PageShell>
  );
}
