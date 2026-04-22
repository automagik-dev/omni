/**
 * Twilio WhatsApp webhook handler.
 *
 * Twilio sends incoming messages and status callbacks as
 * application/x-www-form-urlencoded POST requests.
 */

import { createDownloadGuard, sanitizeMessage } from '@omni/channel-sdk';
import type { DedupeCache } from '@omni/channel-sdk';

import type { TwilioWhatsAppPlugin } from '../plugin';
import type { TwilioWebhookParams, TwilioWhatsAppConfig } from '../types';
import { normalizeTwilioWhatsAppAddress } from '../utils/identity';
import { validateTwilioSignature } from '../utils/signature';

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;
const downloadGuard = createDownloadGuard();

type ExtractedContent = {
  type: string;
  text?: string;
  mediaUrl?: string;
  mimeType?: string;
  caption?: string;
  filename?: string;
  location?: {
    latitude: number;
    longitude: number;
    name?: string;
    address?: string;
  };
};

function paramsToObject(params: URLSearchParams): TwilioWebhookParams {
  const result: TwilioWebhookParams = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
}

function paramsForSignature(params: TwilioWebhookParams): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function parseMediaCount(value: string | undefined): number {
  if (!value) return 0;
  const count = Number.parseInt(value, 10);
  return Number.isNaN(count) ? 0 : count;
}

function guardTwilioMediaSizes(
  params: TwilioWebhookParams,
  logger: import('@omni/core').Logger,
  instanceId: string,
): boolean {
  const mediaCount = parseMediaCount(params.NumMedia);
  for (let index = 0; index < mediaCount; index += 1) {
    const size = Number.parseInt(params[`MediaSize${index}`] ?? '', 10);
    if (Number.isNaN(size)) continue;

    try {
      downloadGuard.checkSize(size, logger, {
        instanceId,
        url: params[`MediaUrl${index}`],
        channel: 'twilio-whatsapp',
      });
    } catch {
      return false;
    }
  }

  return true;
}

function contentTypeToOmniType(mimeType: string | undefined): string {
  if (!mimeType) return 'document';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'document';
}

function extractLocationContent(params: TwilioWebhookParams): ExtractedContent | null {
  if (!params.Latitude || !params.Longitude) return null;
  const latitude = Number.parseFloat(params.Latitude);
  const longitude = Number.parseFloat(params.Longitude);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) return null;
  const text = [params.Label, params.Address].filter(Boolean).join(', ') || `${latitude},${longitude}`;
  return {
    type: 'location',
    text,
    location: {
      latitude,
      longitude,
      name: params.Label,
      address: params.Address,
    },
  };
}

function extractContent(params: TwilioWebhookParams): ExtractedContent | null {
  const location = extractLocationContent(params);
  if (location) return location;

  const mediaCount = parseMediaCount(params.NumMedia);
  if (mediaCount > 0 && params.MediaUrl0) {
    const mimeType = params.MediaContentType0;
    return {
      type: contentTypeToOmniType(mimeType),
      text: params.Body || undefined,
      caption: params.Body || undefined,
      mediaUrl: params.MediaUrl0,
      mimeType,
    };
  }

  const richText = params.ButtonText ?? params.FlowData ?? params.InteractiveData;
  const text = params.Body || richText;
  if (!text) return null;
  return { type: 'text', text };
}

function isStatusCallback(params: TwilioWebhookParams): boolean {
  const status = params.MessageStatus ?? params.SmsStatus ?? params.EventType;
  if (!status) return false;
  if (status.toLowerCase() === 'received') return false;
  if (params.Latitude || params.Longitude || params.ButtonText || params.FlowData || params.InteractiveData) {
    return false;
  }
  return !params.Body && parseMediaCount(params.NumMedia) === 0;
}

