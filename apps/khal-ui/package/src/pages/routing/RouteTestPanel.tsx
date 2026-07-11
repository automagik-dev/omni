'use client';

/**
 * Route Test — a synthetic decision explainer. There is NO server-side route-test
 * endpoint, so this assembles the dispatcher's decision from real reads (the
 * instance's routes + the winning route's agent + that agent's provider health +
 * a real access check for the simulated identity) and explains where an inbound
 * message WOULD land. It never sends a message; every read is observe-only and
 * the panel is labelled SYNTHETIC.
 */
import { Button, Input, Note, StatusDot } from '@khal-os/ui';
import type { Instance } from '@omni/sdk';
import { useState } from 'react';
import type { AgentRow, ProviderHealth } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { EffectBadge } from '../../components/EffectBadge';
import { T } from '../../components/tokens';
import { Panel } from '../instances/components';
import { type DecisionOutcome, type RouteDecision, explainRouteDecision, pickWinningRoute } from './routing-helpers';

const OUTCOME_DOT: Record<DecisionOutcome, 'active' | 'away' | 'error' | 'idle'> = {
  pass: 'active',
  warn: 'away',
  fail: 'error',
  info: 'idle',
};

const MESSAGE_TYPES = ['text', 'image', 'audio', 'document', 'reaction'];

export function RouteTestPanel({ instances }: { instances: Instance[] }) {
  const { ext } = useOmniClient();
  const [instanceId, setInstanceId] = useState('');
  const [identity, setIdentity] = useState('');
  const [messageType, setMessageType] = useState('text');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<RouteDecision | null>(null);

  const instance = instances.find((i) => i.id === instanceId) ?? null;
  const canRun = Boolean(instanceId && identity);

  const run = async () => {
    if (!instance) return;
    setRunning(true);
    setError(null);
    setDecision(null);
    try {
      const routesRes = await ext.instances.listRoutes(instanceId);
      const routes = routesRes.items ?? [];
      const winning = pickWinningRoute(routes);

      let agent: AgentRow | null = null;
      let providerHealth: ProviderHealth | null = null;
      if (winning?.agentId) {
        try {
          agent = (await ext.agents.get(winning.agentId)).data ?? null;
        } catch {
          agent = null;
        }
        if (agent?.agentProviderId) {
          try {
            providerHealth = await ext.providers.health(agent.agentProviderId);
          } catch (err) {
            providerHealth = { healthy: false, error: err instanceof Error ? err.message : 'probe failed' };
          }
        }
      }

      const access =
        (await ext.access.check({ instanceId, platformUserId: identity, channel: instance.channel })).data ?? null;

      setDecision(
        explainRouteDecision({ instanceName: instance.name, routes, access, agent, providerHealth, messageType }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Route test failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <Panel
      title="Route test"
      description="Explain where a simulated inbound would land — without sending anything."
      actions={<EffectBadge effect="synthetic" title />}
    >
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
          <span style={{ fontSize: 12, color: T.muted }}>Instance</span>
          <select value={instanceId} onChange={(e) => setInstanceId(e.target.value)} style={selectStyle}>
            <option value="">— pick an instance —</option>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.channel})
              </option>
            ))}
          </select>
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
          <span style={{ fontSize: 12, color: T.muted }}>Simulated identity (phone / user id)</span>
          <Input value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="5511999999999" />
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 12, color: T.muted }}>Message type</span>
          <select value={messageType} onChange={(e) => setMessageType(e.target.value)} style={selectStyle}>
            {MESSAGE_TYPES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <Button size="small" variant="default" disabled={!canRun || running} onClick={() => void run()}>
          {running ? 'Explaining…' : 'Explain decision'}
        </Button>
      </div>

      {error && <Note type="error">{error}</Note>}

      {decision && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 14,
            borderRadius: 10,
            border: `1px solid ${T.border}`,
            borderLeft: `3px solid ${T.accent}`,
            background: T.surface,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600, color: T.fg }}>{decision.verdict}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {decision.steps.map((s) => (
              <div key={s.label} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <StatusDot state={OUTCOME_DOT[s.outcome]} size="sm" />
                <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: T.fg }}>{s.label}</span>
                  <span style={{ fontSize: 12, color: T.muted }}>{s.detail}</span>
                </div>
              </div>
            ))}
          </div>
          <span style={{ fontSize: 11, color: T.muted }}>
            Synthetic — assembled from real reads (routes + agent + provider health + access check). No message was
            sent.
          </span>
        </div>
      )}
    </Panel>
  );
}

const selectStyle = {
  padding: '7px 10px',
  borderRadius: 8,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.fg,
  fontSize: 13,
} as const;
