'use client';

/**
 * Confirmation gate for actions. Always shows, read-only, exactly *what* is being
 * acted on (target name + id) and *how hard* the action hits (its
 * {@link EffectLabel}). Destructive actions additionally require typing the
 * target's confirm phrase, so a "live" delete can't be one mis-click away.
 *
 * The safety logic (effect gate, confirm phrase, target/ID display) is unchanged;
 * only the presentation is KhalOS-native — a raised GlassCard body with DataRow
 * target/ID and an effect PillBadge.
 */
import { DataRow, Dialog, GlassCard, Input } from '@khal-os/ui';
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { EffectBadge } from './EffectBadge';
import { EFFECTS, type EffectLabel, confirmSatisfied } from './effect';
import { T } from './tokens';

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  /** Human name of the thing being acted on. */
  targetName: string;
  /** Stable id of the target — shown read-only so there's no ambiguity. */
  targetId: string;
  effect: EffectLabel;
  description?: ReactNode;
  /** Require the operator to type the confirm phrase (default: `live` effects). */
  destructive?: boolean;
  /** Phrase to type; defaults to the target name. */
  confirmPhrase?: string;
  confirmLabel?: string;
  pending?: boolean;
  /** Block confirmation even when the phrase is satisfied (e.g. an invalid value in `description`). */
  confirmDisabled?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  targetName,
  targetId,
  effect,
  description,
  destructive,
  confirmPhrase,
  confirmLabel = 'Confirm',
  pending = false,
  confirmDisabled = false,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const inputId = useId();
  const requireType = destructive ?? EFFECTS[effect].mutating;
  const phrase = confirmPhrase ?? targetName;
  const canConfirm = !pending && !confirmDisabled && confirmSatisfied(typed, phrase, requireType);

  return (
    <Dialog open={open} onClose={onClose}>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Body>
        <GlassCard variant="raised" padding="md">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <EffectBadge effect={effect} title />
              <span style={{ fontSize: 12, color: T.muted }}>{EFFECTS[effect].description}</span>
            </div>

            <div
              style={{
                borderRadius: T.radius,
                border: `1px solid ${T.border}`,
                background: T.cell,
                padding: '2px 12px',
              }}
            >
              <DataRow variant="rule" label="Target" value={targetName} />
              <DataRow variant="rule" label="ID" value={targetId} accentColor={T.tertiary} />
            </div>

            {description && <div style={{ fontSize: 13, color: T.fg }}>{description}</div>}

            {requireType && (
              <label htmlFor={inputId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, color: T.muted }}>
                  Type <code style={{ color: T.fg, fontFamily: T.mono }}>{phrase}</code> to confirm
                </span>
                <Input
                  id={inputId}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  style={{
                    fontFamily: T.mono,
                    borderColor: canConfirm ? T.ok : undefined,
                  }}
                />
              </label>
            )}
          </div>
        </GlassCard>
      </Dialog.Body>
      <Dialog.Actions>
        <Dialog.Cancel onClick={onClose}>Cancel</Dialog.Cancel>
        <Dialog.Confirm
          disabled={!canConfirm}
          onClick={() => {
            if (canConfirm) onConfirm();
          }}
        >
          {pending ? 'Working…' : confirmLabel}
        </Dialog.Confirm>
      </Dialog.Actions>
    </Dialog>
  );
}
