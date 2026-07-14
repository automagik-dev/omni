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
 * The Omni API key is NEVER handled in the browser. The BFF injects the real
 * `x-api-key` server-side and overrides whatever the client sends.
 *
 * **Identity forwarding.** When the KHAL host has issued a session token, we
 * send it as `Authorization: Bearer <token>` so the BFF can verify *who* is
 * calling (defense in depth over the pack's role gating). The SDK's `bearer`
 * mode does exactly this — it sets `Authorization` and drops `x-api-key`, which
 * the BFF re-injects server-side anyway. When there is no token (the standalone
 * dev harness supplies none), we send neither identity header, only the
 * placeholder `x-api-key` the SDK requires — the header is simply omitted, never
 * forged, so the current harness keeps working unchanged.
 *
 * @param bffBase Origin-relative (default `/omni`, proxied by Vite in the
 *   harness) or an absolute BFF URL ending in `/omni`.
 * @param token   Raw KHAL platform JWT from `useKhalAuth()?.token`, or
 *   `undefined` when the host supplies none.
 */
export function createOmniAdminClient(bffBase = '/omni', token?: string): OmniAdminClient {
  if (token) {
    return createOmniClient({ baseUrl: bffBase, apiKey: token, authHeader: 'bearer' });
  }
  return createOmniClient({ baseUrl: bffBase, apiKey: 'bff-proxied' });
}