async function processStatusCallback(
  plugin: TwilioWhatsAppPlugin,
  instanceId: string,
  params: TwilioWebhookParams,
): Promise<void> {
  const externalId = params.MessageSid ?? params.SmsMessageSid ?? params.SmsSid;
  if (!externalId) return;
  const to = params.To ? normalizeTwilioWhatsAppAddress(params.To) : 'unknown';
  const status = (params.MessageStatus ?? params.SmsStatus ?? params.EventType ?? '').toLowerCase();

  if (status === 'delivered') {
    await plugin.handleMessageDelivered({ instanceId, externalId, to });
  } else if (status === 'read') {
    await plugin.handleMessageRead({ instanceId, externalId, to });
  } else if (status === 'failed' || status === 'undelivered') {
    await plugin.handleMessageFailed({
      instanceId,
      externalId,
      to,
      reason: params.ErrorMessage ?? params.ErrorCode ?? `Twilio status: ${status}`,
    });
  }
}

async function processInboundMessage(
  plugin: TwilioWhatsAppPlugin,
  instanceId: string,
  params: TwilioWebhookParams,
  dedupeCache: DedupeCache,
): Promise<void> {
  const externalId = params.MessageSid ?? params.SmsMessageSid ?? params.SmsSid;
  if (!externalId || !params.From) return;

  const from = normalizeTwilioWhatsAppAddress(params.From);
  const dedupeKey = `${from}:${externalId}`;
  if (
    dedupeCache.isDuplicate(instanceId, dedupeKey, 'twilio-whatsapp', plugin.getLogger() as import('@omni/core').Logger)
  ) {
    return;
  }

  const content = extractContent(params);
  if (!content) return;
  if (!guardTwilioMediaSizes(params, plugin.getLogger() as import('@omni/core').Logger, instanceId)) return;

  if (content.text) {
    const sanitized = sanitizeMessage(content.text, plugin.getLogger() as import('@omni/core').Logger, {
      instanceId,
      messageId: externalId,
    });
    if (!sanitized.ok) return;
    content.text = sanitized.text;
  }

  await plugin.handleMessageReceived({
    instanceId,
    externalId,
    chatId: from,
    from,
    content,
    rawPayload: {
      ...params,
      pushName: params.ProfileName,
      twilioWaId: params.WaId,
    } as Record<string, unknown>,
    platformTimestamp: Date.now(),
    replyTo: params.OriginalRepliedMessageSid,
  });
}

export async function handleTwilioWhatsAppWebhook(
  request: Request,
  plugin: TwilioWhatsAppPlugin,
  instanceId: string,
  config: TwilioWhatsAppConfig,
  dedupeCache: DedupeCache,
): Promise<Response> {
  const logger = plugin.getLogger();

  let body: string;
  try {
    body = await request.text();
  } catch {
    return new Response('OK', { status: 200 });
  }

  if (body.length > MAX_WEBHOOK_BODY_BYTES) {
    logger.warn('[twilio-whatsapp] oversized webhook body rejected', { instanceId, size: body.length });
    return new Response('OK', { status: 200 });
  }

  const searchParams = new URLSearchParams(body);
  const params = paramsToObject(searchParams);

  if (config.twilioValidateSignature) {
    const validationUrl = config.twilioWebhookUrl ?? request.url;
    const valid = validateTwilioSignature(
      config.twilioAuthToken,
      request.headers.get('x-twilio-signature'),
      validationUrl,
      paramsForSignature(params),
    );
    if (!valid) {
      logger.warn('[twilio-whatsapp] invalid webhook signature', { instanceId, validationUrl });
      return new Response('Unauthorized', { status: 401 });
    }
  }

  if (params.AccountSid && params.AccountSid !== config.twilioAccountSid) {
    logger.warn('[twilio-whatsapp] account SID mismatch', { instanceId, accountSid: params.AccountSid });
    return new Response('Forbidden', { status: 403 });
  }

  if (isStatusCallback(params)) {
    await processStatusCallback(plugin, instanceId, params);
    return new Response('OK', { status: 200 });
  }

  await processInboundMessage(plugin, instanceId, params, dedupeCache);
  return new Response('OK', { status: 200 });
}
