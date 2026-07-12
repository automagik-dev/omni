'use client';

/**
 * Agent overview: every scalar field the schema exposes, plus an inline edit
 * form. Edits assemble a PATCH body (scalars from {@link SchemaForm} + metadata
 * and agentCard from JSON), gate through {@link ConfirmDialog} (effect LIVE), and
 * render a {@link MutationResult} read-back diff proving the write landed.
 */
import { Badge, Button, PillBadge } from '@khal-os/ui';
import { useState } from 'react';
import type { AgentRow } from '../../../api/ext';
import { useOmniClient } from '../../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../../components/ConfirmDialog';
import { FieldGrid } from '../../../components/FieldGrid';
import { JsonEditor, type JsonEditorState } from '../../../components/JsonEditor';
import { JsonInspector } from '../../../components/JsonInspector';
import { MutationResult } from '../../../components/MutationResult';
import { SchemaForm } from '../../../components/SchemaForm';
import { T } from '../../../components/tokens';
import { Panel } from '../../instances/components';
import {
  agentCapabilities,
  agentEditSchema,
  agentTypeLabel,
  buildAgentBody,
  providerBadgeVariant,
} from '../agent-helpers';

const OK_JSON: JsonEditorState = { text: '', ok: true, value: undefined, error: null };

export function AgentOverviewTab({ agent, refetch }: { agent: AgentRow; refetch: () => void }) {
  const { ext } = useOmniClient();
  const [editing, setEditing] = useState(false);
  const [metadata, setMetadata] = useState<JsonEditorState>(OK_JSON);
  const [agentCard, setAgentCard] = useState<JsonEditorState>(OK_JSON);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ before: unknown; after: unknown; response: unknown } | null>(null);
  const [working, setWorking] = useState(false);

  const caps = agentCapabilities(agent);

  const review = (values: Record<string, unknown>) => {
    setError(null);
    if (!metadata.ok || !agentCard.ok) {
      setError('Fix the JSON before saving.');
      return;
    }
    // Only send metadata/agentCard when the operator actually typed something.
    const md = metadata.text.trim() ? metadata.value : undefined;
    const card = agentCard.text.trim() ? agentCard.value : undefined;
    setPending(buildAgentBody(values, md, card));
  };

  const save = async () => {
    if (!pending) return;
    setWorking(true);
    setError(null);
    try {
      const before = await ext.agents.get(agent.id);
      const res = await ext.agents.patch(agent.id, pending);
      const after = await ext.agents.get(agent.id);
      setResult({ before: before.data, after: after.data, response: res.data });
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
      <Panel
        title="Identity"
        actions={
          <Button size="small" variant="secondary" onClick={() => setEditing((e) => !e)}>
            {editing ? 'Close editor' : 'Edit'}
          </Button>
        }
      >
        <FieldGrid
          fields={[
            { label: 'Name', value: agent.name },
            { label: 'Provider', node: <Badge variant={providerBadgeVariant(agent.provider)}>{agent.provider}</Badge> },
            { label: 'Type', value: agentTypeLabel(agent.agentType) },
            { label: 'Model', value: agent.model || '—' },
            {
              label: 'Active',
              node: <Badge variant={agent.isActive ? 'green' : 'gray'}>{agent.isActive ? 'active' : 'inactive'}</Badge>,
            },
            { label: 'Internal', value: agent.isInternal },
            { label: 'Owner', value: agent.ownerId ?? '—', mono: Boolean(agent.ownerId) },
            { label: 'Provider link', value: agent.agentProviderId ?? '—', mono: Boolean(agent.agentProviderId) },
            { label: 'Config path', value: agent.configPath ?? '—' },
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
            { label: 'Created', value: agent.createdAt ?? '—', mono: true },
            { label: 'Updated', value: agent.updatedAt ?? '—', mono: true },
          ]}
        />
      </Panel>

      {editing && (
        <Panel title="Edit agent" description="Every field is optional — only changed values are sent.">
          {error && <span style={{ fontSize: 12, color: T.danger }}>{error}</span>}
          <SchemaForm
            schema={agentEditSchema}
            value={{
              name: agent.name,
              provider: agent.provider as never,
              model: agent.model ?? undefined,
              agentType: agent.agentType as never,
              capabilities: caps,
              isActive: agent.isActive,
              isInternal: agent.isInternal,
              ownerId: agent.ownerId ?? undefined,
              agentProviderId: agent.agentProviderId ?? undefined,
              configPath: agent.configPath ?? undefined,
            }}
            submitLabel={working ? 'Saving…' : 'Review changes'}
            disabled={working}
            onSubmit={(data) => review(data as Record<string, unknown>)}
          />
          <JsonEditor
            label="metadata"
            description="Leave blank to keep unchanged"
            rows={4}
            value={agent.metadata ?? undefined}
            onChange={setMetadata}
          />
          <JsonEditor
            label="agentCard"
            description="Leave blank to keep unchanged"
            rows={4}
            value={agent.agentCard ?? undefined}
            onChange={setAgentCard}
          />
        </Panel>
      )}

      {(agent.metadata || agent.agentCard) && (
        <Panel title="Raw metadata / agent card">
          {agent.metadata && (
            <div>
              <span style={{ fontSize: 11, color: T.muted }}>metadata</span>
              <JsonInspector value={agent.metadata} />
            </div>
          )}
          {agent.agentCard && (
            <div>
              <span style={{ fontSize: 11, color: T.muted }}>agentCard</span>
              <JsonInspector value={agent.agentCard} />
            </div>
          )}
        </Panel>
      )}

      {result && (
        <MutationResult
          effect="live"
          request={{ method: 'PATCH', path: `/agents/${agent.id}`, body: pending ?? undefined }}
          response={result.response}
          before={result.before}
          after={result.after}
        />
      )}

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void save()}
        title="Update agent"
        targetName={agent.name}
        targetId={agent.id}
        effect="live"
        description="Applies the changed fields to this agent."
        confirmLabel="Save"
        pending={working}
      />
    </div>
  );
}
