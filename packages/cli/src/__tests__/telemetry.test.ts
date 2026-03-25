/**
 * Telemetry Module Tests
 *
 * Tests arg sanitization, opt-out logic, and ensures sensitive data is never sent.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isTelemetryDisabled, sanitizeArgs } from '../telemetry.js';

describe('sanitizeArgs', () => {
  test('passes through safe args unchanged', () => {
    const args = ['send', '--instance', 'abc-123', '--to', '+5511999'];
    expect(sanitizeArgs(args)).toEqual(args);
  });

  test('redacts --api-key value (space-separated)', () => {
    const args = ['auth', 'login', '--api-key', 'test-api-key-value'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['auth', 'login', '--api-key', '[REDACTED]']);
  });

  test('redacts --api-key value (equals-separated)', () => {
    const args = ['auth', 'login', '--api-key=test-api-key-value'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['auth', 'login', '--api-key=[REDACTED]']);
  });

  test('redacts --text message content', () => {
    const args = ['send', '--instance', 'abc', '--to', '+55119', '--text', 'Hello world'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['send', '--instance', 'abc', '--to', '+55119', '--text', '[REDACTED]']);
  });

  test('redacts --token value', () => {
    const args = ['--token', 'my-secret-token', 'status'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['--token', '[REDACTED]', 'status']);
  });

  test('redacts --password value', () => {
    const args = ['auth', '--password', 'testpass'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['auth', '--password', '[REDACTED]']);
  });

  test('redacts --caption value', () => {
    const args = ['send', '--media', 'photo.jpg', '--caption', 'My vacation'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['send', '--media', 'photo.jpg', '--caption', '[REDACTED]']);
  });

  test('redacts --tts value', () => {
    const args = ['send', '--tts', 'Hello there'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['send', '--tts', '[REDACTED]']);
  });

  test('redacts --message value', () => {
    const args = ['send', '--message', 'some private msg'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['send', '--message', '[REDACTED]']);
  });

  test('redacts --body value', () => {
    const args = ['webhooks', 'test', '--body', '{"secret": "data"}'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['webhooks', 'test', '--body', '[REDACTED]']);
  });

  test('redacts multiple sensitive flags', () => {
    const args = ['send', '--api-key', 'test-key', '--text', 'hello', '--instance', 'abc'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['send', '--api-key', '[REDACTED]', '--text', '[REDACTED]', '--instance', 'abc']);
  });

  test('is case-insensitive for flag matching', () => {
    const args = ['auth', '--API-KEY', 'test-key'];
    const result = sanitizeArgs(args);
    expect(result).toEqual(['auth', '--API-KEY', '[REDACTED]']);
  });

  test('handles empty args', () => {
    expect(sanitizeArgs([])).toEqual([]);
  });

  test('handles single arg', () => {
    expect(sanitizeArgs(['help'])).toEqual(['help']);
  });

  test('does not mutate input array', () => {
    const args = ['auth', '--api-key', 'secret'];
    const original = [...args];
    sanitizeArgs(args);
    expect(args).toEqual(original);
  });
});

describe('isTelemetryDisabled', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.OMNI_TELEMETRY;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      process.env.OMNI_TELEMETRY = undefined;
    } else {
      process.env.OMNI_TELEMETRY = originalEnv;
    }
  });

  test('returns false when env var is not set (default enabled)', () => {
    process.env.OMNI_TELEMETRY = undefined;
    // This also depends on config, which defaults to undefined (enabled)
    // In test environment without config file, should return false
    expect(isTelemetryDisabled()).toBe(false);
  });

  test('returns true when OMNI_TELEMETRY=false', () => {
    process.env.OMNI_TELEMETRY = 'false';
    expect(isTelemetryDisabled()).toBe(true);
  });

  test('returns true when OMNI_TELEMETRY=FALSE (case-insensitive)', () => {
    process.env.OMNI_TELEMETRY = 'FALSE';
    expect(isTelemetryDisabled()).toBe(true);
  });

  test('returns true when OMNI_TELEMETRY=0', () => {
    process.env.OMNI_TELEMETRY = '0';
    expect(isTelemetryDisabled()).toBe(true);
  });

  test('returns false when OMNI_TELEMETRY=true', () => {
    process.env.OMNI_TELEMETRY = 'true';
    expect(isTelemetryDisabled()).toBe(false);
  });

  test('env var takes precedence over config', () => {
    // Even if config has telemetry: false, env var overrides
    process.env.OMNI_TELEMETRY = 'true';
    expect(isTelemetryDisabled()).toBe(false);
  });
});
