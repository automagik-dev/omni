/** Shared provider response formatting for the REST and tRPC APIs. */
import type { AgentProvider } from '@omni/db';

const SENSITIVE_KEY_PATTERN = /private|secret|password|token|apikey|api_key/i;

function maskSchemaConfig(
  config: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null | undefined {
  if (!config) return config;
  const masked = { ...config };
  for (const key of Object.keys(masked)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      masked[key] = '[REDACTED]';
    }
  }
  return masked;
}

export function maskProvider(provider: AgentProvider) {
  return {
    ...provider,
    apiKey: provider.apiKey ? '********' : null,
    schemaConfig: maskSchemaConfig(provider.schemaConfig),
  };
}
