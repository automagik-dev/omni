'use client';

/**
 * Rich agent card for the registry grid. Surfaces the fields an operator scans
 * for at a glance — name, provider, role, model, active/internal state, linked
 * provider + its last probed health, owner, capabilities, created — and links
 * into the full detail view. Health comes from the page's session probe cache
 * ({@link ProviderHealth}); an unprobed provider reads "unchecked", never a
 * fabricated "healthy". Lifts on hover — the OS "reach for" affordance.
 */
import { Avatar, Badge, PillBadge, SectionCard, StatusDot } from '@khal-os/ui';
import type { AgentRow, ProviderHealth, ProviderRow } from '../../api/ext';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
import { agentCapabilities, agentTypeLabel, providerBadgeVariant } from './agent-helpers';

export interface AgentCardProps {
  agent: AgentRow;
  provider?: ProviderRow;
  health?: ProviderHealth;
  onOpen: () => void;
}

function Field({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
      <span
        style={{
          fontSize: 10,
          fontFamily: T.mono,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: T.tertiary,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 12, color: T.fg, wordBreak: 'break-word', fontFamily: mono ? T.mono : undefined }}>
        {children}
      </span>
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
      style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', minWidth: 0 }}
    >
      <SectionCard padding="md" className="omni-card-hover">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <Avatar name={agent.name} size="md" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0, flex: 1 }}>
              <h3
                style={{
                  margin: 0,
                  fontSize: 15,
                  fontWeight: 650,
                  letterSpacing: '-0.01em',
                  color: T.fg,
                  wordBreak: 'break-word',
                }}
              >
                {agent.name}
              </h3>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <PillBadge size="sm" variant="accent" dot dotColor={T.accent}>
                  {agent.provider}
                </PillBadge>
                <Badge variant={providerBadgeVariant(agent.provider)}>{agentTypeLabel(agent.agentType)}</Badge>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <StatusDot state={agent.isActive ? 'active' : 'idle'} size="sm" pulse={agent.isActive} />
                <Badge variant={agent.isActive ? 'green' : 'gray'}>{agent.isActive ? 'active' : 'inactive'}</Badge>
              </span>
              {agent.isInternal && <Badge variant="blue">internal</Badge>}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, minWidth: 0 }}>
            <Field label="Model" mono>
              {agent.model || '—'}
            </Field>
            <Field label="Owner" mono>
              {agent.ownerId ? `${agent.ownerId.slice(0, 8)}…` : '—'}
            </Field>
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

          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span
              style={{
                fontSize: 10,
                fontFamily: T.mono,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: T.tertiary,
              }}
            >
              Capabilities
            </span>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              {caps.length === 0 ? (
                <span style={{ fontSize: 12, color: T.muted }}>none declared</span>
              ) : (
                caps.map((cap) => (
                  <PillBadge key={cap} size="sm" variant="muted">
                    {cap}
                  </PillBadge>
                ))
              )}
            </div>
          </div>
        </div>
      </SectionCard>
    </button>
  );
}
