'use client';

/**
 * Agent Lens — "Now" tab. What the agent is doing for THIS chat, right now:
 * status (from the SSE stream, one-shot GET as fallback), rendered statusMeta,
 * resolved agent/provider/route, conversation/correlation ids, a ticking
 * time-in-state, follow-up config, a read-only access decision for the chat's
 * counterpart, dependency health chips when present, and a "possibly stalled"
 * warning when the agent is busy but nothing has moved for over 60s.
 */
import { PillBadge, StatusDot } from '@khal-os/ui';
import { useEffect, useState } from 'react';
import type { ChatRow, EventRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { EffectBadge } from '../../components/EffectBadge';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { JsonInspector } from '../../components/JsonInspector';
import { T } from '../../components/tokens';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import {
  agentStatusDot,
  chatDisplayName,
  correlateChatEvents,
  eventTime,
  isPossiblyStalled,
  stripJid,
  timeInState,
} from './chat-helpers';
import type { Resolvers } from './useChatData';
import type { UseAgentStateResult } from './useChatData';

function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function formatElapsed(ms: number | null): string {
  if (ms == null) return '—';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.05em', color: T.muted }}>
        {label}
      </span>
      <span style={{ fontSize: 12.5, color: T.fg, wordBreak: 'break-word' }}>{children}</span>
    </div>
  );
}

export function AgentLensNow({
  chat,
  agentState,
  resolvers,
  events,
  messageExternalIds,
}: {
  chat: ChatRow;
  agentState: UseAgentStateResult;
  resolvers: Resolvers;
  events: EventRow[];
  messageExternalIds: ReadonlySet<string>;
}) {
  const { ext } = useOmniClient();
  const now = useNow();
  const snapshot = agentState.snapshot;
  const status = snapshot?.status ?? null;

  const chatEvents = correlateChatEvents(events, chat.id, messageExternalIds);
  const lastEventAt = chatEvents.length > 0 ? Math.max(...chatEvents.map(eventTime)) : null;
  const stalled = isPossiblyStalled(snapshot ?? null, lastEventAt, now);

  // Resolve the likely agent for this chat (route-based fallback if no snapshot).
  const resolvedAgentId = snapshot?.agentId ?? resolvers.resolveAgentForChat(chat.instanceId, chat.id);
  const agentName = resolvers.agentName(resolvedAgentId) ?? resolvedAgentId ?? '—';
  const providerId = resolvers.agentProviderId(resolvedAgentId);
  const providerName = resolvers.providerName(providerId) ?? providerId ?? '—';

  // Follow-up config for this chat.
  const followUp = useOmniQuery(['follow-up', 'chat', chat.id], () => ext.followUp.getForChat(chat.id), {
    staleTime: 30_000,
  });
  const fu = followUp.data?.data ?? null;

  // Read-only access decision for the chat's counterpart.
  const counterpart = stripJid(chat.externalId);
  const access = useOmniQuery(
    ['access', 'check', chat.instanceId, counterpart],
    () => ext.access.check({ instanceId: chat.instanceId, platformUserId: counterpart, channel: chat.channel }),
    { enabled: Boolean(counterpart), staleTime: 60_000 },
  );
  const decision = access.data?.data ?? null;

  const statusMeta = (snapshot?.statusMeta ?? {}) as Record<string, unknown>;
  const dependencies = (statusMeta.dependencies ?? statusMeta.health ?? null) as Record<string, unknown> | null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 12 }}>
      <StatusHeader status={status} agentState={agentState} />
      <StreamNotices agentState={agentState} hasSnapshot={Boolean(snapshot)} />
      {stalled && (
        <StallBanner
          status={status}
          elapsedMs={Math.max(timeInState(snapshot, now) ?? 0, lastEventAt ? now - lastEventAt : 0)}
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Field label="Agent">
          <span style={{ fontWeight: 600 }}>{agentName}</span>
        </Field>
        <Field label="Provider">{providerName}</Field>
        <Field label="Time in state">{status ? formatElapsed(timeInState(snapshot, now)) : '—'}</Field>
        <Field label="Source">{agentState.source ?? 'stream'}</Field>
        <Field label="Conversation">
          <span style={{ fontFamily: T.mono, fontSize: 11.5 }}>
            {snapshot?.conversationId ?? chat.conversationId ?? '—'}
          </span>
        </Field>
        <Field label="Agent id">
          <span style={{ fontFamily: T.mono, fontSize: 11.5 }}>{resolvedAgentId ?? '—'}</span>
        </Field>
      </div>

      {Object.keys(statusMeta).length > 0 && (
        <div>
          <div style={sectionLabel}>Status meta</div>
          <JsonInspector value={statusMeta} />
        </div>
      )}

      {dependencies && <DependenciesSection dependencies={dependencies} />}
      <FollowUpSection loading={followUp.isLoading} config={fu} />
      <AccessSection
        loading={access.isLoading}
        decision={decision}
        counterpart={counterpart}
        fallbackName={chatDisplayName(chat)}
      />
    </div>
  );
}

