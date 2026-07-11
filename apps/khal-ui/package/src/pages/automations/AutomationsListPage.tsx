'use client';

/**
 * Automations list — event-driven workflows. Each automation is a SectionCard
 * whose trigger→actions read as an IF/THEN DataRow tag-chain, with a gated
 * enable/disable Toggle (routed through {@link ConfirmDialog}, so flipping it
 * still names the target and its blast radius). Below the list sit the engine
 * metrics and the global execution log, so an operator sees config and live
 * behaviour on one screen.
 */
import { Button, DataRow, EmptyState, Note, PillBadge, SectionCard, Spinner, Toggle } from '@khal-os/ui';
import { type KeyboardEvent as ReactKeyboardEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AutomationRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { PageShell } from '../../components/PageShell';
import { T } from '../../components/tokens';
import '../../components/runtime-styles';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { AutomationGlobalLogsPanel, AutomationMetricsPanel } from './AutomationOpsPanels';
import { CreateAutomationDialog } from './CreateAutomationDialog';

export function AutomationsListPage() {
  const { ext } = useOmniClient();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);

  const automations = useOmniQuery(['automations', 'list'], () => ext.automations.list());
  const rows = automations.data?.items ?? [];

  return (
    <PageShell
      eyebrow="Agents & Automation"
      title="Automations"
      description="Event-driven workflows — triggers, conditions, and actions."
      actions={
        <div style={{ display: 'flex', gap: 8 }}>
          <Button size="small" variant="secondary" onClick={() => void automations.refetch()}>
            Refresh
          </Button>
          <Button size="small" variant="default" onClick={() => setCreating(true)}>
            New automation
          </Button>
        </div>
      }
    >
      {automations.error && <Note type="error">{(automations.error as Error).message}</Note>}

      {automations.isLoading && rows.length === 0 ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}>
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <SectionCard padding="lg">
          <EmptyState
            title="No automations"
            description="Create one to react to events with actions."
            action={
              <Button size="small" variant="default" onClick={() => setCreating(true)}>
                New automation
              </Button>
            }
          />
        </SectionCard>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((a, i) => (
            <AutomationCard
              key={a.id}
              automation={a}
              index={i}
              onOpen={() => navigate(`/automations/${a.id}`)}
              onChanged={() => void automations.refetch()}
            />
          ))}
        </div>
      )}

      <AutomationMetricsPanel />
      <AutomationGlobalLogsPanel />

      <CreateAutomationDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => {
          void automations.refetch();
          navigate(`/automations/${id}`);
        }}
      />
    </PageShell>
  );
}

function AutomationCard({
  automation: a,
  index,
  onOpen,
  onChanged,
}: {
  automation: AutomationRow;
  index: number;
  onOpen: () => void;
  onChanged: () => void;
}) {
  const { ext } = useOmniClient();
  const [confirm, setConfirm] = useState(false);
  const [working, setWorking] = useState(false);
  const actionCount = a.actions?.length ?? 0;

  const runToggle = async () => {
    setWorking(true);
    try {
      await (a.enabled ? ext.automations.disable(a.id) : ext.automations.enable(a.id));
      onChanged();
    } finally {
      setWorking(false);
      setConfirm(false);
    }
  };

  return (
    <SectionCard
      padding="md"
      className="omni-card-hover khal-anim-fade-up"
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e: ReactKeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{ cursor: 'pointer', animationDelay: `${index * 50}ms` }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontSize: 15, fontWeight: 650, color: T.fg, letterSpacing: '-0.01em', flex: 1, minWidth: 0 }}>
            {a.name}
          </span>
          <PillBadge size="sm" variant="muted">
            prio {a.priority ?? 0}
          </PillBadge>
          {/* Toggle owns its own click so flipping enable never also navigates. */}
          <span
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="presentation"
          >
            <span
              style={{
                fontSize: 10.5,
                fontFamily: T.mono,
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                color: a.enabled ? T.ok : T.muted,
              }}
            >
              {a.enabled ? 'on' : 'off'}
            </span>
            <Toggle checked={a.enabled} disabled={working} onChange={() => setConfirm(true)} />
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <DataRow variant="rule" tag="IF" label={a.triggerEventType} />
          <DataRow
            variant="rule"
            tag="THEN"
            tagColor={T.accentBlue}
            label={`${actionCount} action${actionCount === 1 ? '' : 's'}`}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={() => void runToggle()}
        title={a.enabled ? 'Disable automation' : 'Enable automation'}
        targetName={a.name}
        targetId={a.id}
        effect="live"
        description={a.enabled ? 'Stops this automation from firing.' : 'This automation will fire on matching events.'}
        pending={working}
      />
    </SectionCard>
  );
}
