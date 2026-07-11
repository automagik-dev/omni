'use client';

/**
 * Agent Lens — "Now" tab. What the agent is doing for THIS chat, right now:
 * status (from the SSE stream, one-shot GET as fallback), rendered statusMeta,
 * resolved agent/provider/route, conversation/correlation ids, a ticking
 * time-in-state, follow-up config, a read-only access decision for the chat's
 * counterpart, dependency health chips when present, and a "possibly stalled"
 * warning when the agent is busy but nothing has moved for over 60s.
 */
import { DataRow, Note, PillBadge, StatusDot } from '@khal-os/ui';
import { useEffect, useState } from 'react';
import type { ChatRow, EventRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { EffectBadge } from '../../components/EffectBadge';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { JsonInspector } from '../../components/JsonInspector';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
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

/** Mono id with a click-to-copy affordance — the standard KhalOS handle. */
function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const real = value && value !== '—';
  const copy = () => {
    if (!real) return;
    void navigator.clipboard?.writeText(value).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => void 0,
    );
  };
  return (
    <button
      type="button"
      onClick={copy}
      disabled={!real}
      className={real ? 'omni-copy' : undefined}
      title={real ? 'Copy' : undefined}
      style={{
        border: 'none',
        background: 'transparent',
        padding: 0,
        fontFamily: T.mono,
        fontSize: 11.5,
        fontVariantNumeric: 'tabular-nums',
        color: copied ? T.ok : T.secondary,
        cursor: real ? 'pointer' : 'default',
        maxWidth: 190,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {copied ? '✓ copied' : value}
    </button>
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
  const elapsedLabel = status ? formatElapsed(timeInState(snapshot, now)) : '—';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 12 }}>
      <StatusHeader status={status} agentState={agentState} />
      <StreamNotices agentState={agentState} hasSnapshot={Boolean(snapshot)} />
      {stalled && (
        <Note type="warning" label="Possibly stalled">
          Status is <strong>{status}</strong> but no transition or event for{' '}
          {formatElapsed(Math.max(timeInState(snapshot, now) ?? 0, lastEventAt ? now - lastEventAt : 0))}.
        </Note>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <SectionLabel>Binding</SectionLabel>
        <DataRow variant="rule" label="Agent" value={agentName} accentColor={agentName === '—' ? T.muted : T.fg} />
        <DataRow variant="rule" label="Provider" value={providerName} />
        <DataRow variant="rule" label="Time in state" value={elapsedLabel} statusDot dotColor={dotFor(status)} />
        <DataRow variant="rule" label="Source" value={agentState.source ?? 'stream'} />
        <DataRow variant="rule" label="Conversation">
          <CopyValue value={snapshot?.conversationId ?? chat.conversationId ?? '—'} />
        </DataRow>
        <DataRow variant="rule" label="Agent id">
          <CopyValue value={resolvedAgentId ?? '—'} />
        </DataRow>
      </div>

      {Object.keys(statusMeta).length > 0 && (
        <div>
          <SectionLabel>Status meta</SectionLabel>
          <div style={{ marginTop: 6 }}>
            <JsonInspector value={statusMeta} />
          </div>
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

function dotFor(status: string | null): string {
  const s = agentStatusDot(status);
  return s === 'working' ? T.accent : s === 'error' ? T.danger : s === 'away' ? T.warn : T.muted;
}

function StatusHeader({ status, agentState }: { status: string | null; agentState: UseAgentStateResult }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot state={agentStatusDot(status)} size="lg" pulse={agentStatusDot(status) === 'working'} />
        <span style={{ fontSize: 16, fontWeight: 650, letterSpacing: '-0.01em', color: T.fg }}>
          {status ?? 'no active state'}
        </span>
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

function DependenciesSection({ dependencies }: { dependencies: Record<string, unknown> }) {
  return (
    <div>
      <SectionLabel>Dependencies</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
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
      <SectionLabel>Follow-up</SectionLabel>
      <div style={{ marginTop: 6 }}>
        {loading ? (
          <span style={{ fontSize: 12, color: T.muted }}>Loading…</span>
        ) : config ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 12.5, color: T.fg }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <StatusDot state={config.enabled ? 'active' : 'idle'} size="sm" />
              {config.enabled ? 'Enabled' : 'Disabled'}
              {config.idleMinutes != null && (
                <span style={{ color: T.muted, fontFamily: T.mono, fontSize: 11.5 }}>· idle {config.idleMinutes}m</span>
              )}
            </span>
            {config.prompt && <div style={{ color: T.muted }}>“{config.prompt}”</div>}
          </div>
        ) : (
          <span style={{ fontSize: 12, color: T.muted }}>No follow-up configured for this chat.</span>
        )}
      </div>
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <SectionLabel>Access</SectionLabel>
        <EffectBadge effect="read-only" />
      </div>
      <div style={{ marginTop: 6 }}>
        {loading ? (
          <span style={{ fontSize: 12, color: T.muted }}>Checking…</span>
        ) : decision ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
            <PillBadge
              dot
              dotColor={decision.allowed ? T.ok : T.danger}
              variant={decision.allowed ? 'accent' : 'muted'}
            >
              {decision.allowed ? 'allowed' : 'blocked'}
            </PillBadge>
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
        <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
          Counterpart: <span style={{ fontFamily: T.mono }}>{counterpart || fallbackName}</span>
        </div>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontFamily: T.mono,
        textTransform: 'uppercase',
        letterSpacing: '0.12em',
        color: T.tertiary,
        fontWeight: 650,
      }}
    >
      {children}
    </span>
  );
}
