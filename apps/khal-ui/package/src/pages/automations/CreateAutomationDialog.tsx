'use client';

/**
 * Create an automation. Wraps {@link AutomationEditor} (which validates the body
 * against the real mirror schema) and gates the POST through {@link ConfirmDialog}
 * (LIVE). New automations are created enabled or disabled per the form's toggle.
 */
import { Dialog, Note } from '@khal-os/ui';
import { useState } from 'react';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { MutationResult } from '../../components/MutationResult';
import { AutomationEditor } from './AutomationEditor';

export function CreateAutomationDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { ext } = useOmniClient();
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);
  const [working, setWorking] = useState(false);

  const create = async () => {
    if (!pending) return;
    setWorking(true);
    try {
      const res = await ext.automations.create(pending);
      setResult(res.data);
      const id = res.data?.id;
      if (id) {
        setPending(null);
        onClose();
        onCreated(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose}>
      <Dialog.Title>New automation</Dialog.Title>
      <Dialog.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {error && <Note type="error">{error}</Note>}
          <AutomationEditor submitLabel="Review & create" onReady={(body) => setPending(body)} />
          {result !== null && <MutationResult effect="live" response={result} />}
        </div>
      </Dialog.Body>

      <ConfirmDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        onConfirm={() => void create()}
        title="Create automation"
        targetName={String(pending?.name ?? 'new automation')}
        targetId="(new automation)"
        effect="live"
        description={
          pending?.enabled
            ? 'Creates the automation ENABLED — it will fire on matching events.'
            : 'Creates the automation disabled.'
        }
        confirmLabel="Create"
        pending={working}
      />
    </Dialog>
  );
}
