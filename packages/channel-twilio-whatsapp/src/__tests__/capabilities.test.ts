import { describe, expect, test } from 'bun:test';
import { TWILIO_WHATSAPP_CAPABILITIES } from '../capabilities';

describe('TWILIO_WHATSAPP_CAPABILITIES', () => {
  test('declares stateless WhatsApp BSP constraints', () => {
    expect(TWILIO_WHATSAPP_CAPABILITIES.canSendText).toBe(true);
    expect(TWILIO_WHATSAPP_CAPABILITIES.canSendMedia).toBe(true);
    expect(TWILIO_WHATSAPP_CAPABILITIES.canSendTyping).toBe(true);
    expect(TWILIO_WHATSAPP_CAPABILITIES.canHandleGroups).toBe(false);
    expect(TWILIO_WHATSAPP_CAPABILITIES.canReceiveDeliveryReceipts).toBe(true);
    expect(TWILIO_WHATSAPP_CAPABILITIES.canReceiveReadReceipts).toBe(true);
    expect(TWILIO_WHATSAPP_CAPABILITIES.hasMessagingWindow).toBe(true);
    expect(TWILIO_WHATSAPP_CAPABILITIES.messagingWindowMs).toBe(24 * 60 * 60 * 1000);
  });

  test('uses Twilio message resource body/media limits', () => {
    expect(TWILIO_WHATSAPP_CAPABILITIES.maxMessageLength).toBe(1600);
    expect(TWILIO_WHATSAPP_CAPABILITIES.maxFileSize).toBe(5 * 1024 * 1024);
  });
});
