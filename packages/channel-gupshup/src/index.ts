/**
 * Gupshup Channel Plugin for Omni v2
 *
 * Provides WhatsApp messaging via Gupshup BSP (Business Solution Provider).
 * Stateless REST API + webhook-based inbound — no persistent socket.
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

// Errors
export { GupshupError, GupshupErrorCode, mapGupshupError, isRetryable } from './utils/errors';
export type { GupshupErrorCodeType } from './utils/errors';

// Utils
export { normalizePhone, extractUserId, toGupshupPhone } from './utils/identity';

// Types
export type {
  GupshupConfig,
  GupshupInboundPayload,
  GupshupMessagePayload,
  GupshupMessageEventPayload,
  GupshupMessageType,
  GupshupTextContent,
  GupshupMediaContent,
  GupshupLocationContent,
  GupshupContactContent,
  GupshupContact,
  GupshupInteractiveContent,
  GupshupSendResponse,
  GupshupErrorResponse,
} from './types';
