'use client';

/**
 * Provider overview: all fields, a read-only health probe (latency + status via
 * {@link LiveTestResult}), and an inline edit form. Secrets arrive masked from
 * the API and stay masked; edits gate through {@link ConfirmDialog} (LIVE) with
 * a read-back diff.
 */
import { Badge, PillBadge } from '@khal-os/ui';
import { useState } from 'react';
import type { ProviderRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FieldGrid } from '../../../components/FieldGrid';
import { JsonEditor, type JsonEditorState } from '../../../components/JsonEditor';
import { JsonInspector } from '../../../components/JsonInspector';
import { MutationResult } from '../../../components/MutationResult';
import { SchemaForm } from '../../../components/SchemaForm';
import { T } from '../../../components/tokens';
import { ActionButton, Panel } from '../../instances/components';
import { buildProviderBody, providerEditSchema } from '../provider-helpers';

const OK_JSON: JsonEditorState = { text: '', ok: true, value: undefined, error: null };

export function ProviderOverviewTab({ provider, refetch }: { provider: ProviderRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const [editing, setEditing] = useState(false);
  const [schemaConfig, setSchemaConfig] = useState<JsonEditorState>(OK_JSON);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ before: unknown; after: unknown } | null>(null);
  const [working, setWorking] = useState(false);

  const caps = [
    provider.supportsStreaming && 'streaming',
    provider.supportsImages && 'images',
    provider.supportsAudio && 'audio',
    provider.supportsDocuments && 'documents',
  ].filter(Boolean) as string[];

  const save = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      const before = await ext.providers.get(provider.id);
      await ext.providers.patch(provider.id, pending);
      const after = await ext.providers.get(provider.id);
      setResult({ before: before.data, after: after.data });
      setEditing(false);
      refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setWorking(false);
      setPending(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <Panel title="Health" description="Read-only probe — reports reachability and latency, changes nothing.">
        <ActionButton
          label="Check health"
          effect="read-only"
          targetName={provider.name}
          targetId={provider.id}
          resultName="POST /providers/:id/health"
          run={() => ext.providers.health(provider.id)}
        />
      </Panel>

      <Panel
        title="Configuration"
        actions={
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            style={{ fontSize: 12, color: T.accent, background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {editing ? 'Close editor' : 'Edit'}
          </button>
        }
      >
        <FieldGrid
          fields={[
            { label: 'Name', value: provider.name },
            { label: 'Schema', node: <PillBadge>{provider.schema ?? '—'}</PillBadge> },
            { label: 'Base URL', value: provider.baseUrl ?? '—', mono: true },
            { label: 'API key', value: provider.apiKey ?? '—', mono: true },
            { label: 'Default timeout', value: provider.defaultTimeout != null ? `${provider.defaultTimeout}s` : '—' },
            { label: 'Default stream', value: provider.defaultStream },
            {
              label: 'Capabilities',
              node: caps.length ? (
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {caps.map((c) => (
                    <PillBadge key={c}>{c}</PillBadge>
                  ))}
                </div>
              ) : (
                '—'
              ),
            },
            { label: 'Tags', value: provider.tags ?? [] },
            {
              label: 'Active',
              node: (
                <Badge variant={provider.isActive === false ? 'gray' : 'green'}>
                  {provider.isActive === false ? 'inactive' : 'active'}
                </Badge>
              ),
            },
            { label: 'Description', value: provider.description ?? '—' },
            { label: 'Created', value: provider.createdAt ?? '—', mono: true },
          ]}
        />
        {provider.schemaConfig && (
          <div>
            <span style={{ fontSize: 11, color: T.muted }}>schemaConfig (sensitive keys redacted server-side)</span>
            <JsonInspector value={provider.schemaConfig} />
          </div>
        )}
      </Panel>

      {editing && (
        <Panel title="Edit provider" description="Only changed fields are sent. Leave API key blank to keep it.">
          {error && <span style={{ fontSize: 12, color: T.danger }}>{error}</span>}
          <SchemaForm
            schema={providerEditSchema}
            value={{
              name: provider.name,
              schema: provider.schema as never,
              baseUrl: provider.baseUrl ?? undefined,
              defaultStream: provider.defaultStream,
              defaultTimeout: provider.defaultTimeout,
              supportsStreaming: provider.supportsStreaming,
              supportsImages: provider.supportsImages,
              supportsAudio: provider.supportsAudio,
              supportsDocuments: provider.supportsDocuments,
              tags: provider.tags ?? [],
              description: provider.description ?? undefined,
            }}
            submitLabel={working ? 'Saving…' : 'Review changes'}
            disabled={working}
            onSubmit={(data) => {
              setError(null);
              if (!schemaConfig.ok) {
                setError('Fix the schemaConfig JSON first.');
                return;
              }
              const md = schemaConfig.text.trim() ? schemaConfig.value : undefined;
              setPending(buildProviderBody(data as Record<string, unknown>, md));
            }}
          />
          <JsonEditor
            label="schemaConfig"
            description="Leave blank to keep unchanged"
            rows={5}
            value={provider.schemaConfig ?? undefined}
            onChange={setSchemaConfig}
          />
        </Panel>
      )}

      {result && (
        <MutationResult
          effect="live"
          request={{ method: 'PATCH', path: `/providers/${provider.id}`, body: pending ?? undefined }}
          before={result.before}
          after={result.after}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void save()}
        title="Update provider"
        targetName={provider.name}
        targetId={provider.id}
        effect="live"
        description="Applies the changed fields to this provider."
        confirmLabel="Save"
        pending={working}
      />
    </div>
  );
}
