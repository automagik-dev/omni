/**
 * ASC Brazil (ASCWhats GW) Channel Plugin for Omni v2.
 *
 * Provides WhatsApp messaging via the ASC BSP gateway (ascbrazil.com.br):
 *   - Outbound text / media / location / contacts / templates / interactive
 *     (buttons + lists) through the single Graph-mirror `POST
 *     /api/v1/messages` endpoint (static `originador` + `asc-token` headers).
 *   - Per-instance webhook inbound (`/api/v2/channels/asc/:instanceId/webhook`)
 *     in the OFFICIAL Meta Cloud API format (shared @omni/core schemas),
 *     with a Meta-style GET challenge echo and optional verify token.
 *   - Typing indicator + read receipts via the newest inbound wamid.
 *
 * @example
 * ```typescript
 * import ascPlugin from '@omni/channel-asc';
 * channelRegistry.register(ascPlugin);
 * ```
 */

import { AscPlugin } from './plugin';

const plugin = new AscPlugin();
export default plugin;

// Plugin class — exposed so apps/tests can subclass or override.
export { AscPlugin } from './plugin';

// Capabilities — declarative, useful for capability discovery.
export { ASC_CAPABILITIES } from './capabilities';

// HTTP client — exposed for future API routes needing raw ASC access.
export { AscClient, DEFAULT_ASC_BASE_URL } from './client';
export type { AscClientOptions } from './client';

// Webhook handler — the api-side route delegates through plugin.handleWebhook,
// but the pure payload handler is exported for direct use/testing.
export { handleAscWebhook, handleAscWebhookRequest, handleVerifyChallenge } from './handlers/webhook';

// Errors
export { AscApiError, AscErrorCode, mapHttpStatusToAscError, isRetryable } from './utils/errors';
export type { AscErrorCodeType, AscApiErrorContext } from './utils/errors';

// Identity helpers
export { toAscPhone } from './utils/identity';

// Internal types
export type {
  AscConfig,
  AscOutboundMessage,
  AscSendResponse,
  AscMediaInfo,
  AscMediaPayload,
  AscTemplatePayload,
} from './types';
