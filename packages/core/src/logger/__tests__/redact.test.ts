import { describe, expect, test } from 'bun:test';
import { redactObject, redactString } from '../redact';

describe('redactString', () => {
  test('redacts Telegram bot tokens', () => {
    const input = 'Error: token 12345678:ABCdefGHIJKLmnoPQRSTuvwxyz123456789 is invalid';
    const result = redactString(input);
    expect(result).toContain('[REDACTED_BOT_TOKEN]');
    expect(result).not.toContain('ABCdefGHIJKLmnoPQRSTuvwxyz123456789');
  });

  test('redacts multiple bot tokens in one string', () => {
    const input =
      'token1: 12345678:ABCdefGHIJKLmnoPQRSTuvwxyz123456789 token2: 98765432:ZYXwvuTSRQPOnmlKJIHGfedcba987654321';
    const result = redactString(input);
    expect(result.match(/\[REDACTED_BOT_TOKEN\]/g)?.length).toBe(2);
  });

  test('redacts Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test';
    const result = redactString(input);
    expect(result).toContain('Bearer [REDACTED]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
  });

  test('redacts API keys (sk-...)', () => {
    const input = 'Using key sk-ant-api03-abc123def456ghi789_test';
    const result = redactString(input);
    expect(result).toContain('[REDACTED_API_KEY]');
    expect(result).not.toContain('sk-ant-api03-abc123def456ghi789_test');
  });

  test('redacts API keys (key-...)', () => {
    const input = 'Config: key-abcdefghijklmnopqrstuvwxyz';
    const result = redactString(input);
    expect(result).toContain('[REDACTED_API_KEY]');
  });

  test('redacts postgres connection strings', () => {
    const input = 'Connecting to postgres://user:pass@localhost:5432/dbname';
    const result = redactString(input);
    expect(result).toContain('[REDACTED_URL]');
    expect(result).not.toContain('user:pass');
  });

  test('redacts nats connection strings', () => {
    const input = 'NATS at nats://admin:secret@nats.example.com:4222';
    const result = redactString(input);
    expect(result).toContain('[REDACTED_URL]');
    expect(result).not.toContain('admin:secret');
  });

  test('preserves non-sensitive text', () => {
    const input = 'User logged in from 192.168.1.1';
    const result = redactString(input);
    expect(result).toBe(input);
  });

  test('handles empty string', () => {
    expect(redactString('')).toBe('');
  });
});

describe('redactObject', () => {
  test('redacts strings inside objects', () => {
    const input = {
      msg: 'Error with token 12345678:ABCdefGHIJKLmnoPQRSTuvwxyz123456789',
      code: 401,
    };
    const result = redactObject(input);
    expect(result.msg).toContain('[REDACTED_BOT_TOKEN]');
    expect(result.code).toBe(401);
  });

  test('redacts nested object values', () => {
    const input = {
      error: {
        message: 'Auth failed',
        config: {
          url: 'postgres://user:pass@host/db',
        },
      },
    };
    const result = redactObject(input);
    expect(result.error.config.url).toContain('[REDACTED_URL]');
  });

  test('redacts strings in arrays', () => {
    const input = ['Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.test', 'normal text'];
    const result = redactObject(input);
    expect(result[0]).toContain('Bearer [REDACTED]');
    expect(result[1]).toBe('normal text');
  });

  test('handles null and undefined', () => {
    expect(redactObject(null)).toBe(null);
    expect(redactObject(undefined)).toBe(undefined);
  });

  test('handles numbers and booleans unchanged', () => {
    expect(redactObject(42)).toBe(42);
    expect(redactObject(true)).toBe(true);
  });

  test('Telegram bot token in error log shows as [REDACTED_BOT_TOKEN]', () => {
    const logEntry = {
      level: 'error',
      msg: 'Telegram API error',
      error: 'Invalid token: 12345678:ABCdefGHIJKLmnoPQRSTuvwxyz123456789',
      stack: 'Error at /app/bot.ts:42\n  token=12345678:ABCdefGHIJKLmnoPQRSTuvwxyz123456789',
    };
    const redacted = redactObject(logEntry);
    expect(redacted.error).not.toContain('ABCdefGHIJKLmnoPQRSTuvwxyz123456789');
    expect(redacted.error).toContain('[REDACTED_BOT_TOKEN]');
    expect(redacted.stack).toContain('[REDACTED_BOT_TOKEN]');
  });
});
