'use client';

/**
 * Batch-job create wizard. Estimate first (read-only: cost + item counts), then
 * create (LIVE, with side effects — it starts background processing that costs
 * money). Create is gated behind a typed-phrase confirm and is only enabled once
 * an estimate has been fetched, so nobody kicks off a paid job blind.
 */
import { Dialog, Note } from '@khal-os/ui';
import { useState } from 'react';
import type { BatchJobEstimate } from '../../api/ext';
import { useOmniClient } from '../../app/providers/OmniClientProvider';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { JsonInspector } from '../../components/JsonInspector';
import { LiveTestResult } from '../../components/LiveTestResult';
import { SchemaForm } from '../../components/SchemaForm';
import { T } from '../../components/tokens';
import { batchJobSchema, buildBatchBody, formatUsd, validateBatchRequirements } from './batch-helpers';

export function CreateBatchJobWizard({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { ext } = useOmniClient();
  const [body, setBody] = useState<Record<string, unknown> | null>(null);
  const [estimate, setEstimate] = useState<BatchJobEstimate | null>(null);
  const [estimating, setEstimating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [creating, setCreating] = useState(false);

  const reset = () => {
    setBody(null);
    setEstimate(null);
    setError(null);
    setConfirming(false);
    setCreating(false);
    setEstimating(false);
  };

  const runEstimate = async (values: Record<string, unknown>) => {
    setError(null);
    setEstimate(null);
    const reqErr = validateBatchRequirements(values as { jobType?: string; chatId?: string; daysBack?: number });
    if (reqErr) {
      setError(reqErr);
      return;
    }
    const assembled = buildBatchBody(values);
    setBody(assembled);
    setEstimating(true);
    try {
      // Estimate doesn't take `force`.
      const { force, ...estBody } = assembled;
      const res = await ext.batchJobs.estimate(estBody);
      setEstimate(res.data ?? {});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Estimate failed');
    } finally {
      setEstimating(false);
    }
  };

  const create = async () => {
    if (!body) return;
    setCreating(true);
    try {
      const res = await ext.batchJobs.create(body);
      const id = res.data?.id;
      if (id) {
        reset();
        onClose();
        onCreated(id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
      setConfirming(false);
    } finally {
      setCreating(false);
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
      <Dialog.Title>New batch job</Dialog.Title>
      <Dialog.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 0 }}>
          {error && <Note type="error">{error}</Note>}
          <SchemaForm
            schema={batchJobSchema}
            submitLabel={estimating ? 'Estimating…' : 'Estimate cost'}
            disabled={estimating}
            onSubmit={(data) => void runEstimate(data as Record<string, unknown>)}
          />

          {estimate && (
            <LiveTestResult
              name="Estimate"
              effect="read-only"
              status="pass"
              message={`~${estimate.totalItems ?? 0} items · ${formatUsd(estimate.estimatedCostUsd)}`}
              evidence={estimate}
            />
          )}

          {estimate && body && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Note type="error" label="Live">
                Creating the job starts background media processing that consumes tokens and costs money. This is not a
                dry run.
              </Note>
              <div>
                <span style={{ fontSize: 11, color: T.muted }}>Job body</span>
                <JsonInspector value={body} />
              </div>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                style={{
                  alignSelf: 'flex-start',
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: T.danger,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Create job (live, costs money)
              </button>
            </div>
          )}
        </div>
      </Dialog.Body>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => void create()}
        title="Create batch job"
        targetName={String(body?.jobType ?? 'batch job')}
        targetId={String(body?.instanceId ?? '(instance)')}
        effect="live"
        destructive
        description="Starts a live, paid batch-processing job. It runs in the background until complete or cancelled."
        confirmLabel="Create job"
        pending={creating}
      />
    </Dialog>
  );
}
