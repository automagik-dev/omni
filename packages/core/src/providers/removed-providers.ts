/** Compatibility refusal for provider rows retained after an integration is removed. */
import { version } from '../../package.json';
import type { ProviderSchema } from '../types/agent';
import { ProviderError } from './types';

export const REMOVED_OPENCLAW_MESSAGE = `OpenClaw provider removed in ${version}; delete or replace this provider`;

export function removedProviderMessage(schema: string): string | undefined {
  return schema === 'openclaw' ? REMOVED_OPENCLAW_MESSAGE : undefined;
}

export function isRemovedProviderError(error: unknown): error is ProviderError {
  return (
    error instanceof ProviderError &&
    error.statusCode === 410 &&
    error.code === 'NOT_FOUND' &&
    typeof error.details?.schema === 'string' &&
    removedProviderMessage(error.details.schema) !== undefined
  );
}

export function assertProviderAvailable(schema: ProviderSchema | 'openclaw'): asserts schema is ProviderSchema {
  const removed = removedProviderMessage(schema);
  if (removed) throw new ProviderError(removed, 'NOT_FOUND', 410, { schema });
}
