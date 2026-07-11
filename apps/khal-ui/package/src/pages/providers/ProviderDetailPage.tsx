'use client';

/**
 * Per-provider detail. Header carries identity, schema, active state, and a gated
 * delete; tabs hold the config/health overview, live discovery, and the agents
 * linked to this provider.
 */
import { Badge, Button, Note, PillBadge, Spinner } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { PageShell } from '../../components/PageShell';
import { ResourceDetail } from '../../components/ResourceDetail';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { ActionButton, type TabDef, Tabs } from '../instances/components';
import { ProviderDiscoveryTab } from './tabs/ProviderDiscoveryTab';
import { ProviderLinkedAgentsTab } from './tabs/ProviderLinkedAgentsTab';
import { ProviderOverviewTab } from './tabs/ProviderOverviewTab';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'agents', label: 'Linked agents' },
];

export function ProviderDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { ext } = useOmniClient();
  const [tab, setTab] = useState('overview');

  const query = useOmniQuery(['providers', id, 'detail'], () => ext.providers.get(id), { enabled: Boolean(id) });
  const provider = query.data?.data;
  const refetch = () => void query.refetch();

  if (query.isLoading) {
    return (
      <PageShell eyebrow="Agents & Automation" title="Provider">
        <Spinner size="md" />
      </PageShell>
    );
  }

  if (query.error || !provider) {
    return (
      <PageShell
        eyebrow="Agents & Automation"
        title="Provider"
        actions={
          <Button size="small" variant="secondary" onClick={() => navigate('/providers')}>
            Back
          </Button>
        }
      >
        <Note type="error">{query.error ? (query.error as Error).message : 'Provider not found.'}</Note>
      </PageShell>
    );
  }

  return (
    <PageShell eyebrow="Agents & Automation" title={provider.name}>
      <ResourceDetail
        title={provider.name}
        id={provider.id}
        subtitle={provider.baseUrl ?? undefined}
        status={
          <>
            <PillBadge>{provider.schema ?? '—'}</PillBadge>
            <Badge variant={provider.isActive === false ? 'gray' : 'green'}>
              {provider.isActive === false ? 'inactive' : 'active'}
            </Badge>
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small" variant="secondary" onClick={() => navigate('/providers')}>
              Back
            </Button>
            <Button size="small" variant="secondary" onClick={refetch}>
              Refresh
            </Button>
            <ActionButton
              label="Delete provider"
              effect="live"
              destructive
              targetName={provider.name}
              targetId={provider.id}
              confirmDescription="Permanently deletes this provider. Agents linked to it will lose their backend."
              onDone={() => navigate('/providers')}
              run={() => ext.providers.remove(provider.id)}
            />
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <div style={{ minWidth: 0 }}>
            {tab === 'overview' && <ProviderOverviewTab provider={provider} refetch={refetch} />}
            {tab === 'discovery' && <ProviderDiscoveryTab provider={provider} refetch={refetch} />}
            {tab === 'agents' && <ProviderLinkedAgentsTab provider={provider} refetch={refetch} />}
          </div>
        </div>
      </ResourceDetail>
    </PageShell>
  );
}
