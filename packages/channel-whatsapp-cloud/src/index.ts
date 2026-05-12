/**
 * WhatsApp Cloud API (Meta) Channel Plugin for Omni v2.
 *
 * Provides WhatsApp messaging via the official Meta Cloud API:
 *   - Outbound text / media / location / contacts / reactions / templates
 *   - Webhook inbound (HMAC-SHA256 signed) with phone_number_id-based instance routing
 *   - Embedded Signup OAuth (code → token → WABA + phone number discovery)
 *   - HSM template CRUD synchronized with Graph API
 *
 * @example
 * ```typescript
 * import whatsappCloudPlugin from '@omni/channel-whatsapp-cloud';
 * channelRegistry.register(whatsappCloudPlugin);
 * ```
 */

import { WhatsAppCloudPlugin } from './plugin';

const plugin = new WhatsAppCloudPlugin();
export default plugin;

// Plugin class — exposed so apps/tests can subclass or override.
export { WhatsAppCloudPlugin } from './plugin';

// Capabilities — declarative, useful for capability discovery.
export { WHATSAPP_CLOUD_CAPABILITIES } from './capabilities';

// HTTP client — exposed so OAuth routes (Group 5) and template service (Group 6)
// can reuse the same Graph API wrapper with their own (token, phone_number_id).
export { MetaWhatsAppClient } from './client';
export type { MetaWhatsAppClientOptions } from './client';

// Errors
export { MetaApiError, MetaErrorCode, mapHttpStatusToMetaError, isRetryable } from './utils/errors';
export type { MetaErrorCodeType, MetaApiErrorContext } from './utils/errors';

// Identity helpers
export { toMetaPhone, toE164, phonesEqual } from './utils/identity';

// Internal types
export type {
  WhatsAppCloudConfig,
  MetaAppLevelConfig,
  MetaOutboundMessage,
  MetaMediaPayload,
  MetaTemplatePayload,
  MetaSendResponse,
  MetaApiError as MetaApiErrorEnvelope,
  WhatsAppTemplateRecord,
} from './types';
