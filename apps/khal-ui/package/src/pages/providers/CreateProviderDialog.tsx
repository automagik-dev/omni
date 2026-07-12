'use client';

/**
 * Create an agent provider. Scalar fields render through {@link SchemaForm}
 * (mirroring the API create schema); `schemaConfig` is JSON because its required
 * keys depend on the chosen schema. Gated through {@link ConfirmDialog} (LIVE).
 */
import { Dialog, Note } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { JsonEditor, type JsonEditorState } from '../../components/JsonEditor';
import { MutationResult } from '../../components/MutationResult';
import { SchemaForm } from '../../components/SchemaForm';
import { buildProviderBody, providerCreateSchema } from './provider-helpers';

const OK_JSON: JsonEditorState = { text: '', ok: true, value: undefined, error: null };

export function CreateProviderDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { ext } = useOmniClient();
  const [schemaConfig, setSchemaConfig] = useState<JsonEditorState>(OK_JSON);
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [working, setWorking] = useState(false);

  const reset = () => {
    setSchemaConfig(OK_JSON);
    setPending(null);
    setError(null);
    setResult(null);
    setWorking(false);
  };

  const create = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      const res = await ext.providers.create(pending);
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
      setPending(null);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <Dialog.Title>New provider</Dialog.Title>
      <Dialog.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {error && <Note type="error">{error}</Note>}
          <SchemaForm
            schema={providerCreateSchema}
            submitLabel={working ? 'Creating…' : 'Review & create'}
            disabled={working}
            onSubmit={(data) => {
              setError(null);
              if (!schemaConfig.ok) {
                setError('Fix the schemaConfig JSON first.');
                return;
              }
              setPending(buildProviderBody(data as Record<string, unknown>, schemaConfig.value));
            }}
          />
          <JsonEditor
            label="schemaConfig"
            description="Schema-specific config (agno: { agentId }, claude-code: { projectPath }, …)"
            rows={5}
            onChange={setSchemaConfig}
          />
          {result !== null && <MutationResult effect="live" response={result} />}
        </div>
      </Dialog.Body>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void create()}
        title="Create provider"
        targetName={String(pending?.name ?? 'new provider')}
        targetId="(new provider)"
        effect="live"
        description="Creates a new agent provider record."
        confirmLabel="Create"
        pending={working}
      />
    </Dialog>
  );
}
