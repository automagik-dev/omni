'use client';

/**
 * Evidence panel shown after a mutation. Instead of a toast that says "saved",
 * it shows proof the write landed: the request that was sent, the raw response,
 * and a field-level diff of the entity re-fetched afterwards. Payloads render
 * through {@link JsonInspector} so secrets stay redacted; the read-back diff
 * renders as mono {@link DataRow}s inside an inset SectionCard.
 */
import { DataRow, SectionCard } from '@khal-os/ui';
import type { ReactNode } from 'react';
import { EffectBadge } from './EffectBadge';
import { JsonInspector } from './JsonInspector';
import { SectionHead } from './ResourceDetail';
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
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <SectionHead>{title}</SectionHead>
        {extra}
      </div>
      {children}
    </section>
  );
}

function short(value: unknown): string {
  const s = JSON.stringify(value);
  if (s === undefined) return 'undefined';
  return s.length > 60 ? `${s.slice(0, 60)}…` : s;
}

export function MutationResult({ effect, request, response, before, after, error, pending }: MutationResultProps) {
  const changes = before !== undefined || after !== undefined ? diffEntities(before, after) : [];

  return (
    <SectionCard variant="inset" padding="md" style={error ? { borderColor: T.danger } : undefined}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
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
            extra={
              <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>
                {changes.length} changed
              </span>
            }
          >
            {changes.length === 0 ? (
              <span style={{ fontSize: 12, color: T.muted }}>No fields changed on re-fetch.</span>
            ) : (
              <div>
                {changes.map((c) => (
                  <DataRow
                    key={c.key}
                    variant="rule"
                    label={c.key}
                    value={`${short(c.before)} → ${short(c.after)}`}
                    accentColor={T.accent}
                  />
                ))}
              </div>
            )}
          </Panel>
        )}
      </div>
    </SectionCard>
  );
}
