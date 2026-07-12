'use client';

/**
 * Create flow for a first-class agent. Scalar fields render through
 * {@link SchemaForm} (mirroring the API's create schema); the two free-form
 * object fields — metadata and the A2A agent card — are edited as JSON. Submit
 * is gated through {@link ConfirmDialog} (effect LIVE) so a create is never one
 * mis-click away, and the landed row is shown as {@link MutationResult} evidence.
 */
import { Dialog, Note } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { JsonEditor, type JsonEditorState } from '../../components/JsonEditor';
import { MutationResult } from '../../components/MutationResult';
import { SchemaForm } from '../../components/SchemaForm';
import { T } from '../../components/tokens';
import { agentCreateSchema, buildAgentBody } from './agent-helpers';

const OK_JSON: JsonEditorState = { text: '', ok: true, value: undefined, error: null };

export function CreateAgentDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { ext } = useOmniClient();
  const [metadata, setMetadata] = useState<JsonEditorState>(OK_JSON);
  const [agentCard, setAgentCard] = useState<JsonEditorState>(OK_JSON);
  const [pendingBody, setPendingBody] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [working, setWorking] = useState(false);

  const reset = () => {
    setMetadata(OK_JSON);
    setAgentCard(OK_JSON);
    setPendingBody(null);
    setError(null);
    setResult(null);
    setWorking(false);
  };

  const close = () => {
    reset();
    onClose();
  };

  const review = (values: Record<string, unknown>) => {
    setError(null);
    if (!metadata.ok || !agentCard.ok) {
      setError('Fix the JSON in metadata / agent card before creating.');
      return;
    }
    setPendingBody(buildAgentBody(values, metadata.value, agentCard.value));
  };

  const create = async () => {
    if (!pendingBody) return;
    setWorking(true);
    setError(null);
    try {
      const res = await ext.agents.create(pendingBody);
      setResult(res.data);
      const id = res.data?.id;
      if (id) {
        reset();
        onClose();
        onCreated(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setWorking(false);
      setPendingBody(null);
    }
  };

  return (
    <Dialog open={open} onClose={close}>
      <Dialog.Title>New agent</Dialog.Title>
      <Dialog.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {error && <Note type="error">{error}</Note>}
          <SchemaForm
            schema={agentCreateSchema}
            submitLabel={working ? 'Creating…' : 'Review & create'}
            disabled={working}
            onSubmit={(data) => review(data as Record<string, unknown>)}
          />
          <JsonEditor label="metadata" description="Arbitrary JSON object (optional)" rows={4} onChange={setMetadata} />
          <JsonEditor
            label="agentCard"
            description="A2A agent-card overrides (optional)"
            rows={4}
            onChange={setAgentCard}
          />
          {result !== null && <MutationResult effect="live" response={result} />}
        </div>
      </Dialog.Body>

      <ConfirmDialog
        open={pendingBody !== null}
        onClose={() => setPendingBody(null)}
        onConfirm={() => void create()}
        title="Create agent"
        targetName={String(pendingBody?.name ?? 'new agent')}
        targetId="(new agent)"
        effect="live"
        description={
          <span style={{ fontSize: 13, color: T.fg }}>
            Creates a new agent record. It is disabled unless you set it active.
          </span>
        }
        confirmLabel="Create"
        pending={working}
      />
    </Dialog>
  );
}
