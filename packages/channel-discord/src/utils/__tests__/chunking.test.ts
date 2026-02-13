import { describe, expect, test } from 'bun:test';
import { chunkCodeBlock, chunkMessage } from '../chunking';

describe('chunkMessage', () => {
  test('returns single chunk for short text', () => {
    expect(chunkMessage('hello', 100)).toEqual(['hello']);
  });

  test('splits long text', () => {
    const text = 'a'.repeat(4000);
    const chunks = chunkMessage(text, 2000);
    expect(chunks.length).toBe(2);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  test('prefers paragraph boundaries', () => {
    const text = `${'a'.repeat(1500)}\n\n${'b'.repeat(1500)}`;
    const chunks = chunkMessage(text, 2000);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.endsWith('\n\n') || chunks[1]?.startsWith('b')).toBe(true);
  });

  test('keeps code blocks intact when possible', () => {
    const code = 'x'.repeat(500);
    const text = `before\n\`\`\`js\n${code}\n\`\`\`\nafter`;
    const chunks = chunkMessage(text, 2000);
    // Find the chunk containing the code block
    const codeChunk = chunks.find((c) => c.includes('```js'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk ?? '').toContain('```');
  });

  test('re-wraps huge code blocks across chunks', () => {
    const code = 'x'.repeat(5000);
    const text = `\`\`\`js\n${code}\n\`\`\``;
    const chunks = chunkMessage(text, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toContain('```');
    }
  });

  test('each chunk respects max length', () => {
    const text = 'word '.repeat(2000);
    const chunks = chunkMessage(text, 2000);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });
});

describe('chunkCodeBlock', () => {
  test('wraps short code in fences', () => {
    const result = chunkCodeBlock('const x = 1;', 'js', 2000);
    expect(result).toEqual(['```js\nconst x = 1;\n```']);
  });

  test('splits long code blocks and re-wraps', () => {
    const code = 'x'.repeat(5000);
    const chunks = chunkCodeBlock(code, 'js', 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.startsWith('```js\n')).toBe(true);
      expect(chunk.endsWith('\n```')).toBe(true);
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });
});
