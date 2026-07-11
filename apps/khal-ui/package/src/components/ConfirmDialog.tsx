'use client';

/**
 * Confirmation gate for actions. Always shows, read-only, exactly *what* is being
 * acted on (target name + id) and *how hard* the action hits (its
 * {@link EffectLabel}). Destructive actions additionally require typing the
 * target's confirm phrase, so a "live" delete can't be one mis-click away.
 */
import { Dialog } from '@khal-os/ui';
import { useState } from 'react';
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
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const requireType = destructive ?? EFFECTS[effect].mutating;
  const phrase = confirmPhrase ?? targetName;
  const canConfirm = !pending && confirmSatisfied(typed, phrase, requireType);

  return (
    <Dialog open={open} onClose={onClose}>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <EffectBadge effect={effect} title />
            <span style={{ fontSize: 12, color: T.muted }}>{EFFECTS[effect].description}</span>
          </div>

          <dl
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '4px 12px',
              margin: 0,
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: T.sunken,
            }}
          >
            <dt style={{ fontSize: 12, color: T.muted }}>Target</dt>
            <dd style={{ margin: 0, fontSize: 13, color: T.fg, fontWeight: 600 }}>{targetName}</dd>
            <dt style={{ fontSize: 12, color: T.muted }}>ID</dt>
            <dd style={{ margin: 0, fontSize: 12, color: T.fg, fontFamily: T.mono, wordBreak: 'break-all' }}>
              {targetId}
            </dd>
          </dl>

          {description && <div style={{ fontSize: 13, color: T.fg }}>{description}</div>}

          {requireType && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, color: T.muted }}>
                Type <code style={{ color: T.fg, fontFamily: T.mono }}>{phrase}</code> to confirm
              </span>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                style={{
                  padding: '7px 10px',
                  borderRadius: 8,
                  border: `1px solid ${canConfirm ? T.ok : T.border}`,
                  background: T.surface,
                  color: T.fg,
                  fontSize: 13,
                  fontFamily: T.mono,
                }}
              />
            </label>
          )}
        </div>
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
