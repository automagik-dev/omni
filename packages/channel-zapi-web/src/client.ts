import type { OutgoingContent, OutgoingMessage } from '@omni/channel-sdk';
import { ChannelError, ERROR_CODES, OutboundTemplateSchema, type ZapiConfig } from '@omni/core';
import { z } from 'zod';

export class ZapiError extends ChannelError {
  constructor(
    readonly channelCode: string,
    message: string,
    readonly retryable = false,
  ) {
    super(ERROR_CODES.CHANNEL_SEND_FAILED, message, 'zapi', undefined, { recoverable: retryable });
    this.name = 'ZapiError';
  }
}
const responseSchema = z.object({ messageId: z.string().min(1), zaapId: z.string().optional() }).passthrough();
const mediaUrlSchema = z
  .string()
  .url()
  .refine((s) => new URL(s).protocol === 'https:', 'Public HTTPS media URL required');
const locationSchema = z
  .object({
    latitude: z.number().finite().min(-90).max(90),
    longitude: z.number().finite().min(-180).max(180),
    name: z.string().optional(),
    address: z.string().optional(),
  })
  .strict();
/** Preserve non-phone identities; never turn LIDs or group IDs into phone digits. */
export function recipient(value: string, official = false): string {
  const input = value.trim();
  if (!official && /^\d+(?:-\d+)?@g\.us$/.test(input)) return input.replace(/@g\.us$/, '-group');
  if (!official && /^\d+(?:-\d+)?-group$/.test(input)) return input;
  if (!official && /^\d+@lid$/.test(input)) return input;
  const phone = input.replace(/@s\.whatsapp\.net$/, '').replace(/^[+]/, '');
  if (!/^\d{7,15}$/.test(phone)) throw new ZapiError('ZAPI_INVALID_RECIPIENT', 'Unsupported recipient identifier');
  return phone;
}

export function canonicalChatId(value: string): string {
  return /^\d+(?:-\d+)?-group$/.test(value) ? value.replace(/-group$/, '@g.us') : value;
}

