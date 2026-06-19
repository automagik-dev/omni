import { describe, expect, test } from 'bun:test';
import { computeTwilioSignature, validateTwilioSignature } from '../utils/signature';

describe('Twilio signature utilities', () => {
  test('computes and validates x-www-form-urlencoded signatures', () => {
    const authToken = 'auth-token';
    const url = 'https://example.com/api/v2/channels/twilio-whatsapp/inst/webhook';
    const params = {
      Body: 'hello',
      From: 'whatsapp:+15551234567',
      MessageSid: 'SMaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      To: 'whatsapp:+15557654321',
    };

    const signature = computeTwilioSignature(authToken, url, params);
    expect(validateTwilioSignature(authToken, signature, url, params)).toBe(true);
    expect(validateTwilioSignature(authToken, 'invalid', url, params)).toBe(false);
  });
});
