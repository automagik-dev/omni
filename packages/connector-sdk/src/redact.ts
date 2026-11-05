/**
 * Shared secret redaction.
 *
 * Provider error text is diagnostic, so it is kept — bounded and scrubbed.
 * Every place that lets provider text leave a manifest (validation result,
 * action error, log line) runs it through here first. This is a safety net, not
 * the only defence: a manifest must also avoid interpolating credentials.
 */

import type { ConnectorCredentialField } from './types';

/** Replace every occurrence of each non-empty secret with `[redacted]`. */
export function redactSecrets(text: string, secrets: readonly (string | null | undefined)[]): string {
  let out = text;
  for (const secret of secrets) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

/** Deep-redact every string under a value; preserves shape for diagnostics. */
export function redactValue<T>(value: T, secrets: readonly (string | null | undefined)[]): T {
  if (typeof value === 'string') return redactSecrets(value, secrets) as T;
  if (Array.isArray(value)) return value.map((item) => redactValue(item, secrets)) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, redactValue(item, secrets)]),
    ) as T;
  }
  return value;
}

/** The credential values that must be scrubbed, from a manifest's field list. */
export function secretValues(
  credentials: Readonly<Record<string, string>>,
  fields: readonly ConnectorCredentialField[],
): string[] {
  const values: string[] = [];
  for (const field of fields) {
    if (!field.secret) continue;
    const value = credentials[field.key];
    if (typeof value === 'string' && value.length > 0) values.push(value);
  }
  return values;
}
