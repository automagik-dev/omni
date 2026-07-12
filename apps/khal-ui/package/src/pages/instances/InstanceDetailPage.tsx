'use client';

/**
 * Per-instance detail: the full config surface, lifecycle, connect wizard, and
 * every sub-resource, organised into tabs. The header carries the identity,
 * status, and a guarded delete. Production instances render everything read-only
 * — their mutating controls are disabled with a visible reason, never hidden.
 */
import { Badge, Button, Note, Spinner, StatusDot } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { useScope } from '../../app/providers/ScopeProvider';
import { PageShell } from '../../components/PageShell';
import { ResourceDetail } from '../../components/ResourceDetail';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { ActionButton, type TabDef, Tabs } from './components';
import { channelLabel, isProductionInstance, isWhatsApp } from './instance-helpers';
import { ConfigTab } from './tabs/ConfigTab';
import { ContactsTab } from './tabs/ContactsTab';
import { DiscordTab } from './tabs/DiscordTab';
import { GroupsTab } from './tabs/GroupsTab';
import { LifecycleTab } from './tabs/LifecycleTab';
import { OverviewTab } from './tabs/OverviewTab';
import { ProfileTab } from './tabs/ProfileTab';
import { RoutingTab } from './tabs/RoutingTab';
import { SyncTab } from './tabs/SyncTab';

export function InstanceDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const scope = useScope();
  const { ext, client } = useOmniClient();
  const [tab, setTab] = useState('overview');

  const query = useOmniQuery(['instances', id, 'raw'], () => ext.instances.getRaw(id), { enabled: Boolean(id) });
  const instance = query.data?.data;
  const isProduction = isProductionInstance(id);

  if (query.isLoading) {
    return (
      <PageShell eyebrow="Channels" title="Instance">
        <Spinner size="md" />
      </PageShell>
    );
  }

  if (query.error || !instance) {
    return (
      <PageShell
        eyebrow="Channels"
        title="Instance"
        actions={
          <Button size="small" variant="secondary" onClick={() => navigate('/instances')}>
            Back
          </Button>
        }
      >
        <Note type="error">{query.error ? (query.error as Error).message : 'Instance not found.'}</Note>
      </PageShell>
    );
  }

  const channel = instance.channel;
  const wa = isWhatsApp(channel);

  const tabs: TabDef[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'config', label: 'Config' },
    { id: 'lifecycle', label: 'Lifecycle' },
    { id: 'contacts', label: 'Contacts', when: wa },
    { id: 'groups', label: 'Groups', when: wa },
    { id: 'sync', label: 'Sync', when: wa },
    { id: 'profile', label: 'Profile' },
    { id: 'discord', label: 'Discord', when: channel === 'discord' },
    { id: 'routing', label: 'Routing' },
  ];

  const refetchInstance = () => {
    void query.refetch();
    scope.refreshInstances();
  };
  const tabProps = { instance, isProduction, refetchInstance };

  return (
    <PageShell eyebrow="Channels" title={instance.name}>
      <ResourceDetail
        title={instance.name}
        id={id}
        subtitle={channelLabel(channel)}
        status={
          <>
            <StatusDot state={instance.isActive ? 'active' : 'idle'} size="sm" pulse={instance.isActive} />
            <Badge variant={instance.isActive ? 'green' : 'gray'}>{instance.isActive ? 'active' : 'inactive'}</Badge>
            {instance.isDefault && <Badge variant="blue">default</Badge>}
            {isProduction && <Badge variant="amber">production · read-only</Badge>}
          </>
        }
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small" variant="secondary" onClick={() => navigate('/instances')}>
              Back
            </Button>
            <Button size="small" variant="secondary" onClick={refetchInstance}>
              Refresh
            </Button>
            <ActionButton
              label="Delete instance"
              effect="live"
              destructive
              targetName={instance.name}
              targetId={id}
              disabledReason={isProduction ? 'Production instance — deletion is prohibited.' : undefined}
              confirmDescription="Permanently deletes this instance and its session."
              run={async () => {
                await client.instances.delete(id);
                scope.refreshInstances();
                navigate('/instances');
                return { deleted: id };
              }}
            />
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
          <div style={{ minWidth: 0 }}>
            {tab === 'overview' && <OverviewTab {...tabProps} />}
            {tab === 'config' && <ConfigTab {...tabProps} />}
            {tab === 'lifecycle' && <LifecycleTab {...tabProps} />}
            {tab === 'contacts' && wa && <ContactsTab {...tabProps} />}
            {tab === 'groups' && wa && <GroupsTab {...tabProps} />}
            {tab === 'sync' && wa && <SyncTab {...tabProps} />}
            {tab === 'profile' && <ProfileTab {...tabProps} />}
            {tab === 'discord' && channel === 'discord' && <DiscordTab {...tabProps} />}
            {tab === 'routing' && <RoutingTab {...tabProps} />}
          </div>
        </div>
      </ResourceDetail>
    </PageShell>
  );
}
