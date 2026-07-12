/**
 * Mirror schema + helpers for batch media-processing jobs. The estimate/create
 * schema mirrors the API (batch-jobs.ts); estimate is read-only, create has real
 * side effects (it kicks off background processing that costs money).
 */
import { z } from 'zod';

export const BATCH_JOB_TYPES = ['targeted_chat_sync', 'time_based_batch', 'media_redownload'] as const;
export const CONTENT_TYPES = ['audio', 'image', 'video', 'document'] as const;

/** Form schema for both estimate and create (create adds `force`). */
export const batchJobSchema = z.object({
  jobType: z.enum(BATCH_JOB_TYPES).describe('Job type'),
  instanceId: z.string().uuid().describe('Instance to process media from'),
  chatId: z.string().optional().describe('Chat id (required for targeted_chat_sync)'),
  daysBack: z.number().int().positive().optional().describe('Look-back window (required for time/redownload)'),
  limit: z.number().int().positive().optional().describe('Max items to process'),
  contentTypes: z.array(z.enum(CONTENT_TYPES)).default([]).describe('Content types (default: all)'),
  force: z.boolean().default(false).describe('Re-process items that already have content'),
});
export type BatchJobForm = z.infer<typeof batchJobSchema>;

/** Validate that the type-specific required fields are present. Returns an error or null. */
export function validateBatchRequirements(form: {
  jobType?: string;
  chatId?: string;
  daysBack?: number;
}): string | null {
  if (form.jobType === 'targeted_chat_sync' && !form.chatId) return 'chatId is required for targeted_chat_sync jobs.';
  if (form.jobType === 'time_based_batch' && form.daysBack === undefined)
    return 'daysBack is required for time_based_batch jobs.';
  if (form.jobType === 'media_redownload' && form.daysBack === undefined)
    return 'daysBack is required for media_redownload jobs.';
  return null;
}

/** Assemble an estimate/create body from the form (drops empty optionals). */
export function buildBatchBody(form: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) {
    if (v === undefined || v === '') continue;
    if (Array.isArray(v) && v.length === 0) continue;
    body[k] = v;
  }
  return body;
}

const STATUS_VARIANTS: Record<string, 'green' | 'blue' | 'amber' | 'gray'> = {
  completed: 'green',
  running: 'blue',
  pending: 'gray',
  failed: 'amber',
  cancelled: 'gray',
};

/** @khal-os/ui Badge variant for a job status. */
export function jobStatusVariant(status: string | undefined): 'green' | 'blue' | 'amber' | 'gray' {
  return (status && STATUS_VARIANTS[status]) || 'gray';
}

/** True while a job is still doing work and worth polling. */
export function isActiveStatus(status: string | undefined): boolean {
  return status === 'pending' || status === 'running';
}

/** Format a possibly-decimal USD cost as a short string. */
export function formatUsd(cost: number | string | undefined): string {
  const n = typeof cost === 'string' ? Number(cost) : (cost ?? 0);
  if (Number.isNaN(n)) return '$0.00';
  return `$${n.toFixed(n < 1 ? 4 : 2)}`;
}
