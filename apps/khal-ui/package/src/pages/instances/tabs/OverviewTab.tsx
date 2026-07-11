'use client';

/**
 * Overview tab: the send/receive proof split. Rather than a single "connected"
 * chip, it shows transport state, the last inbound message actually observed
 * (with preview), and the last outbound state — derived from the status endpoint
 * plus this instance's recent events — as MetricDisplay proof tiles, so an
 * operator sees the instance moving messages, not just claiming to be up. Plus a
 * profile summary and quick facts as mono DataRows.
 */
import { DataRow, MetricDisplay, SectionCard, Spinner, StatusDot } from '@khal-os/ui';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { FreshnessBadge, formatAge } from '../../../components/FreshnessBadge';
import { SectionHead } from '../../../components/ResourceDetail';
import { T } from '../../../components/tokens';
import '../../../components/runtime-styles';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { channelLabel, connStateDot, deriveSendReceiveProof } from '../instance-helpers';
import type { InstanceTabProps } from '../tab-types';

export function OverviewTab({ instance }: InstanceTabProps) {
  const { client } = useOmniClient();
  const id = instance.id;

  const status = useOmniQuery(['instances', id, 'status'], () => client.instances.status(id), {
    refetchInterval: 15_000,
  });
  const events = useOmniQuery(['events', 'instance', id], () => client.events.list({ instanceId: id, limit: 20 }), {
    staleTime: 10_000,
  });

  const proof = deriveSendReceiveProof(status.data, events.data?.items ?? []);
  const now = Date.now();
  const transportDot = connStateDot(proof.transport);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <SectionCard padding="md">
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}
        >
          <SectionHead>Send / receive proof</SectionHead>
          <FreshnessBadge observedAt={status.dataUpdatedAt || undefined} source="status" staleAfterMs={30_000} />
        </div>
        {status.isLoading && <Spinner size="sm" />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          <SectionCard variant="inset" padding="md" className="omni-card-hover">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <StatusDot state={transportDot} size="lg" pulse={transportDot === 'live' || transportDot === 'active'} />
              <MetricDisplay
                size="sm"
                value={proof.transport}
                label="Transport"
                accentColor={transportDot === 'error' ? T.danger : T.fg}
              />
            </div>
          </SectionCard>
          <SectionCard variant="inset" padding="md" className="omni-card-hover">
            <MetricDisplay
              size="sm"
              value={proof.lastInboundAt ? formatAge(now - proof.lastInboundAt) : '—'}
              label="Last inbound"
              description={proof.lastInboundPreview ? `“${proof.lastInboundPreview}”` : 'none observed'}
            />
          </SectionCard>
          <SectionCard variant="inset" padding="md" className="omni-card-hover">
            <MetricDisplay
              size="sm"
              value={proof.lastOutboundAt ? formatAge(now - proof.lastOutboundAt) : '—'}
              label="Last outbound"
              description={proof.lastOutboundAt ? (proof.lastOutboundState ?? 'sent') : 'none observed'}
            />
          </SectionCard>
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
        <SectionCard padding="md">
          <div style={{ marginBottom: 12 }}>
            <SectionHead>Status</SectionHead>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <DataRow variant="rule" label="Channel" value={channelLabel(instance.channel)} />
            <DataRow
              variant="rule"
              label="Active"
              value={instance.isActive ? 'yes' : 'no'}
              statusDot
              dotColor={instance.isActive ? T.ok : T.muted}
              accentColor={instance.isActive ? T.ok : T.muted}
            />
            <DataRow
              variant="rule"
              label="Default"
              value={instance.isDefault ? 'yes' : 'no'}
              statusDot
              dotColor={instance.isDefault ? T.accentBlue : T.muted}
            />
            <DataRow variant="rule" label="Agent" value={String(instance.agentId ?? 'unbound')} />
            <DataRow
              variant="rule"
              label="Last message"
              value={instance.lastMessageAt ? formatAge(now - new Date(String(instance.lastMessageAt)).getTime()) : '—'}
            />
          </div>
        </SectionCard>

        <SectionCard padding="md">
          <div style={{ marginBottom: 12 }}>
            <SectionHead>Profile</SectionHead>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <DataRow variant="rule" label="Profile name" value={String(instance.profileName ?? '—')} />
            <DataRow variant="rule" label="Owner" value={String(instance.ownerIdentifier ?? '—')} />
            <DataRow variant="rule" label="Bio" value={String(instance.profileBio ?? '—')} />
            <DataRow
              variant="rule"
              label="Profile synced"
              value={instance.profileSyncedAt ? new Date(String(instance.profileSyncedAt)).toLocaleString() : 'never'}
            />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
