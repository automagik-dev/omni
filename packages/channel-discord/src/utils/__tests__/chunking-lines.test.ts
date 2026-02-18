import { describe, expect, test } from 'bun:test';
import { chunkMessage, chunkMessageWithLines } from '../chunking';

describe('line-based chunking', () => {
  test('message with 30 short lines splits into 2 (17 + 13)', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');
    const chunks = chunkMessage(text, 2000, 17);
    expect(chunks.length).toBe(2);
    // First chunk has 17 lines
    expect(chunks[0]?.split('\n').length).toBe(17);
    // Second chunk has 13 lines
    expect(chunks[1]?.split('\n').length).toBe(13);
  });

  test('message under line limit returns single chunk', () => {
    const text = 'line1\nline2\nline3';
    const chunks = chunkMessage(text, 2000, 17);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(text);
  });

  test('code blocks are never split by line limit', () => {
    // Code block with 20 lines
    const codeLines = Array.from({ length: 20 }, (_, i) => `  code line ${i + 1}`);
    const text = `intro\n\`\`\`js\n${codeLines.join('\n')}\n\`\`\`\noutro`;
    const chunks = chunkMessage(text, 2000, 17);
    // The code block should be in a single chunk (not split)
    const codeChunk = chunks.find((c) => c.includes('```js'));
    expect(codeChunk).toBeDefined();
    // Code block must be intact
    expect(codeChunk).toContain('code line 1');
    expect(codeChunk).toContain('code line 20');
  });

  test('character limit still applies as hard cap', () => {
    // 10 lines that are each very long
    const longLine = 'x'.repeat(300);
    const lines = Array.from({ length: 10 }, () => longLine);
    const text = lines.join('\n');
    const chunks = chunkMessage(text, 2000, 17);
    // Even though under 17 lines, character limit forces splitting
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  test('maxLines = 0 disables line-based chunking', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');
    const chunks = chunkMessage(text, 2000, 0);
    // With 0 maxLines, only character limit applies
    // 30 short lines easily fits in 2000 chars
    expect(chunks.length).toBe(1);
  });

  test('multiple code blocks with text between them', () => {
    const text = [
      'intro text',
      '```js',
      'const a = 1;',
      'const b = 2;',
      '```',
      'middle text line 1',
      'middle text line 2',
      'middle text line 3',
      '```python',
      'x = 1',
      'y = 2',
      '```',
      ...Array.from({ length: 20 }, (_, i) => `trailing line ${i + 1}`),
    ].join('\n');

    const chunks = chunkMessage(text, 2000, 10);
    // All chunks should be within limits
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
    // Code blocks should be intact
    const jsChunk = chunks.find((c) => c.includes('const a = 1;'));
    expect(jsChunk).toBeDefined();
    expect(jsChunk).toContain('const b = 2;');
  });

  test('performance: <50ms for 10KB message', () => {
    const lines = Array.from(
      { length: 250 },
      (_, i) => `This is line number ${i + 1} with some extra content padding to ensure size`,
    );
    const text = lines.join('\n');
    expect(text.length).toBeGreaterThan(10000);

    const start = performance.now();
    const chunks = chunkMessage(text, 2000, 17);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(50);
    expect(chunks.length).toBeGreaterThan(1);
  });

  test('exactly maxLines returns single chunk', () => {
    const lines = Array.from({ length: 17 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');
    const chunks = chunkMessage(text, 2000, 17);
    expect(chunks.length).toBe(1);
  });

  test('empty text returns single empty chunk', () => {
    const chunks = chunkMessage('', 2000, 17);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('');
  });

  test('chunkMessageWithLines is directly callable', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');
    const chunks = chunkMessageWithLines(text, 10);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.split('\n').length).toBe(10);
    expect(chunks[1]?.split('\n').length).toBe(10);
  });

  test('code block that alone exceeds maxLines stays intact', () => {
    // A single code block with 25 lines should NOT be split by line limit
    const codeLines = Array.from({ length: 25 }, (_, i) => `line ${i}`);
    const text = `\`\`\`\n${codeLines.join('\n')}\n\`\`\``;
    const chunks = chunkMessage(text, 2000, 10);
    // The entire code block is in one chunk (atomic)
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toContain('line 0');
    expect(chunks[0]).toContain('line 24');
  });

  test('text before code block is split off when combined exceeds maxLines', () => {
    const textLines = Array.from({ length: 12 }, (_, i) => `text ${i + 1}`);
    const codeLines = Array.from({ length: 5 }, (_, i) => `code ${i + 1}`);
    const text = `${textLines.join('\n')}\n\`\`\`js\n${codeLines.join('\n')}\n\`\`\``;
    const chunks = chunkMessage(text, 2000, 10);
    // Text (12 lines) should be split, then code block separate
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Code block must be intact somewhere
    const codeChunk = chunks.find((c) => c.includes('```js'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk).toContain('code 1');
    expect(codeChunk).toContain('code 5');
  });

  test('preserves content integrity across all chunks', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const text = lines.join('\n');
    const chunks = chunkMessage(text, 2000, 17);

    // Rejoin chunks with newline and compare
    const rejoined = chunks.join('\n');
    expect(rejoined).toBe(text);
  });

  test('single line message returns single chunk', () => {
    const chunks = chunkMessage('hello world', 2000, 17);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe('hello world');
  });
});
