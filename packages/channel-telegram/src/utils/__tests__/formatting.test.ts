import { describe, expect, test } from 'bun:test';
import { splitHtmlMessage, splitMessage, splitTelegramMessage } from '../formatting';

describe('splitMessage (plain text)', () => {
  test('returns single chunk for short text', () => {
    expect(splitMessage('hello', 100)).toEqual(['hello']);
  });

  test('splits at newline boundary', () => {
    const text = 'aaa\nbbb\nccc';
    const chunks = splitMessage(text, 8);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // All content preserved
    expect(chunks.join('')).toContain('aaa');
    expect(chunks.join('')).toContain('ccc');
  });

  test('each chunk respects max length', () => {
    const text = 'a'.repeat(10000);
    const chunks = splitMessage(text, 4096);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });
});

describe('splitHtmlMessage', () => {
  test('returns single chunk for short HTML', () => {
    expect(splitHtmlMessage('<b>hello</b>', 100)).toEqual(['<b>hello</b>']);
  });

  test('does not split inside <pre> block', () => {
    const code = 'x'.repeat(100);
    const html = `before<pre><code>${code}</code></pre>after`;
    const chunks = splitHtmlMessage(html, 80);
    // The code block should stay intact in one chunk
    const codeChunk = chunks.find((c) => c.includes('<pre>'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk ?? '').toContain('</pre>');
  });

  test('re-wraps huge <pre> blocks across chunks', () => {
    const code = 'x'.repeat(8000);
    const html = `<pre><code>${code}</code></pre>`;
    const chunks = splitHtmlMessage(html, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be wrapped
    for (const chunk of chunks) {
      expect(chunk).toContain('<pre>');
      expect(chunk).toContain('</pre>');
    }
  });

  test('re-wraps huge <blockquote> blocks', () => {
    const text = 'q'.repeat(8000);
    const html = `<blockquote>${text}</blockquote>`;
    const chunks = splitHtmlMessage(html, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toContain('<blockquote>');
      expect(chunk).toContain('</blockquote>');
    }
  });

  test('each chunk respects max length', () => {
    const html = '<b>bold</b>\n'.repeat(1000);
    const chunks = splitHtmlMessage(html, 4096);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  test('preserves all content', () => {
    const html = '<b>hello</b> world <pre><code>code</code></pre> <blockquote>quote</blockquote>';
    const chunks = splitHtmlMessage(html, 40);
    const rejoined = chunks.join('');
    expect(rejoined).toContain('<b>hello</b>');
    expect(rejoined).toContain('<pre><code>code</code></pre>');
    expect(rejoined).toContain('<blockquote>quote</blockquote>');
  });

  test('keeps inline tags balanced per chunk when splitting', () => {
    const html = `<b>${'x'.repeat(5000)}</b>`;
    const chunks = splitHtmlMessage(html, 1000);
    expect(chunks.length).toBeGreaterThan(1);

    // Test helper; keep readable rather than micro-optimizing for complexity score.
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: test helper
    const validateBalanced = (chunk: string) => {
      const stack: string[] = [];
      const tagRe = /<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi;
      const tags = Array.from(chunk.matchAll(tagRe), (m) => ({
        raw: m[0] ?? '',
        name: (m[1] ?? '').toLowerCase(),
      }));

      for (const tag of tags) {
        if (!tag.name || tag.name === 'br') continue;
        if (tag.raw.startsWith('</')) {
          expect(stack.pop()).toBe(tag.name);
          continue;
        }
        if (!tag.raw.endsWith('/>')) stack.push(tag.name);
      }

      expect(stack).toEqual([]);
    };

    for (const chunk of chunks) {
      validateBalanced(chunk);
      expect(chunk.length).toBeLessThanOrEqual(1000);
      // Should still be bold content in each chunk.
      expect(chunk).toContain('<b>');
      expect(chunk).toContain('</b>');
    }
  });

  test('preserves nested inline tags across chunk boundaries', () => {
    const html = `<b>hello <i>${'y'.repeat(5000)}</i> world</b>`;
    const chunks = splitHtmlMessage(html, 900);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toContain('<b>');
      expect(chunk).toContain('</b>');
    }
  });

  test('handles expandable blockquote', () => {
    const text = 'q'.repeat(8000);
    const html = `<blockquote expandable>${text}</blockquote>`;
    const chunks = splitHtmlMessage(html, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toContain('<blockquote');
      expect(chunk).toContain('</blockquote>');
    }
  });

  test('handles empty chunks gracefully', () => {
    const chunks = splitHtmlMessage('', 4096);
    expect(chunks).toEqual(['']);
  });

  test('handles exactly-at-limit message', () => {
    const html = 'x'.repeat(4096);
    const chunks = splitHtmlMessage(html, 4096);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toBe(html);
  });

  test('code blocks are never split mid-block when within limit', () => {
    const code = 'y'.repeat(3000);
    const html = `text before<pre><code>${code}</code></pre>text after`;
    const chunks = splitHtmlMessage(html, 4096);
    // Code block should be in one chunk
    const codeChunk = chunks.find((c) => c.includes('<pre>'));
    expect(codeChunk).toBeDefined();
    expect(codeChunk).toContain(`<pre><code>${code}</code></pre>`);
  });

  test('chunk split time <10ms p99 for 20k char message', () => {
    const html = `<b>${'x'.repeat(5000)}</b>\n<pre><code>${'y'.repeat(5000)}</code></pre>\n<blockquote>${'z'.repeat(5000)}</blockquote>\n${'a'.repeat(5000)}`;
    const iterations = 1000;
    const latencies: number[] = [];

    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      splitHtmlMessage(html, 4096);
      latencies.push(performance.now() - start);
    }

    latencies.sort((a, b) => a - b);
    const p99 = latencies[Math.floor(latencies.length * 0.99)];
    expect(p99).toBeLessThan(10);
  });
});

describe('splitTelegramMessage', () => {
  test('returns single chunk for short text', () => {
    expect(splitTelegramMessage('hello')).toEqual(['hello']);
  });

  test('uses plain text splitter for non-HTML', () => {
    const text = 'a'.repeat(5000);
    const chunks = splitTelegramMessage(text, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  test('uses HTML splitter for HTML content', () => {
    const html = `<b>${'x'.repeat(5000)}</b>`;
    const chunks = splitTelegramMessage(html, 4096);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk).toContain('<b>');
      expect(chunk).toContain('</b>');
    }
  });

  test('respects 4096 default limit', () => {
    const text = 'a'.repeat(10000);
    const chunks = splitTelegramMessage(text);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });
});
