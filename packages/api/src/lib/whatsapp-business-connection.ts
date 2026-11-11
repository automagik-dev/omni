/**
 * whatsapp-business (Meta Cloud) persisted-credential hydration, shared by
 * every non-canonical `plugin.connect()` call site: the generic connect and
 * restart routes (routes/v2/instances.ts) and boot auto-reconnect
 * (plugins/instance-monitor.ts). The canonical whatsapp-cloud connect route
 * (routes/v2/whatsapp-business.ts) builds `config.credentials` itself from
 * the request body + env and does not use this helper.
 *
 * The plugin's `connect()` reads these keys from `config.options` (same keys
 * as `config.credentials`). See GH #894.
 */

import { type MetaAuthMode, isMetaHostUrl } from '@omni/core/schemas';
import { z } from 'zod';

/**
 * Meta Graph API version as the plugin pins it in every URL: `v<major>.<minor>`
 * (e.g. `v25.0`). Anything else in the env — including the empty string a
 * `META_GRAPH_API_VERSION=` line leaves behind — must not replace the
 * persisted value with nothing.
 */
const metaGraphApiVersionSchema = z.string().regex(/^v\d+\.\d+$/);

/** Subset of the instances row carrying the persisted Meta config. */
export interface WhatsAppBusinessConnectionSource {
  metaAccessToken?: string | null;
  metaPhoneNumberId?: string | null;
  metaWabaId?: string | null;
  metaAppId?: string | null;
  metaBusinessId?: string | null;
  metaApiVersion?: string | null;
  metaDisplayPhoneNumber?: string | null;
  metaConnectionMethod?: string | null;
  /** Meta-compatible provider settings; all unset = Meta direct. */
  metaApiBaseUrl?: string | null;
  metaAuthMode?: string | null;
  metaWebhookSecret?: string | null;
  metaSignatureMode?: string | null;
}

/**
 * Env-first: the row value is a provisioning snapshot ("Runtime uses
 * META_GRAPH_API_VERSION env" — column doc in @omni/db schema, and what the
 * canonical connect route pins). A version bump after Meta sunsets an old
 * Graph version must win over the stale snapshot on reconnect. Read at call
 * time (not module load) so tests can mutate process.env. An absent, empty,
 * or malformed env value is ignored and the persisted snapshot is kept.
 */
export function resolveMetaApiVersion(persisted: string | null | undefined): string | undefined {
  const fromEnv = metaGraphApiVersionSchema.safeParse(process.env.META_GRAPH_API_VERSION);
  if (fromEnv.success) return fromEnv.data;
  return persisted ?? undefined;
}

export function applyWhatsAppBusinessConnectionOptions(
  options: Record<string, unknown>,
  input: WhatsAppBusinessConnectionSource,
): void {
  if (input.metaAccessToken) options.metaAccessToken = input.metaAccessToken;
  if (input.metaPhoneNumberId) options.metaPhoneNumberId = input.metaPhoneNumberId;
  if (input.metaWabaId) options.metaWabaId = input.metaWabaId;
  if (input.metaAppId) options.metaAppId = input.metaAppId;
  if (input.metaBusinessId) options.metaBusinessId = input.metaBusinessId;
  const apiVersion = resolveMetaApiVersion(input.metaApiVersion);
  if (apiVersion) options.metaApiVersion = apiVersion;
  if (input.metaDisplayPhoneNumber) options.metaDisplayPhoneNumber = input.metaDisplayPhoneNumber;
  if (input.metaConnectionMethod) options.metaConnectionMethod = input.metaConnectionMethod;
  if (input.metaApiBaseUrl) options.metaApiBaseUrl = input.metaApiBaseUrl;
  if (input.metaAuthMode) options.metaAuthMode = input.metaAuthMode;
  if (input.metaWebhookSecret) options.metaWebhookSecret = input.metaWebhookSecret;
  if (input.metaSignatureMode) options.metaSignatureMode = input.metaSignatureMode;
}

/** Whether the instance reaches WhatsApp through a Meta-compatible provider instead of Meta. */
export function usesMetaProvider(instance: { metaApiBaseUrl?: string | null }): boolean {
  return Boolean(instance.metaApiBaseUrl) && !isMetaHostUrl(instance.metaApiBaseUrl ?? '');
}

/**
 * `MetaWhatsAppClient` options for an instance row: the provider base URL and
 * auth mode when set, nothing extra for Meta direct. Every API route that
 * builds a client from a row goes through this, so a provider key is only
 * ever sent to the provider.
 */
export function metaClientTransport(instance: { metaApiBaseUrl?: string | null; metaAuthMode?: string | null }): {
  baseUrl?: string;
  authMode?: MetaAuthMode;
} {
  if (!instance.metaApiBaseUrl) return {};
  return {
    baseUrl: instance.metaApiBaseUrl,
    authMode: instance.metaAuthMode === 'x-api-key' ? 'x-api-key' : 'bearer',
  };
}

/** Error body for a route that only talks to Meta's own Graph API. */
export function metaOnlyRouteError(operation: string) {
  return {
    error: {
      code: 'NOT_SUPPORTED_VIA_PROVIDER',
      message: `${operation} calls Meta's Graph API directly and is not available for an instance on a Meta-compatible provider`,
    },
  };
}
