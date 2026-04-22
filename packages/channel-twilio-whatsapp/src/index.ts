/**
 * Twilio WhatsApp Channel Plugin for Omni v2.
 */

import { TwilioWhatsAppPlugin } from './plugin';

const plugin = new TwilioWhatsAppPlugin();
export default plugin;

export { TwilioWhatsAppPlugin } from './plugin';
export { TWILIO_WHATSAPP_CAPABILITIES } from './capabilities';
export { TwilioWhatsAppClient } from './client';
export { handleTwilioWhatsAppWebhook } from './handlers/webhooks';
export { TwilioWhatsAppError, TwilioWhatsAppErrorCode, mapTwilioWhatsAppError, isRetryable } from './utils/errors';
export type { TwilioWhatsAppErrorCodeType } from './utils/errors';
export {
  normalizeE164Phone,
  normalizeTwilioWhatsAppAddress,
  stripTwilioWhatsAppPrefix,
  toTwilioWhatsAppAddress,
} from './utils/identity';
export { computeTwilioSignature, validateTwilioSignature } from './utils/signature';
export type {
  TwilioMessageResponse,
  TwilioSendMessageInput,
  TwilioWebhookParams,
  TwilioWhatsAppConfig,
} from './types';
