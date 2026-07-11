'use client';

/**
 * Overview tab: the send/receive proof split. Rather than a single "connected"
 * chip, it shows transport state, the last inbound message actually observed
 * (with preview), and the last outbound state — derived from the status endpoint
 * plus this instance's recent events — so an operator sees the instance moving
 * messages, not just claiming to be up. Plus a profile summary and quick facts.
 */
import { SectionCard, Spinner, StatusDot } from '@khal-os/ui';
import type { ReactNode } from 'react';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { FreshnessBadge, formatAge } from '../../../components/FreshnessBadge';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { channelLabel, connStateDot, deriveSendReceiveProof } from '../instance-helpers';
import type { InstanceTabProps } from '../tab-types';

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 13, color: T.fg }}>{value}</span>
    </div>
  );
}

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <SectionCard padding="md">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>Send / receive proof</h3>
          <FreshnessBadge observedAt={status.dataUpdatedAt || undefined} source="status" staleAfterMs={30_000} />
        </div>
        {status.isLoading && <Spinner size="sm" />}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot state={connStateDot(proof.transport)} size="md" />
            <Fact
              label="Transport"
              value={<strong style={{ textTransform: 'capitalize' }}>{proof.transport}</strong>}
            />
          </div>
          <Fact
            label="Last inbound"
            value={
              proof.lastInboundAt
                ? `${formatAge(now - proof.lastInboundAt)}${proof.lastInboundPreview ? ` · "${proof.lastInboundPreview}"` : ''}`
                : 'none observed'
            }
          />
          <Fact
            label="Last outbound"
            value={
              proof.lastOutboundAt
                ? `${formatAge(now - proof.lastOutboundAt)} · ${proof.lastOutboundState ?? 'sent'}`
                : 'none observed'
            }
          />
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
        <SectionCard padding="md">
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: T.fg }}>Profile</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Fact label="Profile name" value={String(instance.profileName ?? '—')} />
            <Fact label="Owner" value={String(instance.ownerIdentifier ?? '—')} />
            <Fact label="Bio" value={String(instance.profileBio ?? '—')} />
            <Fact
              label="Profile synced"
              value={instance.profileSyncedAt ? new Date(String(instance.profileSyncedAt)).toLocaleString() : 'never'}
            />
          </div>
        </SectionCard>

        <SectionCard padding="md">
          <h3 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: T.fg }}>Quick facts</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Fact label="Channel" value={channelLabel(instance.channel)} />
            <Fact label="Active" value={instance.isActive ? 'yes' : 'no'} />
            <Fact label="Default" value={instance.isDefault ? 'yes' : 'no'} />
            <Fact label="Agent" value={String(instance.agentId ?? 'unbound')} />
            <Fact
              label="Last message"
              value={instance.lastMessageAt ? formatAge(now - new Date(String(instance.lastMessageAt)).getTime()) : '—'}
            />
          </div>
        </SectionCard>
      </div>
    </div>
  );
}
