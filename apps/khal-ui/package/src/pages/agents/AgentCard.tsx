'use client';

/**
 * Rich agent card for the registry grid. Surfaces the fields an operator scans
 * for at a glance — name, provider, role, model, active/internal state, linked
 * provider + its last probed health, owner, capabilities, created — and links
 * into the full detail view. Health comes from the page's session probe cache
 * ({@link ProviderHealth}); an unprobed provider reads "unchecked", never a
 * fabricated "healthy".
 */
import { Badge, PillBadge, SectionCard, StatusDot } from '@khal-os/ui';
import type { AgentRow, ProviderHealth, ProviderRow } from '../../api/ext';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { T } from '../../components/tokens';
import { agentCapabilities, agentTypeLabel, providerBadgeVariant } from './agent-helpers';

export interface AgentCardProps {
  agent: AgentRow;
  provider?: ProviderRow;
  health?: ProviderHealth;
  onOpen: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted }}>{label}</span>
      <span style={{ fontSize: 12, color: T.fg, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

export function AgentCard({ agent, provider, health, onOpen }: AgentCardProps) {
  const caps = agentCapabilities(agent);
  const created = agent.createdAt ? new Date(agent.createdAt).getTime() : undefined;

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        textAlign: 'left',
        background: 'none',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        minWidth: 0,
      }}
    >
      <SectionCard padding="md">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 650, color: T.fg, wordBreak: 'break-word' }}>{agent.name}</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <Badge variant={providerBadgeVariant(agent.provider)}>{agent.provider}</Badge>
                <PillBadge>{agentTypeLabel(agent.agentType)}</PillBadge>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
              <Badge variant={agent.isActive ? 'green' : 'gray'}>{agent.isActive ? 'active' : 'inactive'}</Badge>
              {agent.isInternal && <Badge variant="blue">internal</Badge>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, minWidth: 0 }}>
            <Field label="Model">{agent.model || '—'}</Field>
            <Field label="Owner">{agent.ownerId ? `${agent.ownerId.slice(0, 8)}…` : '—'}</Field>
            <Field label="Provider">
              {provider ? (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {health && <StatusDot state={health.healthy ? 'active' : 'error'} size="sm" />}
                  {provider.name}
                  <span style={{ color: T.muted }}>
                    {health ? (health.healthy ? '· healthy' : '· unhealthy') : '· unchecked'}
                  </span>
                </span>
              ) : agent.agentProviderId ? (
                `${agent.agentProviderId.slice(0, 8)}…`
              ) : (
                '—'
              )}
            </Field>
            <Field label="Created">{created ? <FreshnessBadge observedAt={created} source="backend" /> : '—'}</Field>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted }}>
              Capabilities
            </span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {caps.length === 0 ? (
                <span style={{ fontSize: 12, color: T.muted }}>none declared</span>
              ) : (
                caps.map((cap) => <PillBadge key={cap}>{cap}</PillBadge>)
              )}
            </div>
          </div>
        </div>
      </SectionCard>
    </button>
  );
}