/** Fixed vendor origins; tenant config cannot redirect credentials to another host. */
export class ZapiClient {
  constructor(readonly config: ZapiConfig) {}
  async request(path: string, method = 'GET', payload?: unknown): Promise<unknown> {
    const c = this.config;
    const base =
      c.driver === 'web'
        ? `https://api.z-api.io/instances/${encodeURIComponent(c.instanceId)}/token/${encodeURIComponent(c.instanceToken)}`
        : 'https://api.omni.z-api.io';
    let res: Response;
    try {
      res = await fetch(`${base}/${path}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: {
          'Content-Type': 'application/json',
          ...(c.driver === 'web' ? { 'Client-Token': c.clientToken } : { Authorization: `Bearer ${c.secretKey}` }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
    } catch {
      // A POST may already have been accepted: upstream MUST NOT retry blindly.
      throw new ZapiError('ZAPI_DELIVERY_UNKNOWN', 'Z-API network outcome unknown; reconcile before retry');
    }
    if (!res.ok)
      throw new ZapiError(`ZAPI_HTTP_${res.status}`, `Z-API returned HTTP ${res.status}`, res.status === 429);
    try {
      return await res.json();
    } catch {
      throw new ZapiError('ZAPI_INVALID_RESPONSE', 'Z-API returned invalid JSON');
    }
  }
  async status(): Promise<boolean> {
    if (this.config.driver === 'web')
      return z.object({ connected: z.boolean() }).parse(await this.request('status')).connected;
    const c = z
      .object({ id: z.string(), type: z.string(), whatsappConnected: z.boolean() })
      .parse(await this.request(`v1/channels/${encodeURIComponent(this.config.channelId)}`));
    if (c.id !== this.config.channelId || c.type !== 'META_WHATSAPP')
      throw new ZapiError('ZAPI_CHANNEL_MISMATCH', 'Expected configured META_WHATSAPP channel');
    return c.whatsappConnected;
  }
  async send(message: OutgoingMessage): Promise<{ messageId: string; zaapId?: string }> {
    const c = this.config;
    if (c.driver === 'omni') {
      if (message.replyTo) throw new ZapiError('ZAPI_UNSUPPORTED', 'Official reply wire format is not documented');
      return responseSchema.parse(
        await this.request(`v1/channels/${encodeURIComponent(c.channelId)}/messages`, 'POST', {
          recipient: { identifier: recipient(message.to, true) },
          content: officialContent(message),
        }),
      );
    }
    const request = webRequest(message);
    return responseSchema.parse(
      await this.request(request.path, 'POST', { phone: recipient(message.to), ...request.body }),
    );
  }
}
function officialContent(message: OutgoingMessage): Record<string, unknown> {
  const c = message.content;
  if (c.list) throw new ZapiError('ZAPI_UNSUPPORTED', 'Official lists are under development');
  switch (c.type) {
    case 'template':
      return { type: 'TEMPLATE', attachments: [{ template: officialTemplate(message.metadata?.template) }] };
    case 'text':
      return officialText(c);
    case 'image':
    case 'audio':
    case 'video':
    case 'sticker':
      return {
        type: c.type.toUpperCase(),
        attachments: [{ url: mediaUrlSchema.parse(c.mediaUrl), ...(c.caption ? { caption: c.caption } : {}) }],
      };
    case 'location': {
      const location = locationSchema.parse(c.location);
      return {
        type: 'LOCATION',
        attachments: [{ ...location, latitude: String(location.latitude), longitude: String(location.longitude) }],
      };
    }
    case 'contact': {
      const contact = z.object({ name: z.string().min(1), phone: z.string().min(1) }).parse(c.contact);
      return { type: 'CONTACT', attachments: [{ name: contact.name, phones: [recipient(contact.phone, true)] }] };
    }
    default:
      throw new ZapiError('ZAPI_UNSUPPORTED', `Official ${c.type} is not enabled`);
  }
}
function officialText(c: OutgoingContent): Record<string, unknown> {
  const body = { message: z.string().min(1).parse(c.text) };
  if (!c.buttons?.length) return { type: 'TEXT', body };
  if (c.buttons.length > 3 || c.buttons.some((b) => !b.data || b.url))
    throw new ZapiError('ZAPI_UNSUPPORTED', 'Use up to three reply buttons');
  return { type: 'INTERACTIVE_BUTTON', body, attachments: c.buttons.map((b) => ({ id: b.data, title: b.text })) };
}
type WebRequest = { path: string; body: Record<string, unknown> };
function webText(message: OutgoingMessage): WebRequest {
  const c = message.content;
  const body: Record<string, unknown> = { message: z.string().min(1).parse(c.text) };
  if (!c.buttons?.length) {
    if (c.list) throw new ZapiError('ZAPI_INVALID_CONTENT', 'List requires options');
    return { path: message.replyTo ? 'reply-message' : 'send-text', body };
  }
  if (message.replyTo || c.buttons.some((b) => !b.data || b.url))
    throw new ZapiError('ZAPI_UNSUPPORTED', 'Reply buttons require callback data and no quote');
  if (c.list)
    return {
      path: 'send-option-list',
      body: {
        ...body,
        optionList: {
          title: c.list.sectionTitle ?? 'Options',
          buttonLabel: c.list.buttonLabel ?? 'Choose',
          options: c.buttons.map((b) => ({ id: b.data, title: b.text, description: b.description ?? b.text })),
        },
      },
    };
  return {
    path: 'send-button-list',
    body: { ...body, buttonList: { buttons: c.buttons.map((b) => ({ id: b.data, label: b.text })) } },
  };
}
function webMedia(c: OutgoingContent): WebRequest {
  const body: Record<string, unknown> = { [c.type]: mediaUrlSchema.parse(c.mediaUrl) };
  let path = `send-${c.type}`;
  if (c.type === 'document') {
    const extension = c.filename?.split('.').pop();
    if (!extension || !/^[a-zA-Z0-9]{1,10}$/.test(extension))
      throw new ZapiError('ZAPI_INVALID_CONTENT', 'Document filename needs an extension');
    path += `/${extension}`;
    body.fileName = c.filename;
  }
  if (c.caption && c.type !== 'audio' && c.type !== 'sticker') body.caption = c.caption;
  return { path, body };
}
function webRequest(message: OutgoingMessage): WebRequest {
  const c = message.content;
  let request: WebRequest;
  switch (c.type) {
    case 'text':
      request = webText(message);
      break;
    case 'image':
    case 'audio':
    case 'video':
    case 'sticker':
    case 'document':
      request = webMedia(c);
      break;
    case 'location': {
      const location = locationSchema.parse(c.location);
      request = {
        path: 'send-location',
        body: {
          latitude: String(location.latitude),
          longitude: String(location.longitude),
          title: location.name,
          address: location.address,
        },
      };
      break;
    }
    case 'contact': {
      const contact = z.object({ name: z.string().min(1), phone: z.string().min(1) }).parse(c.contact);
      request = { path: 'send-contact', body: { contactName: contact.name, contactPhone: recipient(contact.phone) } };
      break;
    }
    case 'reaction':
      request = {
        path: 'send-reaction',
        body: { messageId: z.string().min(1).parse(c.targetMessageId), reaction: z.string().min(1).parse(c.emoji) },
      };
      break;
    default:
      throw new ZapiError('ZAPI_UNSUPPORTED', `Web ${c.type} is not enabled`);
  }
  if (message.replyTo && c.type !== 'reaction') request.body.messageId = message.replyTo;
  return request;
}

function officialTemplate(raw: unknown): Record<string, unknown> {
  const template = OutboundTemplateSchema.parse(raw);
  const components: Record<string, unknown>[] = [];
  if (template.headerMedia) {
    const media = template.headerMedia;
    components.push({
      type: 'header',
      parameters: [
        {
          type: media.type,
          [media.type]: {
            link: mediaUrlSchema.parse(media.link),
            ...(media.filename ? { filename: media.filename } : {}),
          },
        },
      ],
    });
  }
  if (template.bodyParameters?.length)
    components.push({ type: 'body', parameters: template.bodyParameters.map((text) => ({ type: 'text', text })) });
  for (const button of template.buttonParameters ?? [])
    components.push({
      type: 'button',
      sub_type: button.sub_type,
      index: String(button.index),
      parameters: [
        button.sub_type !== 'url'
          ? { type: 'payload', payload: z.string().min(1).parse(button.payload) }
          : { type: 'text', text: z.string().min(1).parse(button.text) },
      ],
    });
  return { name: template.name, language: { code: template.language, policy: 'deterministic' }, components };
}
