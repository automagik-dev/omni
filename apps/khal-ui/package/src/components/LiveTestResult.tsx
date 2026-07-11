'use client';

import { NumberFlow, StatusDot } from '@khal-os/ui';
import { EffectBadge } from './EffectBadge';
/**
 * Result of running a capability's live/dry-run test: what was run, at what blast
 * radius ({@link EffectLabel}), whether it passed, and the evidence payload that
 * proves it. The evidence renders through {@link JsonInspector} (redacted by
 * default). Powers the "verify this works against the real backend" affordance
 * later groups attach to each resource.
 */
import { JsonInspector } from './JsonInspector';
import type { EffectLabel } from './effect';
import { T } from './tokens';

export type LiveTestStatus = 'pass' | 'fail' | 'pending';

export interface LiveTestResultProps {
  name: string;
  effect: EffectLabel;
  status: LiveTestStatus;
  message?: string;
  evidence?: unknown;
  /** Observed latency in ms, if measured. */
  latencyMs?: number;
}

const STATUS_META: Record<LiveTestStatus, { label: string; color: string; state: 'online' | 'error' | 'working' }> = {
  pass: { label: 'PASS', color: T.ok, state: 'online' },
  fail: { label: 'FAIL', color: T.danger, state: 'error' },
  pending: { label: 'RUNNING', color: T.muted, state: 'working' },
};

export function LiveTestResult({ name, effect, status, message, evidence, latencyMs }: LiveTestResultProps) {
  const meta = STATUS_META[status];
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 14,
        borderRadius: T.radiusCard,
        border: `1px solid ${T.border}`,
        borderLeft: `3px solid ${meta.color}`,
        background: T.surface,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <StatusDot state={meta.state} size="sm" pulse={status === 'pending'} showLabel label={meta.label} />
        <span style={{ fontSize: 13, fontWeight: 600, color: T.fg, flex: 1, minWidth: 0 }}>{name}</span>
        {latencyMs !== undefined && (
          <span style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums' }}>
            <NumberFlow value={latencyMs} />
            ms
          </span>
        )}
        <EffectBadge effect={effect} />
      </div>

      {message && <div style={{ fontSize: 12, color: status === 'fail' ? T.danger : T.muted }}>{message}</div>}
      {evidence !== undefined && <JsonInspector value={evidence} />}
    </div>
  );
}
