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

// Template service (Group 6) — CRUD against Graph API + local-DB sync helpers.
// Consumed by `@omni/api/src/routes/v2/templates.ts` and by the inbound webhook
// handler (Group 4) for `message_template_status_update` events.
export {
  listTemplatesFromMeta,
  getTemplateFromMeta,
  createTemplate,
  deleteTemplate,
  uploadHeaderMedia,
  syncTemplatesToDb,
  handleTemplateStatusUpdate,
} from './templates';
export type {
  MetaTemplateRecord,
  CreateTemplateInput,
  CreateTemplateResult,
  UploadHeaderMediaInput,
  SyncResult,
} from './templates';

// WhatsApp Flow sender — consumed by the plugin dispatch (content.type='flow')
// and exposed for direct use alongside the flows REST surface at
// `packages/api/src/routes/v2/whatsapp-flows.ts`.
export { sendFlow } from './senders/flow';
export type { SendFlowResult } from './senders/flow';

// WhatsApp Flows data-exchange endpoint pieces — resolver registry (register
// screen logic per flow), token helpers, and crypto/keygen used by the keys
// REST route (`POST /instances/:id/whatsapp-flows/keys`).
export {
  FlowResolverRegistry,
  buildFlowToken,
  parseFlowToken,
  errorScreenResponse,
} from './flows/resolver';
export { createDemoFlowResolver } from './flows/demo-resolver';
export type { FlowResolver, FlowResolveContext, FlowScreenResponse } from './flows/resolver';
export { generateFlowKeyPair } from './utils/flow-crypto';
export type { MetaFlowValidationError } from './client';

// Embedded Signup OAuth helpers — pure functions consumed by the REST surface
// at `packages/api/src/routes/v2/whatsapp-cloud.ts` (Group 5).
export {
  exchangeCodeForToken,
  getWabaDetails,
  registerPhoneNumber,
  subscribeApp,
  DEFAULT_META_API_VERSION,
} from './oauth';
export type { ExchangeCodeResult, WabaDetails, WabaPhoneNumber } from './oauth';

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
