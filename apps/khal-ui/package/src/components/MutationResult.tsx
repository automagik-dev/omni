'use client';

/**
 * Evidence panel shown after a mutation. Instead of a toast that says "saved",
 * it shows proof the write landed: the request that was sent, the raw response,
 * and a field-level diff of the entity re-fetched afterwards. Payloads render
 * through {@link JsonInspector} so secrets stay redacted.
 */
import type { ReactNode } from 'react';
import { EffectBadge } from './EffectBadge';
import { JsonInspector } from './JsonInspector';
import { diffEntities } from './diff';
import type { EffectLabel } from './effect';
import { T } from './tokens';

export interface MutationRequestSummary {
  method?: string;
  path?: string;
  body?: unknown;
}

export interface MutationResultProps {
  effect?: EffectLabel;
  request?: MutationRequestSummary;
  response?: unknown;
  /** Entity before the mutation and the re-fetched entity after, for a diff. */
  before?: unknown;
  after?: unknown;
  error?: string | null;
  pending?: boolean;
}

function Panel({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <h4 style={{ margin: 0, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.muted }}>
          {title}
        </h4>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function MutationResult({ effect, request, response, before, after, error, pending }: MutationResultProps) {
  const changes = before !== undefined || after !== undefined ? diffEntities(before, after) : [];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        padding: 16,
        borderRadius: 10,
        border: `1px solid ${error ? T.danger : T.border}`,
        background: T.surface,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ fontSize: 13, color: T.fg }}>{pending ? 'Applying…' : error ? 'Failed' : 'Result'}</strong>
        {effect && <EffectBadge effect={effect} />}
      </div>

      {error && <div style={{ fontSize: 13, color: T.danger }}>{error}</div>}

      {request && (
        <Panel title="Request">
          <div style={{ fontFamily: T.mono, fontSize: 12, color: T.fg }}>
            <span style={{ color: T.accentBlue }}>{request.method ?? 'POST'}</span> {request.path}
          </div>
          {request.body !== undefined && <JsonInspector value={request.body} />}
        </Panel>
      )}

      {response !== undefined && (
        <Panel title="Response">
          <JsonInspector value={response} />
        </Panel>
      )}

      {(before !== undefined || after !== undefined) && (
        <Panel
          title="Read-back diff"
          extra={<span style={{ fontSize: 11, color: T.muted }}>{changes.length} changed</span>}
        >
          {changes.length === 0 ? (
            <span style={{ fontSize: 12, color: T.muted }}>No fields changed on re-fetch.</span>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {changes.map((c) => (
                <div
                  key={c.key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '160px 1fr 1fr',
                    gap: 8,
                    fontFamily: T.mono,
                    fontSize: 12,
                    alignItems: 'baseline',
                  }}
                >
                  <span style={{ color: T.accentBlue }}>{c.key}</span>
                  <span style={{ color: T.danger, textDecoration: 'line-through', wordBreak: 'break-all' }}>
                    {JSON.stringify(c.before)}
                  </span>
                  <span style={{ color: T.ok, wordBreak: 'break-all' }}>{JSON.stringify(c.after)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
