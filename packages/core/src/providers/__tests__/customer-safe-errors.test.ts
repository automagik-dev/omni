/**
 * Tests for customer-safe-errors — the guard that stops raw provider/billing
 * errors (and leaked secrets) from reaching customers.
 *
 * Focus:
 * - the tightened `Bearer` branch no longer false-positives on benign English
 *   (gemini review on #739), while still catching real leaked tokens;
 * - the existing provider/secret patterns still trip;
 * - the message is overridable via OMNI_SAFE_PROVIDER_ERROR_MESSAGE.
 */

import { describe, expect, it } from 'bun:test';

import {
  SAFE_PROVIDER_ERROR_MESSAGE,
  resolveSafeProviderErrorMessage,
  toSafeCustomerFallback,
} from '../customer-safe-errors';

describe('toSafeCustomerFallback — Bearer false positives', () => {
  it.each([
    'Bearer of bad news: your appointment was cancelled.',
    'She was the bearer of glad tidings today.',
    'Bearer token required.',
    'Please become a Bearer of good will.',
  ])('does NOT block benign English after "bearer": %s', (text) => {
    expect(toSafeCustomerFallback(text)).toBe(text);
  });

  it.each([
    // Low-entropy placeholders (not real secrets) that still satisfy the 20+ char rule.
    'Authorization failed: Bearer EXAMPLE0EXAMPLE0EXAMPLE0EXAMPLE0',
    'Bearer PLACEHOLDERTOKENPLACEHOLDERTOKEN',
  ])('still blocks a real leaked bearer token: %s', (text) => {
    expect(toSafeCustomerFallback(text)).toBe(SAFE_PROVIDER_ERROR_MESSAGE);
  });
});

describe('toSafeCustomerFallback — existing leak patterns still trip', () => {
  it.each([
    'litellm.AuthenticationError: invalid key',
    'ModelProviderError: upstream 500',
    'your credit balance is too low to run this',
    'sk-EXAMPLEKEYPLACEHOLDER',
    'api_key=EXAMPLE_PLACEHOLDER',
    'Received API Key for the wrong org',
  ])('blocks: %s', (text) => {
    expect(toSafeCustomerFallback(text)).toBe(SAFE_PROVIDER_ERROR_MESSAGE);
  });

  it('passes through ordinary agent replies untouched', () => {
    const ok = 'Sure! Your order #1234 ships tomorrow.';
    expect(toSafeCustomerFallback(ok)).toBe(ok);
  });

  it('returns empty string for null/undefined', () => {
    expect(toSafeCustomerFallback(null)).toBe('');
    expect(toSafeCustomerFallback(undefined)).toBe('');
  });
});

describe('resolveSafeProviderErrorMessage', () => {
  it('defaults to the pt-BR message when no env override', () => {
    expect(resolveSafeProviderErrorMessage({})).toBe(SAFE_PROVIDER_ERROR_MESSAGE);
  });

  it('honors OMNI_SAFE_PROVIDER_ERROR_MESSAGE', () => {
    const env = { OMNI_SAFE_PROVIDER_ERROR_MESSAGE: 'We hit a snag, please try again shortly.' };
    expect(resolveSafeProviderErrorMessage(env)).toBe('We hit a snag, please try again shortly.');
    // ...and the override flows through the blocking path too.
    expect(toSafeCustomerFallback('litellm.APIError: boom', env)).toBe('We hit a snag, please try again shortly.');
  });

  it('ignores a blank override and falls back to default', () => {
    expect(resolveSafeProviderErrorMessage({ OMNI_SAFE_PROVIDER_ERROR_MESSAGE: '   ' })).toBe(
      SAFE_PROVIDER_ERROR_MESSAGE,
    );
  });
});
