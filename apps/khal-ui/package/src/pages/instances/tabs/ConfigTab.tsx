'use client';

/**
 * Config tab: every editable column, grouped into {@link SchemaForm} sections
 * drawn from the API's real PATCH contract. Each section saves independently and
 * proves the write landed — the submitted body, the response, and a field-level
 * read-back diff render through {@link MutationResult}. Production instances show
 * the same forms in read-only preview. Columns the API returns but PATCH ignores
 * are listed read-only at the bottom, so nothing is silently un-editable.
 */
import { Note } from '@khal-os/ui';
import { useState } from 'react';
import { z } from 'zod';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { requirementReason, useCan } from '../../../auth';
import { JsonInspector } from '../../../components/JsonInspector';
import { MutationResult } from '../../../components/MutationResult';
import { SchemaForm } from '../../../components/SchemaForm';
import { T } from '../../../components/tokens';
import { useOmniQuery } from '../../../hooks/useOmniQuery';
import { ActionButton, Panel } from '../components';
import { type ConfigSection, READ_ONLY_CONFIG_KEYS, minimalPatch, sectionsForChannel } from '../config-schemas';
import { type InstanceTabProps, PRODUCTION_GUARD_REASON } from '../tab-types';

export function ConfigTab({ instance, isProduction, refetchInstance }: InstanceTabProps) {
  const sections = sectionsForChannel(instance.channel);
  const readOnly: Record<string, unknown> = {};
  for (const key of READ_ONLY_CONFIG_KEYS) {
    if (instance[key] !== undefined) readOnly[key] = instance[key];
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      {isProduction && (
        <Note type="warning">
          This is a production instance. Config is shown read-only — no changes can be saved from here.
        </Note>
      )}
      {sections.map((section) => (
        <ConfigSectionForm
          key={section.id}
          section={section}
          instance={instance}
          isProduction={isProduction}
          refetchInstance={refetchInstance}
        />
      ))}
      <FollowUpPanel instanceId={instance.id} instanceName={instance.name} isProduction={isProduction} />
      {Object.keys(readOnly).length > 0 && (
        <Panel
          title="Read-only fields"
          description="The API returns these but its PATCH contract does not accept them — edit via the CLI/migration."
        >
          <JsonInspector value={readOnly} />
        </Panel>
      )}
    </div>
  );
}

const followUpSchema = z.object({
  enabled: z.boolean().optional().describe('Enable idle-chat follow-ups'),
  idleMinutes: z.number().int().min(0).optional().describe('Idle minutes before a follow-up'),
  prompt: z.string().optional().describe('Follow-up prompt'),
});

function FollowUpPanel({
  instanceId,
  instanceName,
  isProduction,
}: {
  instanceId: string;
  instanceName: string;
  isProduction: boolean;
}) {
  const { ext } = useOmniClient();
  const guard = isProduction ? PRODUCTION_GUARD_REASON : undefined;
  // Saving follow-up config is an operational write — a read-only `member` cannot.
  const canOperate = useCan('operate');
  const operateReason = requirementReason('operate');
  const followUp = useOmniQuery(['instances', instanceId, 'follow-up'], () => ext.followUp.getForInstance(instanceId));
  const [saved, setSaved] = useState<Record<string, unknown> | null>(null);
  const current = (followUp.data?.data ?? {}) as Record<string, unknown>;

  const save = async (data: Record<string, unknown>) => {
    if (!canOperate) return;
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v !== undefined && v !== '') body[k] = v;
    }
    await ext.followUp.setForInstance(instanceId, body);
    void followUp.refetch();
    setSaved(body);
  };

  return (
    <Panel title="Follow-up" description="Idle-chat re-engagement config for this instance.">
      <SchemaForm
        key={`follow-up:${JSON.stringify(current)}`}
        schema={followUpSchema}
        value={current}
        preview={isProduction}
        disabled={!canOperate}
        submitLabel="Save follow-up"
        onSubmit={(data) => {
          if (!guard && canOperate) void save(data as Record<string, unknown>);
        }}
      />
      {!canOperate && (
        <Note type="default" label="Read-only role">
          {operateReason}
        </Note>
      )}
      <ActionButton
        label="Clear follow-up"
        effect="live"
        destructive
        targetName={instanceName}
        targetId={instanceId}
        disabledReason={guard}
        onDone={() => void followUp.refetch()}
        run={() => ext.followUp.clearForInstance(instanceId)}
      />
      {saved && (
        <MutationResult
          effect="live"
          request={{ method: 'PUT', path: `/follow-up/instances/${instanceId}`, body: saved }}
          response={saved}
        />
      )}
    </Panel>
  );
}

function sliceValues(instance: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const v = instance[key];
    if (v !== undefined && v !== null) out[key] = v;
  }
  return out;
}

function ConfigSectionForm({
  section,
  instance,
  isProduction,
  refetchInstance,
}: {
  section: ConfigSection;
  instance: Record<string, unknown> & { id: string; name: string };
} & Pick<InstanceTabProps, 'isProduction' | 'refetchInstance'>) {
  const { ext } = useOmniClient();
  // Patching instance config is an operational write — a read-only `member` cannot.
  const canOperate = useCan('operate');
  const operateReason = requirementReason('operate');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ request: Record<string, unknown>; before: unknown; after: unknown } | null>(
    null,
  );

  const current = sliceValues(instance, section.keys);

  const onSubmit = async (data: unknown) => {
    if (!canOperate) return;
    const body = minimalPatch(data as Record<string, unknown>, instance, section.keys);
    if (Object.keys(body).length === 0) {
      setError('No changes to save.');
      setResult(null);
      return;
    }
    setError(null);
    setPending(true);
    const before = sliceValues(instance, section.keys);
    try {
      await ext.instances.patch(instance.id, body);
      const fresh = await ext.instances.getRaw(instance.id);
      const after = sliceValues((fresh.data ?? {}) as Record<string, unknown>, section.keys);
      setResult({ request: body, before, after });
      refetchInstance();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel title={section.title} description={section.description}>
      <SchemaForm
        // Reset the form to fresh values after each successful save.
        key={`${section.id}:${String(instance.updatedAt ?? '')}`}
        schema={section.schema}
        value={current}
        preview={isProduction}
        disabled={pending || !canOperate}
        submitLabel={pending ? 'Saving…' : 'Save section'}
        onSubmit={(data) => void onSubmit(data)}
      />
      {!canOperate && (
        <Note type="default" label="Read-only role">
          {operateReason}
        </Note>
      )}
      {error && (
        <span style={{ fontSize: 12, color: error === 'No changes to save.' ? T.muted : T.danger }}>{error}</span>
      )}
      {result && (
        <MutationResult
          effect="live"
          request={{ method: 'PATCH', path: `/instances/${instance.id}`, body: result.request }}
          before={result.before}
          after={result.after}
        />
      )}
    </Panel>
  );
}
