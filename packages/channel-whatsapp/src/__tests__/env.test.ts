import { describe, expect, test } from 'bun:test';
import {
  DEFAULT_WHATSAPP_OUTBOUND_TIMING,
  DEFAULT_WHATSAPP_RATE_LIMIT,
  getWhatsAppOutboundTimingConfig,
  getWhatsAppRateLimitConfig,
} from '../env';

describe('WhatsApp env config', () => {
  test('uses production-safe outbound timing defaults', () => {
    expect(getWhatsAppOutboundTimingConfig({})).toEqual(DEFAULT_WHATSAPP_OUTBOUND_TIMING);
  });

  test('parses outbound timing overrides and disable flags', () => {
    const config = getWhatsAppOutboundTimingConfig({
      WHATSAPP_HUMAN_DELAY_ENABLED: 'false',
      WHATSAPP_HUMAN_DELAY_MIN_MS: '0',
      WHATSAPP_HUMAN_DELAY_MAX_MS: '0',
      WHATSAPP_TYPING_SIMULATION_ENABLED: 'off',
      WHATSAPP_TYPING_DELAY_BASE_MS: '100',
      WHATSAPP_TYPING_DELAY_PER_CHAR_MS: '2',
      WHATSAPP_TYPING_DELAY_MAX_MS: '500',
      WHATSAPP_TYPING_DEFAULT_MS: '750',
    });

    expect(config).toEqual({
      humanDelayEnabled: false,
      humanDelayMinMs: 0,
      humanDelayMaxMs: 0,
      typingSimulationEnabled: false,
      typingDelayBaseMs: 100,
      typingDelayPerCharMs: 2,
      typingDelayMaxMs: 500,
      typingDefaultMs: 750,
    });
  });

  test('normalizes invalid values and inverted ranges', () => {
    const config = getWhatsAppOutboundTimingConfig({
      WHATSAPP_HUMAN_DELAY_ENABLED: 'maybe',
      WHATSAPP_HUMAN_DELAY_MIN_MS: '3000',
      WHATSAPP_HUMAN_DELAY_MAX_MS: '1000',
      WHATSAPP_TYPING_DELAY_BASE_MS: '-1',
      WHATSAPP_TYPING_DELAY_PER_CHAR_MS: 'nope',
    });

    expect(config.humanDelayEnabled).toBe(true);
    expect(config.humanDelayMinMs).toBe(3000);
    expect(config.humanDelayMaxMs).toBe(3000);
    expect(config.typingDelayBaseMs).toBe(DEFAULT_WHATSAPP_OUTBOUND_TIMING.typingDelayBaseMs);
    expect(config.typingDelayPerCharMs).toBe(DEFAULT_WHATSAPP_OUTBOUND_TIMING.typingDelayPerCharMs);
  });

  test('uses rate-limit defaults', () => {
    expect(getWhatsAppRateLimitConfig({})).toEqual(DEFAULT_WHATSAPP_RATE_LIMIT);
  });

  test('parses rate-limit overrides and normalizes max backoff', () => {
    expect(
      getWhatsAppRateLimitConfig({
        WHATSAPP_RATE_LIMIT_INITIAL_BACKOFF_MS: '5000',
        WHATSAPP_RATE_LIMIT_MAX_BACKOFF_MS: '1000',
        WHATSAPP_RATE_LIMIT_JITTER_FACTOR: '0',
      }),
    ).toEqual({
      initialBackoffMs: 5000,
      maxBackoffMs: 5000,
      jitterFactor: 0,
    });
  });
});
