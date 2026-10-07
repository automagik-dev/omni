import type { OutgoingMessage } from '@omni/channel-sdk';
import { ChannelError, ERROR_CODES, type EvolutionConfig, EvolutionConfigSchema } from '@omni/core';
import { z } from 'zod';

export class EvolutionError extends ChannelError {
  constructor(
    readonly channelCode: string,
    message: string,
    readonly retryable = false,
  ) {
    super(ERROR_CODES.CHANNEL_SEND_FAILED, message, 'evolution-api', undefined, { recoverable: retryable });
    this.name = 'EvolutionError';
  }
}
export function canonicalJid(value: string): string {
  const input = value.trim().replace(/^\+/, '');
  if (/^\d+(?:-\d+)?@g\.us$/.test(input) || /^\d+@lid$/.test(input)) return input;
  const phone = input.replace(/(?::\d+)?@s\.whatsapp\.net$/, '');
  if (!/^\d{7,15}$/.test(phone))
    throw new EvolutionError('EVOLUTION_INVALID_RECIPIENT', 'Unsupported recipient identifier');
  return `${phone}@s.whatsapp.net`;
}
const sendResponse = z.object({
  key: z.object({ id: z.string().min(1), remoteJid: z.string().min(1), fromMe: z.literal(true) }),
});
const mediaUrl = z
  .string()
  .url()
  .refine((value) => new URL(value).protocol === 'https:', 'HTTPS media URL required');

export class EvolutionClient {
  readonly config: EvolutionConfig;
  private readonly origin: string;
  constructor(config: EvolutionConfig) {
    this.config = EvolutionConfigSchema.parse(config);
    this.origin = new URL(this.config.baseUrl).origin;
    // A tenant cannot choose a new credential destination. Self-hosted origins require operator approval.
    const allowed = (process.env.OMNI_EVOLUTION_ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim());
    if (!allowed.includes(this.origin))
      throw new EvolutionError('EVOLUTION_ORIGIN_DENIED', 'Evolution origin is not approved by the operator');
  }
  async request(path: string, method = 'GET', body?: unknown): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(`${this.origin}/${path}/${encodeURIComponent(this.config.instanceName)}`, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', apikey: this.config.apiKey },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new EvolutionError(
        'EVOLUTION_DELIVERY_UNKNOWN',
        'Evolution network outcome unknown; reconcile before retry',
      );
    }
    if (!response.ok)
      throw new EvolutionError(
        `EVOLUTION_HTTP_${response.status}`,
        `Evolution returned HTTP ${response.status}`,
        response.status === 429,
      );
    try {
      return await response.json();
    } catch {
      throw new EvolutionError('EVOLUTION_INVALID_RESPONSE', 'Evolution returned invalid JSON');
    }
  }
  async status(): Promise<'open' | 'close' | 'connecting'> {
    const data = z
      .object({ instance: z.object({ instanceName: z.string(), state: z.enum(['open', 'close', 'connecting']) }) })
      .parse(await this.request('instance/connectionState'));
    if (data.instance.instanceName !== this.config.instanceName)
      throw new EvolutionError('EVOLUTION_INSTANCE_MISMATCH', 'Evolution returned another instance');
    return data.instance.state;
  }
  async qr(): Promise<string> {
    const data = z
      .object({ base64: z.string().min(1).optional(), code: z.string().min(1).optional() })
      .parse(await this.request('instance/connect'));
    const qr = data.base64 ?? data.code;
    if (!qr) throw new EvolutionError('EVOLUTION_PAIRING_REQUIRED', 'Evolution did not return a QR code');
    return qr;
  }
  async send(message: OutgoingMessage): Promise<{ messageId: string; chatId: string }> {
    const chatId = canonicalJid(message.to);
    const number = chatId.replace(/@s\.whatsapp\.net$/, '');
    const c = message.content;
    if (message.replyTo || c.buttons?.length || c.list)
      throw new EvolutionError('EVOLUTION_UNSUPPORTED', 'Quotes and interactive messages are not implemented');
    let path: string;
    let body: Record<string, unknown> = { number };
    switch (c.type) {
      case 'text':
        path = 'message/sendText';
        body.text = z.string().min(1).max(65536).parse(c.text);
        break;
      case 'image':
      case 'audio':
      case 'video':
      case 'document':
        path = 'message/sendMedia';
        body = {
          ...body,
          mediatype: c.type,
          media: mediaUrl.parse(c.mediaUrl),
          caption: c.caption,
          mimetype: c.mimeType,
          fileName: c.filename,
        };
        break;
      case 'sticker':
        path = 'message/sendSticker';
        body.sticker = mediaUrl.parse(c.mediaUrl);
        break;
      case 'location':
        path = 'message/sendLocation';
        body = {
          ...body,
          ...z
            .object({
              latitude: z.number().finite().min(-90).max(90),
              longitude: z.number().finite().min(-180).max(180),
              name: z.string().optional(),
              address: z.string().optional(),
            })
            .strict()
            .parse(c.location),
        };
        break;
      case 'contact': {
        path = 'message/sendContact';
        const contact = z.object({ name: z.string().min(1), phone: z.string().min(1) }).parse(c.contact);
        const phone = canonicalJid(contact.phone);
        if (!phone.endsWith('@s.whatsapp.net'))
          throw new EvolutionError('EVOLUTION_INVALID_CONTENT', 'Contact requires a phone number');
        body.contact = [
          {
            fullName: contact.name,
            wuid: phone.replace(/@s\.whatsapp\.net$/, ''),
            phoneNumber: phone.replace(/@s\.whatsapp\.net$/, ''),
          },
        ];
        break;
      }
      default:
        throw new EvolutionError('EVOLUTION_UNSUPPORTED', `Evolution ${c.type} is not implemented`);
    }
    const parsed = sendResponse.safeParse(await this.request(path, 'POST', body));
    if (!parsed.success)
      throw new EvolutionError('EVOLUTION_DELIVERY_UNKNOWN', 'Evolution send response cannot be reconciled');
    // Evolution may resolve a LID to a phone JID; retain its authoritative routing key.
    return { messageId: parsed.data.key.id, chatId: canonicalJid(parsed.data.key.remoteJid) };
  }
}