function StatusHeader({ status, agentState }: { status: string | null; agentState: UseAgentStateResult }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusDot state={agentStatusDot(status)} size="md" />
        <span style={{ fontSize: 15, fontWeight: 650, color: T.fg }}>{status ?? 'no active state'}</span>
      </div>
      <FreshnessBadge
        observedAt={agentState.lastChangeAt}
        source={agentState.source === 'one-shot' ? 'one-shot' : 'SSE'}
        degraded={agentState.degraded}
      />
    </div>
  );
}

function StreamNotices({ agentState, hasSnapshot }: { agentState: UseAgentStateResult; hasSnapshot: boolean }) {
  if (agentState.degraded) {
    return (
      <div style={{ fontSize: 12, color: T.warn }}>
        Stream degraded — reconnecting. State may be stale; the thread keeps polling.
      </div>
    );
  }
  if (!hasSnapshot && agentState.streamReady) {
    return (
      <div style={{ fontSize: 12, color: T.muted }}>
        Stream connected, no state changes yet. The agent has no active state for this chat (idle), or has not
        transitioned since you opened it.
      </div>
    );
  }
  return null;
}

function StallBanner({ status, elapsedMs }: { status: string | null; elapsedMs: number }) {
  return (
    <div
      style={{
        fontSize: 12.5,
        color: T.warn,
        border: `1px solid ${T.warn}`,
        borderRadius: 8,
        padding: '8px 10px',
        background: 'color-mix(in srgb, var(--ds-amber-700, #d97706) 12%, transparent)',
      }}
    >
      ⚠ Possibly stalled — status is <strong>{status}</strong> but no transition or event for {formatElapsed(elapsedMs)}
      .
    </div>
  );
}

function DependenciesSection({ dependencies }: { dependencies: Record<string, unknown> }) {
  return (
    <div>
      <div style={sectionLabel}>Dependencies</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {Object.entries(dependencies).map(([name, val]) => {
          const ok = val === true || val === 'ok' || val === 'healthy' || (val as { healthy?: boolean })?.healthy;
          return (
            <PillBadge key={name} dot dotColor={ok ? T.ok : T.danger}>
              {name}
            </PillBadge>
          );
        })}
      </div>
    </div>
  );
}

function FollowUpSection({
  loading,
  config,
}: {
  loading: boolean;
  config: { enabled?: boolean; idleMinutes?: number | null; prompt?: string | null } | null;
}) {
  return (
    <div>
      <div style={sectionLabel}>Follow-up</div>
      {loading ? (
        <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
      ) : config ? (
        <div style={{ fontSize: 12.5, color: T.fg }}>
          {config.enabled ? 'Enabled' : 'Disabled'}
          {config.idleMinutes != null && ` · idle ${config.idleMinutes}m`}
          {config.prompt && <div style={{ color: T.muted, marginTop: 2 }}>“{config.prompt}”</div>}
        </div>
      ) : (
        <span style={{ fontSize: 12, color: T.muted }}>No follow-up configured for this chat.</span>
      )}
    </div>
  );
}

function AccessSection({
  loading,
  decision,
  counterpart,
  fallbackName,
}: {
  loading: boolean;
  decision: { allowed: boolean; reason?: string; mode?: string } | null;
  counterpart: string;
  fallbackName: string;
}) {
  return (
    <div>
      <div style={{ ...sectionLabel, display: 'flex', alignItems: 'center', gap: 8 }}>
        Access <EffectBadge effect="read-only" />
      </div>
      {loading ? (
        <span style={{ fontSize: 12, color: T.muted }}>Checking…</span>
      ) : decision ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <StatusDot state={decision.allowed ? 'active' : 'error'} size="sm" />
          <span style={{ color: decision.allowed ? T.ok : T.danger, fontWeight: 600 }}>
            {decision.allowed ? 'allowed' : 'blocked'}
          </span>
          <span style={{ color: T.muted }}>
            {decision.reason}
            {decision.mode ? ` (${decision.mode})` : ''}
          </span>
        </div>
      ) : (
        <span style={{ fontSize: 12, color: T.muted }}>
          No decision{counterpart ? '' : ' (group chat — no single counterpart)'}.
        </span>
      )}
      <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>
        Counterpart: <span style={{ fontFamily: T.mono }}>{counterpart || fallbackName}</span>
      </div>
    </div>
  );
}

const sectionLabel = {
  fontSize: 10.5,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.05em',
  color: T.muted,
  marginBottom: 6,
  fontWeight: 700,
};
