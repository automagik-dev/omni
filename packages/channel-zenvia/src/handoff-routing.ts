import { z } from 'zod';

import { ZenviaApiError, ZenviaErrorCode } from './utils/errors';

const MAX_GROUPS = 256;
const MAX_LOGGED_VALUE_LENGTH = 128;

export function normalizeRoutingValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export const zenviaHandoffRoutingSchema = z
  .object({
    field: z.string().trim().min(1).max(128).describe('Key of handoffFields whose value picks the Sales group'),
    groups: z
      .record(z.string().min(1).max(256), z.string().trim().min(1).max(64))
      .describe(
        'Maps a value of the field to a Sales group id. Values compare trimmed, with inner whitespace collapsed and ignoring case',
      ),
  })
  .strict()
  .superRefine((routing, ctx) => {
    const keys = Object.keys(routing.groups);
    if (keys.length === 0 || keys.length > MAX_GROUPS) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groups'], message: `needs 1 to ${MAX_GROUPS} entries` });
    }
    const seen = new Set<string>();
    for (const key of keys) {
      const normalized = normalizeRoutingValue(key);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['groups', key], message: 'a value cannot be blank' });
      } else if (seen.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['groups', key],
          message: 'duplicate value: it is the same as another one after trimming, collapsing spaces and ignoring case',
        });
      }
      seen.add(normalized);
    }
  });

export type ZenviaHandoffRouting = z.infer<typeof zenviaHandoffRoutingSchema>;

export function parseHandoffRouting(raw: unknown): ZenviaHandoffRouting | undefined {
  if (raw === undefined || raw === null) return undefined;
  let value = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return undefined;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new ZenviaApiError(ZenviaErrorCode.INVALID_REQUEST, 'zenviaHandoffRouting must be valid JSON');
    }
  }
  const parsed = zenviaHandoffRoutingSchema.safeParse(value);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`)
      .join('; ');
    throw new ZenviaApiError(ZenviaErrorCode.INVALID_REQUEST, `zenviaHandoffRouting is invalid — ${detail}`);
  }
  return parsed.data;
}

export type HandoffRoutingMiss =
  | { field: string; reason: 'missing' }
  | { field: string; reason: 'not-a-string'; valueType: string }
  | { field: string; reason: 'unmatched'; value: string };

export type HandoffGroupResolution =
  | { ok: true; groupId: string; miss?: HandoffRoutingMiss }
  | { ok: false; error: string; miss?: HandoffRoutingMiss };

function typeOfValue(value: unknown): string {
  if (value === null) return 'null';
  return Array.isArray(value) ? 'array' : typeof value;
}

function readRoutingValue(routing: ZenviaHandoffRouting, meta: Record<string, unknown>): unknown {
  const fields = meta.handoffFields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return undefined;
  return (fields as Record<string, unknown>)[routing.field];
}

function findRoutedGroup(
  routing: ZenviaHandoffRouting,
  meta: Record<string, unknown>,
): { groupId: string } | { miss: HandoffRoutingMiss } {
  const raw = readRoutingValue(routing, meta);
  if (raw === undefined) return { miss: { field: routing.field, reason: 'missing' } };
  if (typeof raw !== 'string') {
    return { miss: { field: routing.field, reason: 'not-a-string', valueType: typeOfValue(raw) } };
  }
  const wanted = normalizeRoutingValue(raw);
  for (const [key, groupId] of Object.entries(routing.groups)) {
    if (normalizeRoutingValue(key) === wanted) return { groupId };
  }
  return { miss: { field: routing.field, reason: 'unmatched', value: raw.slice(0, MAX_LOGGED_VALUE_LENGTH) } };
}

function describeMiss(miss: HandoffRoutingMiss): string {
  switch (miss.reason) {
    case 'missing':
      return `handoffFields.${miss.field} is missing`;
    case 'not-a-string':
      return `handoffFields.${miss.field} is a ${miss.valueType}, not a string`;
    case 'unmatched':
      return `handoffFields.${miss.field} is "${miss.value}", which no group is mapped to`;
  }
}

export function resolveHandoffGroup(
  routing: ZenviaHandoffRouting | undefined,
  defaultGroupId: string | undefined,
  meta: Record<string, unknown>,
): HandoffGroupResolution {
  if (!routing) {
    return defaultGroupId
      ? { ok: true, groupId: defaultGroupId }
      : { ok: false, error: 'Zenvia handoff refused: no Sales group is configured (zenviaHandoffGroupId)' };
  }

  const routed = findRoutedGroup(routing, meta);
  if ('groupId' in routed) return { ok: true, groupId: routed.groupId };
  if (defaultGroupId) return { ok: true, groupId: defaultGroupId, miss: routed.miss };
  return {
    ok: false,
    error: `Zenvia handoff refused: ${describeMiss(routed.miss)} and no default group (zenviaHandoffGroupId) is configured`,
    miss: routed.miss,
  };
}
