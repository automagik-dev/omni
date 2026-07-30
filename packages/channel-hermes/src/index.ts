/**
 * Hermes API (Mutant) Channel Plugin for Omni v2.
 *
 * Provides WhatsApp messaging via the Hermes gateway (mutant.com.br):
 *   - Outbound text / media / location / contacts / reactions / templates /
 *     interactive (buttons + lists) with JWT bearer auth (single re-sign-in
 *     retry on 401).
 *   - Per-instance webhook inbound (`/api/v2/channels/hermes/:instanceId/webhook`)
 *     with `media_id` (line UUID) cross-check — Hermes has no signature scheme.
 *   - Inbound media arrives with a DIRECT `file` download URL (24h-lived).
 *
 * @example
 * ```typescript
 * import hermesPlugin from '@omni/channel-hermes';
 * channelRegistry.register(hermesPlugin);
 * ```
 */

import { HermesPlugin } from './plugin';

const plugin = new HermesPlugin();
export default plugin;

// Plugin class — exposed so apps/tests can subclass or override.
export { HermesPlugin } from './plugin';

// Capabilities — declarative, useful for capability discovery.
export { HERMES_CAPABILITIES } from './capabilities';

// HTTP client — exposed for future API routes needing raw Hermes access.
export { HermesClient } from './client';
export type { HermesClientOptions } from './client';

// Webhook handler — the api-side route delegates through plugin.handleWebhook,
// but the pure payload handler is exported for direct use/testing.
export { handleHermesWebhook, handleHermesWebhookRequest } from './handlers/webhook';

// Senders
export {
  sendText,
  sendMedia,
  resolveHermesMediaType,
  sendLocation,
  sendContact,
  sendReaction,
  sendTemplate,
  sendInteractiveButtons,
  sendInteractiveList,
} from './senders';
export type {
  HermesMediaKind,
  HermesMediaSource,
  SendTemplateOptions,
  InteractiveButton,
  InteractiveListSection,
  SendInteractiveListOptions,
} from './senders';

// Errors
export { HermesApiError, HermesErrorCode, mapHttpStatusToHermesError, isRetryable } from './utils/errors';
export type { HermesErrorCodeType, HermesApiErrorContext } from './utils/errors';

// Identity helpers
export { toHermesPhone, toE164 } from './utils/identity';

// Internal types
export type {
  HermesConfig,
  HermesOutboundMessage,
  HermesSendResponse,
  HermesSignInResponse,
  HermesUploadResponse,
  HermesLocationPayload,
  HermesContactCardInput,
  HermesContactRecord,
  HermesTemplatePayload,
  HermesInteractivePayload,
  HermesInteractiveButtonPayload,
  HermesInteractiveListPayload,
} from './types';
