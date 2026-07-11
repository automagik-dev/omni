'use client';

/** Small pill showing an action's {@link EffectLabel} with its safety color. */
import { EFFECTS, type EffectLabel } from './effect';

export function EffectBadge({ effect, title }: { effect: EffectLabel; title?: boolean }) {
  const meta = EFFECTS[effect];
  return (
    <span
      title={title ? meta.description : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.06em',
        color: meta.color,
        border: `1px solid ${meta.color}`,
        background: 'transparent',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: meta.color }} />
      {meta.label}
    </span>
  );
}
