/**
 * Zenvia Channel Plugin for Omni v2.
 *
 * Provides WhatsApp messaging via the Zenvia API v2 (api.zenvia.com/v2):
 *   - Outbound text / media / location / templates through
 *     `POST /channels/whatsapp/messages` (static `X-API-TOKEN` header).
 *   - Per-instance webhook inbound (`/api/v2/channels/zenvia/:instanceId/webhook`)
 *     fed by Zenvia subscriptions (MESSAGE + MESSAGE_STATUS).
 *   - Native handoff through the `conversation` routing field.
 *
 * @example
 * ```typescript
 * import zenviaPlugin from '@omni/channel-zenvia';
 * channelRegistry.register(zenviaPlugin);
 * ```
 */

import { ZenviaPlugin } from './plugin';

const plugin = new ZenviaPlugin();
export default plugin;

// Plugin class — exposed so apps/tests can subclass or override.
export { ZenviaPlugin } from './plugin';

// Capabilities — declarative, useful for capability discovery.
export { ZENVIA_CAPABILITIES } from './capabilities';

// HTTP client — exposed for future API routes needing raw Zenvia access.
export { ZenviaClient, DEFAULT_ZENVIA_BASE_URL } from './client';
export type { ZenviaClientOptions } from './client';

// Webhook handler — the api-side route delegates through plugin.handleWebhook,
// but the pure handlers are exported for direct use/testing.
export { handleZenviaEvent, handleZenviaWebhookRequest } from './handlers/webhook';

// Handoff planning
export { buildHandoffRouting, HANDOFF_NOT_CONFIGURED_ERROR } from './utils/handoff';

// Errors
export { ZenviaApiError, ZenviaErrorCode, mapHttpStatusToZenviaError, isRetryable } from './utils/errors';
export type { ZenviaErrorCodeType, ZenviaApiErrorContext } from './utils/errors';

// Identity helpers
export { toZenviaPhone } from './utils/identity';

// Types + wire schemas
export { ZENVIA_HANDOFF_SOLUTIONS } from './types';
export type {
  ZenviaConfig,
  ZenviaConversationRouting,
  ZenviaHandoffSolution,
  ZenviaInboundMessage,
  ZenviaOutboundContent,
  ZenviaOutboundMessage,
  ZenviaSendResponse,
} from './types';
