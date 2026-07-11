'use client';

/** Small pill showing an action's {@link EffectLabel} with its safety color. */
import { PillBadge } from '@khal-os/ui';
import { EFFECTS, type EffectLabel } from './effect';

export function EffectBadge({ effect, title }: { effect: EffectLabel; title?: boolean }) {
  const meta = EFFECTS[effect];
  return (
    <PillBadge
      size="sm"
      variant="default"
      dot
      dotColor={meta.color}
      title={title ? meta.description : undefined}
      style={{ color: meta.color, borderColor: 'currentColor' }}
    >
      {meta.label}
    </PillBadge>
  );
}
