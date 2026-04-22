/**
 * Gupshup Channel Plugin for Omni v2
 *
 * Provides WhatsApp messaging via Gupshup Custom Integration.
 * Gupshup native format inbound + Custom Integration callback outbound.
 *
 * @example
 * ```typescript
 * import gupshupPlugin from '@omni/channel-gupshup';
 *
 * // Plugin is auto-discovered by channel-sdk scanner
 * // Or manually register:
 * registry.register(gupshupPlugin);
 * ```
 */

import { GupshupPlugin } from './plugin';

// Export the plugin instance (default export for auto-discovery)
const plugin = new GupshupPlugin();
export default plugin;

// Named exports for flexibility
export { GupshupPlugin } from './plugin';
export { GUPSHUP_CAPABILITIES } from './capabilities';
export { GupshupClient } from './client';

// Handlers
export { handleGupshupWebhook } from './handlers/webhooks';

// Senders
export { sendText } from './senders/text';
export { sendMedia, resolveMediaType } from './senders/media';
export { sendLocation } from './senders/location';

// Errors
export { GupshupError, GupshupErrorCode, mapGupshupError, isRetryable } from './utils/errors';
export type { GupshupErrorCodeType } from './utils/errors';

// Utils
export { normalizePhone, extractUserId, toGupshupPhone } from './utils/identity';

// Types
export type {
  GupshupConfig,
  GupshupOutboundMessage,
  GupshupNativeInboundWebhook,
  GupshupNativeMessageObj,
  GupshupNativeSenderObj,
  GupshupNativeContextObj,
  GupshupSendResponse,
  GupshupErrorResponse,
} from './types';
