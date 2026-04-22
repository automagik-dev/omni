/**
 * Twilio Programmable Messaging client for WhatsApp.
 */

import type {
  TwilioMessageResponse,
  TwilioSendMessageInput,
  TwilioTypingIndicatorResponse,
  TwilioWhatsAppConfig,
} from './types';
import { TwilioWhatsAppError, TwilioWhatsAppErrorCode, mapTwilioWhatsAppError } from './utils/errors';
import { toTwilioWhatsAppAddress } from './utils/identity';

export class TwilioWhatsAppClient {
  constructor(private readonly config: TwilioWhatsAppConfig) {}

  private authorizationHeader(): string {
    return `Basic ${Buffer.from(`${this.config.twilioAccountSid}:${this.config.twilioAuthToken}`).toString('base64')}`;
  }

  private async parseResponse(res: Response): Promise<unknown> {
    const text = await res.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  private throwForError(parsed: unknown, status: number): never {
    const message =
      parsed && typeof parsed === 'object' && 'message' in parsed
        ? String((parsed as { message?: unknown }).message)
        : `Twilio API error: HTTP ${status}`;
    throw mapTwilioWhatsAppError(new Error(message), status);
  }

  async sendMessage(input: TwilioSendMessageInput): Promise<TwilioMessageResponse> {
    const body = new URLSearchParams();
    body.set('To', toTwilioWhatsAppAddress(input.to));

    const from = this.config.twilioFrom ? toTwilioWhatsAppAddress(this.config.twilioFrom) : undefined;
    if (from) {
      body.set('From', from);
    } else if (this.config.twilioMessagingServiceSid) {
      body.set('MessagingServiceSid', this.config.twilioMessagingServiceSid);
    } else {
      throw new TwilioWhatsAppError(
        TwilioWhatsAppErrorCode.BAD_REQUEST,
        'Either twilioFrom or twilioMessagingServiceSid is required',
      );
    }

    if (input.body !== undefined) body.set('Body', input.body);
    const mediaUrls = Array.isArray(input.mediaUrl) ? input.mediaUrl : input.mediaUrl ? [input.mediaUrl] : [];
    for (const mediaUrl of mediaUrls) {
      body.append('MediaUrl', mediaUrl);
    }
    const statusCallbackUrl = input.statusCallbackUrl ?? this.config.twilioStatusCallbackUrl;
    if (statusCallbackUrl) body.set('StatusCallback', statusCallbackUrl);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Messages.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authorizationHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const parsed = await this.parseResponse(res);

    if (!res.ok) {
      this.throwForError(parsed, res.status);
    }

    return parsed as TwilioMessageResponse;
  }

  async markMessageAsRead(messageSid: string): Promise<TwilioMessageResponse> {
    if (!/^(SM|MM)[0-9a-fA-F]{32}$/.test(messageSid)) {
      throw new TwilioWhatsAppError(
        TwilioWhatsAppErrorCode.BAD_REQUEST,
        'markMessageAsRead requires a Twilio MessageSid',
      );
    }

    const body = new URLSearchParams();
    body.set('Status', 'read');

    const url = `https://api.twilio.com/2010-04-01/Accounts/${this.config.twilioAccountSid}/Messages/${messageSid}.json`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authorizationHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const parsed = await this.parseResponse(res);
    if (!res.ok) {
      this.throwForError(parsed, res.status);
    }

    return parsed as TwilioMessageResponse;
  }

  async sendTypingIndicator(messageId: string): Promise<TwilioTypingIndicatorResponse> {
    if (!/^(SM|MM)[0-9a-fA-F]{32}$/.test(messageId)) {
      throw new TwilioWhatsAppError(
        TwilioWhatsAppErrorCode.BAD_REQUEST,
        'Typing indicator requires a Twilio MessageSid or MediaSid',
      );
    }

    const body = new URLSearchParams();
    body.set('messageId', messageId);
    body.set('channel', 'whatsapp');

    const res = await fetch('https://messaging.twilio.com/v2/Indicators/Typing.json', {
      method: 'POST',
      headers: {
        Authorization: this.authorizationHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });

    const parsed = await this.parseResponse(res);
    if (!res.ok) {
      this.throwForError(parsed, res.status);
    }

    return parsed as TwilioTypingIndicatorResponse;
  }
}
