'use client';

/**
 * Per-automation detail. Header carries identity, enabled state, and a gated
 * delete; tabs hold the config overview, an editor (update gated + read-back
 * diff), the test/execute run panel, and this automation's execution logs.
 */
import { Badge, Button, Note, Spinner } from '@khal-os/ui';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { AutomationRow } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { FieldGrid } from '../../components/FieldGrid';
import { JsonInspector } from '../../components/JsonInspector';
import { MutationResult } from '../../components/MutationResult';
import { PageShell } from '../../components/PageShell';
import { ResourceDetail } from '../../components/ResourceDetail';
import { useOmniQuery } from '../../hooks/useOmniQuery';
import { ActionButton, Panel, type TabDef, Tabs } from '../instances/components';
import { AutomationEditor } from './AutomationEditor';
import { AutomationLogsTab } from './AutomationLogsTab';
import { AutomationRunTab } from './AutomationRunTab';

const TABS: TabDef[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'edit', label: 'Edit' },
  { id: 'run', label: 'Test / Execute' },
  { id: 'logs', label: 'Logs' },
];

function OverviewTab({ automation }: { automation: AutomationRow }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel title="Definition">
        <FieldGrid
          fields={[
            { label: 'Name', value: automation.name },
            { label: 'Trigger', value: automation.triggerEventType, mono: true },
            { label: 'Condition logic', value: automation.conditionLogic ?? 'and' },
            { label: 'Conditions', value: automation.triggerConditions?.length ?? 0 },
            { label: 'Actions', value: automation.actions?.length ?? 0 },
            { label: 'Enabled', value: automation.enabled },
            { label: 'Priority', value: automation.priority ?? 0 },
            { label: 'Description', value: automation.description ?? '—' },
            { label: 'Created', value: automation.createdAt ?? '—', mono: true },
          ]}
        />
      </Panel>
      <Panel title="Actions">
        <JsonInspector value={automation.actions ?? []} />
      </Panel>
      {(automation.triggerConditions?.length || automation.debounce) && (
        <Panel title="Conditions & debounce">
          {automation.triggerConditions?.length ? <JsonInspector value={automation.triggerConditions} /> : null}
          {automation.debounce ? <JsonInspector value={automation.debounce} /> : null}
        </Panel>
      )}
    </div>
  );
}

function EditTab({ automation, refetch }: { automation: AutomationRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<{ before: unknown; after: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const save = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      const before = await ext.automations.get(automation.id);
      await ext.automations.patch(automation.id, pending);
      const after = await ext.automations.get(automation.id);
      setResult({ before: before.data, after: after.data });
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setWorking(false);
      setPending(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Panel title="Edit automation" description="Only sends the parts you touch; Validate first to check the body.">
        {error && <Note type="error">{error}</Note>}
        <AutomationEditor initial={automation} submitLabel="Review changes" onReady={(body) => setPending(body)} />
      </Panel>
      {result && (
        <MutationResult
          effect="live"
          request={{ method: 'PATCH', path: `/automations/${automation.id}`, body: pending ?? undefined }}
          before={result.before}
          after={result.after}
        />
      )}
      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void save()}
        title="Update automation"
        targetName={automation.name}
        targetId={automation.id}
        effect="live"
        description="Applies the edited definition to this automation."
        confirmLabel="Save"
        pending={working}
      />
    </div>
  );
}

export function AutomationDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { ext } = useOmniClient();
  const [tab, setTab] = useState('overview');

  const query = useOmniQuery(['automations', id, 'detail'], () => ext.automations.get(id), { enabled: Boolean(id) });
  const automation = query.data?.data;
  const refetch = () => void query.refetch();

  if (query.isLoading) {
    return (
      <PageShell eyebrow="Agents & Automation" title="Automation">
        <Spinner size="md" />
      </PageShell>
    );
  }

  if (query.error || !automation) {
    return (
      <PageShell
        eyebrow="Agents & Automation"
        title="Automation"
        actions={
          <Button size="small" variant="secondary" onClick={() => navigate('/automations')}>
            Back
          </Button>
        }
      >
        <Note type="error">{query.error ? (query.error as Error).message : 'Automation not found.'}</Note>
      </PageShell>
    );
  }

  return (
    <PageShell eyebrow="Agents & Automation" title={automation.name}>
      <ResourceDetail
        title={automation.name}
        id={automation.id}
        subtitle={automation.triggerEventType}
        status={
          <Badge variant={automation.enabled ? 'green' : 'gray'}>{automation.enabled ? 'enabled' : 'disabled'}</Badge>
        }
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button size="small" variant="secondary" onClick={() => navigate('/automations')}>
              Back
            </Button>
            <ActionButton
              label={automation.enabled ? 'Disable' : 'Enable'}
              effect="live"
              targetName={automation.name}
              targetId={automation.id}
              confirmDescription={
                automation.enabled
                  ? 'Stops this automation from firing.'
                  : 'This automation will fire on matching events.'
              }
              onDone={refetch}
              run={() =>
                automation.enabled ? ext.automations.disable(automation.id) : ext.automations.enable(automation.id)
              }
            />
            <ActionButton
              label="Delete"
              effect="live"
              destructive
              targetName={automation.name}
              targetId={automation.id}
              confirmDescription="Permanently deletes this automation."
              onDone={() => navigate('/automations')}
              run={() => ext.automations.remove(automation.id)}
            />
          </div>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
          <div style={{ minWidth: 0 }}>
            {tab === 'overview' && <OverviewTab automation={automation} />}
            {tab === 'edit' && <EditTab automation={automation} refetch={refetch} />}
            {tab === 'run' && <AutomationRunTab automation={automation} refetch={refetch} />}
            {tab === 'logs' && <AutomationLogsTab automation={automation} refetch={refetch} />}
          </div>
        </div>
      </ResourceDetail>
    </PageShell>
  );
}
