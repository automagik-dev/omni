'use client';

/**
 * Instances list — the entry point of the channels vertical. Each instance is a
 * SectionCard row (avatar, live StatusDot, name, channel + profile in mono, and
 * a production read-only tag) that lifts on hover and opens the per-instance
 * detail. Production instances are tagged so an operator sees, before clicking
 * in, which rows are read-only.
 */
import { Avatar, Button, EmptyState, Note, PillBadge, SectionCard, Spinner, StatusDot } from '@khal-os/ui';
import type { Instance } from '@omni/sdk';
import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useScope } from '../../app/providers/ScopeProvider';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
import { CreateInstanceDialog } from './CreateInstanceDialog';
import { channelLabel, isProductionInstance } from './instance-helpers';

export function InstancesListPage() {
  const scope = useScope();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const instances = scope.instances;

  return (
    <PageShell
      eyebrow="Channels"
      title="Instances"
      description="Channel instances, their connection status, and per-instance configuration."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" variant="secondary" onClick={() => scope.refreshInstances()}>
            Refresh
          </Button>
          <Button size="small" variant="default" onClick={() => setCreating(true)}>
            New instance
          </Button>
        </div>
      }
    >
      {scope.instancesError && <Note type="error">{scope.instancesError.message}</Note>}

      {scope.instancesLoading && instances.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner />
        </div>
      ) : instances.length === 0 ? (
        <SectionCard padding="lg">
          <EmptyState
            title="No instances yet"
            description="Create one to connect a channel."
            action={
              <Button size="small" variant="default" onClick={() => setCreating(true)}>
                New instance
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {instances.map((inst, i) => (
            <InstanceRow key={inst.id} instance={inst} index={i} onOpen={() => navigate(`/instances/${inst.id}`)} />
          ))}
        </div>
      )}

      <CreateInstanceDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          scope.refreshInstances();
          navigate(`/instances/${id}`);
        }}
      />
    </PageShell>
  );
}

function InstanceRow({ instance, index, onOpen }: { instance: Instance; index: number; onOpen: () => void }) {
  const production = isProductionInstance(instance.id);
  const owner = (instance as { ownerIdentifier?: string | null }).ownerIdentifier ?? null;
  return (
    <SectionCard
      padding="md"
      className="omni-card-hover khal-anim-fade-up"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ cursor: 'pointer', animationDelay: `${index * 50}ms` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
        <StatusDot state={instance.isActive ? 'active' : 'idle'} size="md" pulse={instance.isActive} />
        <Avatar name={instance.name} size="md" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 15, fontWeight: 650, color: T.fg, letterSpacing: '-0.01em' }}>
              {instance.name}
            </span>
            {instance.isDefault && (
              <PillBadge size="sm" variant="muted">
                default
              </PillBadge>
            )}
            {production && (
              <PillBadge size="sm" variant="muted" dot dotColor={T.warn}>
                prod · read-only
              </PillBadge>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 3, fontSize: 12, color: T.muted, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: T.mono }}>{channelLabel(instance.channel)}</span>
            {instance.profileName && <span>· {instance.profileName}</span>}
            {owner && <span style={{ fontFamily: T.mono }}>· {owner}</span>}
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            fontWeight: 600,
            color: T.secondary,
            flexShrink: 0,
          }}
        >
          Open <span style={{ color: T.accent }}>→</span>
        </span>
      </div>
    </SectionCard>
  );
}
