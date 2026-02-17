import { describe, expect, mock, test } from 'bun:test';
import { sanitizeMessage } from '../sanitize';

function createMockLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
    child: mock(() => createMockLogger()),
  };
}

describe('sanitizeMessage', () => {
  test('passes through clean text unchanged', () => {
    const logger = createMockLogger();
    const result = sanitizeMessage('Hello, world!', logger);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Hello, world!');
  });

  test('rejects messages containing null bytes', () => {
    const logger = createMockLogger();
    const result = sanitizeMessage('Hello\0world', logger);
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe('null_byte');
    expect(logger.warn).toHaveBeenCalled();
  });

  test('strips C0 control characters except \\n, \\r, \\t', () => {
    const logger = createMockLogger();
    const input = 'Hello\x01\x02\x03world\n\r\tnewline';
    const result = sanitizeMessage(input, logger);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Helloworld\n\r\tnewline');
  });

  test('strips DEL character (0x7F)', () => {
    const logger = createMockLogger();
    const result = sanitizeMessage('Hello\x7Fworld', logger);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Helloworld');
  });

  test('strips C1 control characters (0x80-0x9F)', () => {
    const logger = createMockLogger();
    const result = sanitizeMessage('Hello\x80\x8F\x9Fworld', logger);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Helloworld');
  });

  test('normalizes Unicode to NFC', () => {
    const logger = createMockLogger();
    // U+0065 (e) + U+0301 (combining acute) = NFD form of 'é'
    const nfd = 'caf\u0065\u0301';
    const nfc = 'caf\u00e9';
    const result = sanitizeMessage(nfd, logger);
    expect(result.ok).toBe(true);
    expect(result.text).toBe(nfc);
  });

  test('rejects messages exceeding max length', () => {
    const logger = createMockLogger();
    const longText = 'a'.repeat(70_000);
    const result = sanitizeMessage(longText, logger);
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe('too_long');
    expect(logger.warn).toHaveBeenCalled();
  });

  test('accepts messages at exactly max length', () => {
    const logger = createMockLogger();
    const text = 'a'.repeat(65_536);
    const result = sanitizeMessage(text, logger);
    expect(result.ok).toBe(true);
  });

  test('respects custom max length', () => {
    const logger = createMockLogger();
    const result = sanitizeMessage('a'.repeat(200), logger, { maxLengthBytes: 100 });
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe('too_long');
  });

  test('rejects multibyte text exceeding limit in UTF-8 bytes', () => {
    const logger = createMockLogger();
    // 'é' is 1 UTF-16 char but 2 UTF-8 bytes. 33_000 copies = 33_000 chars but 66_000 bytes.
    // The default limit is 65_536 bytes, so this should be rejected even though char count is under.
    const text = 'é'.repeat(33_000);
    expect(text.length).toBe(33_000); // char count under limit
    const result = sanitizeMessage(text, logger);
    expect(result.ok).toBe(false);
    expect(result.rejected).toBe('too_long');
  });

  test('accepts multibyte text at exactly max bytes', () => {
    const logger = createMockLogger();
    // 'é' = 2 bytes; 32_768 copies = 65_536 bytes exactly
    const text = 'é'.repeat(32_768);
    const result = sanitizeMessage(text, logger);
    expect(result.ok).toBe(true);
  });

  test('preserves emoji and international text', () => {
    const logger = createMockLogger();
    const result = sanitizeMessage('Hello! Olá! 你好! 👋🌍', logger);
    expect(result.ok).toBe(true);
    expect(result.text).toContain('👋');
    expect(result.text).toContain('你好');
  });

  test('handles empty string', () => {
    const logger = createMockLogger();
    const result = sanitizeMessage('', logger);
    expect(result.ok).toBe(true);
    expect(result.text).toBe('');
  });

  test('passes context fields to logger', () => {
    const logger = createMockLogger();
    sanitizeMessage('Hello\0world', logger, {
      instanceId: 'inst-1',
      messageId: 'msg-1',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      'message_rejected_null_byte',
      expect.objectContaining({
        instanceId: 'inst-1',
        messageId: 'msg-1',
      }),
    );
  });

  test('sanitization has sub-millisecond overhead for typical messages', () => {
    const logger = createMockLogger();
    const text = 'Hello, this is a typical message with some Unicode: café, naïve.';
    const iterations = 10_000;

    const start = performance.now();
    for (let i = 0; i < iterations; i++) {
      sanitizeMessage(text, logger);
    }
    const elapsed = performance.now() - start;
    const avgMs = elapsed / iterations;

    expect(avgMs).toBeLessThan(1);
  });
});
