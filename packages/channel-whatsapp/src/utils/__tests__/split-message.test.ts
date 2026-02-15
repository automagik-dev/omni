import { describe, expect, test } from 'bun:test';
import { splitWhatsAppMessage } from '../split-message';

describe('splitWhatsAppMessage', () => {
  test('returns single chunk for short text', () => {
    expect(splitWhatsAppMessage('hello', 100)).toEqual(['hello']);
  });

  test('splits long text at paragraph boundaries', () => {
    const text = `${'a'.repeat(50)}\n\n${'b'.repeat(50)}`;
    const chunks = splitWhatsAppMessage(text, 60);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks.join('')).toContain('aaa');
    expect(chunks.join('')).toContain('bbb');
  });

  test('never splits inside code blocks when possible', () => {
    const codeBlock = `\`\`\`\n${'x'.repeat(80)}\n\`\`\``;
    const text = `before\n\n${codeBlock}\n\nafter`;
    const chunks = splitWhatsAppMessage(text, 120);
    const codeChunk = chunks.find((c) => c.includes('```'));
    expect(codeChunk).toBeDefined();
    // Code block should be intact (has both opening and closing fences)
    const fenceCount = (codeChunk?.match(/```/g) || []).length;
    expect(fenceCount).toBe(2);
  });

  test('re-wraps huge code blocks across chunks', () => {
    const code = 'x'.repeat(200);
    const text = `\`\`\`\n${code}\n\`\`\``;
    const chunks = splitWhatsAppMessage(text, 100);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toContain('```');
    }
  });

  test('each chunk respects max length', () => {
    const text = 'word '.repeat(2000);
    const chunks = splitWhatsAppMessage(text, 500);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(500);
    }
  });

  test('handles default 65536 limit', () => {
    const text = 'a'.repeat(70000);
    const chunks = splitWhatsAppMessage(text);
    expect(chunks.length).toBe(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(65536);
    }
  });

  test('throws on zero maxLength', () => {
    expect(() => splitWhatsAppMessage('hello', 0)).toThrow();
  });
});
