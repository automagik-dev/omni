'use client';

/**
 * Shared building blocks for the instance detail tabs: a tab bar, a titled
 * panel, and the {@link ActionButton} workhorse — a button that gates any live
 * mutation through {@link ConfirmDialog} (target name + id + effect label) and
 * renders the outcome as a {@link LiveTestResult} evidence panel. Every
 * lifecycle and sub-resource action in this slice runs through it, so the
 * safety and evidence contract is uniform.
 */
import { Button } from '@khal-os/ui';
import { type ReactNode, useState } from 'react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { LiveTestResult, type LiveTestStatus } from '../../components/LiveTestResult';
import { EFFECTS, type EffectLabel } from '../../components/effect';
import { T } from '../../components/tokens';

export interface TabDef {
  id: string;
  label: string;
  /** Hidden when false (channel-gated tabs). */
  when?: boolean;
}

export function Tabs({ tabs, active, onChange }: { tabs: TabDef[]; active: string; onChange: (id: string) => void }) {
  const visible = tabs.filter((t) => t.when !== false);
  return (
    <div
      role="tablist"
      style={{
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
        borderBottom: `1px solid ${T.border}`,
        paddingBottom: 2,
      }}
    >
      {visible.map((tab) => {
        const on = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tab.id)}
            style={{
              padding: '7px 12px',
              border: 'none',
              borderBottom: `2px solid ${on ? T.accent : 'transparent'}`,
              background: 'transparent',
              color: on ? T.fg : T.muted,
              fontSize: 13,
              fontWeight: on ? 600 : 500,
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 16,
        borderRadius: 10,
        border: `1px solid ${T.border}`,
        background: T.surface,
        minWidth: 0,
      }}
    >
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {title && <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.fg }}>{title}</h3>}
            {description && <span style={{ fontSize: 12, color: T.muted }}>{description}</span>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export interface ActionButtonProps {
  label: string;
  effect: EffectLabel;
  targetName: string;
  targetId: string;
  /** The mutation. Returns evidence rendered in the result panel. */
  run: () => Promise<unknown>;
  /** Human name of the check shown in the evidence panel. */
  resultName?: string;
  confirmTitle?: string;
  confirmDescription?: ReactNode;
  /** Force typed-phrase confirmation (defaults to the effect's mutating flag). */
  destructive?: boolean;
  disabled?: boolean;
  /** Shown as a tooltip and disables the button (e.g. production guard). */
  disabledReason?: string;
  variant?: 'default' | 'secondary';
  size?: 'small' | 'medium';
  /** Called after a successful run, e.g. to invalidate a list. */
  onDone?: (result: unknown) => void;
}

/**
 * Run one guarded action and show its evidence. Read-only effects run on click;
 * mutating effects open a ConfirmDialog first. The result — pass/fail, latency,
 * and the raw response — renders below via {@link LiveTestResult}.
 */
export function ActionButton({
  label,
  effect,
  targetName,
  targetId,
  run,
  resultName,
  confirmTitle,
  confirmDescription,
  destructive,
  disabled,
  disabledReason,
  variant = 'secondary',
  size = 'small',
  onDone,
}: ActionButtonProps) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<LiveTestStatus | null>(null);
  const [message, setMessage] = useState<string | undefined>();
  const [evidence, setEvidence] = useState<unknown>();
  const [latency, setLatency] = useState<number | undefined>();
  const gated = EFFECTS[effect].mutating;

  const execute = async () => {
    setStatus('pending');
    setMessage(undefined);
    setEvidence(undefined);
    const started = performance.now();
    try {
      const result = await run();
      setLatency(Math.round(performance.now() - started));
      setStatus('pass');
      setEvidence(result);
      onDone?.(result);
    } catch (err) {
      setLatency(Math.round(performance.now() - started));
      setStatus('fail');
      setMessage(err instanceof Error ? err.message : 'Action failed');
    }
  };

  const onClick = () => {
    if (disabled || disabledReason) return;
    if (gated) setOpen(true);
    else void execute();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div title={disabledReason}>
        <Button
          size={size}
          variant={variant}
          disabled={disabled || Boolean(disabledReason) || status === 'pending'}
          onClick={onClick}
        >
          {status === 'pending' ? 'Working…' : label}
        </Button>
      </div>

      {gated && (
        <ConfirmDialog
          open={open}
          onClose={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            void execute();
          }}
          title={confirmTitle ?? label}
          targetName={targetName}
          targetId={targetId}
          effect={effect}
          description={confirmDescription}
          destructive={destructive}
          confirmLabel={label}
        />
      )}

      {status && (
        <LiveTestResult
          name={resultName ?? label}
          effect={effect}
          status={status}
          message={message}
          evidence={evidence}
          latencyMs={latency}
        />
      )}
    </div>
  );
}

/** A single-input tool: a labelled field plus a submit button that runs an action with the value. */
export function ToolRow({
  label,
  placeholder,
  buttonLabel,
  effect,
  targetName,
  targetId,
  run,
  disabledReason,
  destructive,
}: {
  label: string;
  placeholder?: string;
  buttonLabel: string;
  effect: EffectLabel;
  targetName: string;
  targetId: string;
  run: (value: string) => Promise<unknown>;
  disabledReason?: string;
  destructive?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: T.fg }}>{label}</span>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          style={{
            flex: 1,
            minWidth: 180,
            padding: '7px 10px',
            borderRadius: 8,
            border: `1px solid ${T.border}`,
            background: T.surface,
            color: T.fg,
            fontSize: 13,
          }}
        />
        <ActionButton
          label={buttonLabel}
          effect={effect}
          targetName={targetName}
          targetId={targetId}
          disabledReason={value.trim() ? disabledReason : 'Enter a value first'}
          destructive={destructive}
          run={() => run(value.trim())}
        />
      </div>
    </div>
  );
}
