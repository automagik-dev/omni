'use client';

/**
 * Agent Lens — "Trace" tab. The correlated event pipeline for the selected chat,
 * derived by narrowing instance events to `chatUuid === chat.id` (the `/events`
 * chatId query is ignored server-side). Rendered as a LiveFeed-style vertical
 * timeline: each step is a stage on a connected spine with its own StatusDot,
 * type, mono latency and time. Expanding it lazily pulls the staged payloads from
 * `/events/:id/payloads` and renders everything through the redact-by-default
 * {@link JsonInspector} (which also provides "Copy redacted"). A message can be
 * highlighted to spotlight its own pipeline (join on `externalId`).
 */
import { PillBadge, StatusDot } from '@khal-os/ui';
import { useState } from 'react';
import type { ChatRow, EventPayloadRecord, EventRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { FreshnessBadge } from '../../components/FreshnessBadge';
import { JsonInspector } from '../../components/JsonInspector';
import { T } from '../../components/tokens';
import { type TraceStep, correlateChatEvents, eventCorrelationId, formatDuration, toTraceSteps } from './chat-helpers';

const OUTCOME_DOT = { ok: 'active', pending: 'queued', error: 'error' } as const;

function TraceRow({ step, highlighted, last }: { step: TraceStep; highlighted: boolean; last: boolean }) {
  const { ext } = useOmniClient();
  const [open, setOpen] = useState(false);
  const [payloads, setPayloads] = useState<EventPayloadRecord[] | null>(null);
  const [loadingPayloads, setLoadingPayloads] = useState(false);
  const { event } = step;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && payloads === null && !loadingPayloads) {
      setLoadingPayloads(true);
      try {
        const res = await ext.events.payloads(event.id);
        setPayloads(res.items ?? []);
      } catch {
        setPayloads([]);
      } finally {
        setLoadingPayloads(false);
      }
    }
  };

  const time = step.time
    ? new Date(step.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';
  const correlationId = eventCorrelationId(event);

  return (
    <div
      style={{
        position: 'relative',
        paddingLeft: 22,
        background: highlighted ? 'color-mix(in oklch, var(--khal-accent) 8%, transparent)' : 'transparent',
        borderRadius: 8,
      }}
    >
      {/* timeline spine + node */}
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 6,
          top: 18,
          bottom: last && !open ? undefined : -2,
          height: last && !open ? 0 : undefined,
          width: 1,
          background: T.border,
        }}
      />
      <span style={{ position: 'absolute', left: 2, top: 9 }}>
        <StatusDot state={OUTCOME_DOT[step.outcome]} size="sm" pulse={step.outcome === 'pending'} />
      </span>

      <button
        type="button"
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          width: '100%',
          textAlign: 'left',
          padding: '5px 4px',
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: T.fg }}>{event.eventType}</span>
          {event.direction && <span style={{ fontSize: 11, color: T.muted }}> · {event.direction}</span>}
          {event.errorStage && <span style={{ fontSize: 11, color: T.danger }}> · {event.errorStage}</span>}
        </span>
        <span style={{ fontSize: 11, color: T.secondary, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>
          {formatDuration(step.durationMs)}
        </span>
        <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>
          {time}
        </span>
        <span style={{ color: T.muted, fontSize: 11 }}>{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '2px 0 12px' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '3px 10px',
              fontSize: 11,
              padding: '8px 10px',
              borderRadius: 8,
              background: T.sunken,
              border: `1px solid ${T.borderSubtle}`,
            }}
          >
            <span style={{ color: T.muted }}>status</span>
            <span style={{ color: event.errorMessage ? T.danger : T.fg }}>
              {event.status ?? '—'}
              {event.errorMessage ? ` — ${event.errorMessage}` : ''}
            </span>
            <span style={{ color: T.muted }}>externalId</span>
            <span style={{ fontFamily: T.mono, color: T.fg, wordBreak: 'break-all' }}>{event.externalId ?? '—'}</span>
            <span style={{ color: T.muted }}>correlation</span>
            <span style={{ fontFamily: T.mono, color: T.fg, wordBreak: 'break-all' }}>{correlationId ?? '—'}</span>
            <span style={{ color: T.muted }}>latency</span>
            <span style={{ color: T.fg, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>
              total {formatDuration(event.totalLatencyMs)} · agent {formatDuration(event.agentLatencyMs)} · proc{' '}
              {formatDuration(event.processingTimeMs)}
            </span>
          </div>

          <div>
            <div style={miniLabel}>Event</div>
            <JsonInspector value={event} />
          </div>

          <div>
            <div style={miniLabel}>Payload stages</div>
            {loadingPayloads ? (
              <span style={{ fontSize: 11, color: T.muted }}>Loading…</span>
            ) : payloads && payloads.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {payloads.map((p, i) => (
                  <div key={p.id ?? `${event.id}-${i}`}>
                    <div style={{ fontSize: 10.5, color: T.accent, fontFamily: T.mono, marginBottom: 2 }}>
                      {p.stage ?? `stage ${i + 1}`}
                    </div>
                    <JsonInspector value={p.payload ?? p} />
                  </div>
                ))}
              </div>
            ) : (
              <span style={{ fontSize: 11, color: T.muted }}>No staged payloads recorded for this event.</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function AgentLensTrace({
  chat,
  events,
  messageExternalIds,
  lastPolledAt,
  degraded,
  highlightExternalId,
}: {
  chat: ChatRow;
  events: EventRow[];
  messageExternalIds: ReadonlySet<string>;
  lastPolledAt: number | undefined;
  degraded: boolean;
  highlightExternalId?: string | null;
}) {
  const steps = toTraceSteps(correlateChatEvents(events, chat.id, messageExternalIds)).reverse(); // newest first

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <PillBadge size="sm" variant="muted" dot dotColor={T.accent}>
          {steps.length} event{steps.length === 1 ? '' : 's'}
        </PillBadge>
        <FreshnessBadge observedAt={lastPolledAt} source="events 5s" degraded={degraded} />
      </div>
      {steps.length === 0 ? (
        <span style={{ fontSize: 12.5, color: T.muted }}>
          No events correlated to this chat yet. Events appear here as messages flow through the pipeline.
        </span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {steps.map((step, i) => (
            <TraceRow
              key={step.event.id}
              step={step}
              last={i === steps.length - 1}
              highlighted={Boolean(highlightExternalId && step.event.externalId === highlightExternalId)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

const miniLabel = {
  fontSize: 10,
  fontFamily: T.mono,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.1em',
  color: T.tertiary,
  marginBottom: 4,
  fontWeight: 650,
};
