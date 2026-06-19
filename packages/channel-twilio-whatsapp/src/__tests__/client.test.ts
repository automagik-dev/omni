import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { TwilioWhatsAppClient } from '../client';
import type { TwilioWhatsAppConfig } from '../types';
import { TwilioWhatsAppError } from '../utils/errors';

const config: TwilioWhatsAppConfig = {
  twilioAccountSid: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  twilioAuthToken: 'auth-token',
  twilioFrom: 'whatsapp:+15550001111',
  twilioStatusCallbackUrl: 'https://example.com/status',
  twilioValidateSignature: true,
};

function okResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  spyOn(globalThis, 'fetch').mockRestore();
});

describe('TwilioWhatsAppClient', () => {
  test('posts text messages to Twilio Messages resource', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ sid: 'SM123', status: 'queued' }));
    const client = new TwilioWhatsAppClient(config);

    await client.sendMessage({ to: '+15559998888', body: 'hello' });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.twilio.com/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages.json');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toStartWith('Basic ');

    const body = init.body as URLSearchParams;
    expect(body.get('To')).toBe('whatsapp:+15559998888');
    expect(body.get('From')).toBe('whatsapp:+15550001111');
    expect(body.get('Body')).toBe('hello');
    expect(body.get('StatusCallback')).toBe('https://example.com/status');
  });

  test('uses MessagingServiceSid when From is not configured', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ sid: 'SM123' }));
    const client = new TwilioWhatsAppClient({
      ...config,
      twilioFrom: undefined,
      twilioMessagingServiceSid: 'MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    await client.sendMessage({ to: '+15559998888', body: 'hello' });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get('From')).toBeNull();
    expect(body.get('MessagingServiceSid')).toBe('MGaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  test('sends media URL when provided', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ sid: 'SM123' }));
    const client = new TwilioWhatsAppClient(config);

    await client.sendMessage({ to: '+15559998888', body: 'caption', mediaUrl: 'https://cdn.example.com/a.jpg' });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get('MediaUrl')).toBe('https://cdn.example.com/a.jpg');
    expect(body.get('Body')).toBe('caption');
  });

  test('throws channel error on non-2xx response', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'Forbidden' }), { status: 403 }),
    );
    const client = new TwilioWhatsAppClient(config);

    await expect(client.sendMessage({ to: '+15559998888', body: 'hello' })).rejects.toBeInstanceOf(TwilioWhatsAppError);
  });

  test('posts Status=read to Messages resource to mark a message as read', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      okResponse({ sid: 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', status: 'read' }),
    );
    const client = new TwilioWhatsAppClient(config);

    await client.markMessageAsRead('SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.twilio.com/2010-04-01/Accounts/ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/Messages/SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.json',
    );
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toStartWith('Basic ');

    const body = init.body as URLSearchParams;
    expect(body.get('Status')).toBe('read');
  });

  test('rejects markMessageAsRead without a Twilio message id', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ sid: 'SM123' }));
    const client = new TwilioWhatsAppClient(config);

    await expect(client.markMessageAsRead('local-message-id')).rejects.toBeInstanceOf(TwilioWhatsAppError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('posts typing indicators to Twilio Messaging endpoint', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ success: true }));
    const client = new TwilioWhatsAppClient(config);

    await client.sendTypingIndicator('SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://messaging.twilio.com/v2/Indicators/Typing.json');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toStartWith('Basic ');

    const body = init.body as URLSearchParams;
    expect(body.get('messageId')).toBe('SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(body.get('channel')).toBe('whatsapp');
  });

  test('rejects typing indicators without a Twilio message id', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(okResponse({ success: true }));
    const client = new TwilioWhatsAppClient(config);

    await expect(client.sendTypingIndicator('local-message-id')).rejects.toBeInstanceOf(TwilioWhatsAppError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
