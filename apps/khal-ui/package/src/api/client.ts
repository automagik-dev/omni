import { type OmniClient, createOmniClient } from '@omni/sdk';

export type OmniAdminClient = OmniClient;

/**
 * Omni SDK client wired to the Omni Admin BFF.
 *
 * The `@omni/sdk` client appends `/api/v2` to its `baseUrl`, so the base ends
 * at the BFF's `/omni` mount: a request for `instances` becomes
 * `/omni/api/v2/instances`, which the BFF forwards to
 * `${OMNI_BASE_URL}/api/v2/instances`.
 *
 * The API key is NEVER handled in the browser. The BFF injects the real
 * `x-api-key` server-side and overrides whatever the client sends, so the
 * placeholder below is only here to satisfy the SDK's required-field check and
 * never reaches the Omni backend.
 *
 * @param bffBase Origin-relative (default `/omni`, proxied by Vite in the
 *   harness) or an absolute BFF URL ending in `/omni`.
 */
export function createOmniAdminClient(bffBase = '/omni'): OmniAdminClient {
  return createOmniClient({
    baseUrl: bffBase,
    apiKey: 'bff-proxied',
  });
}
