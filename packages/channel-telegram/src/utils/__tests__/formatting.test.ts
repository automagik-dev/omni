import { describe, expect, test } from 'bun:test';
import { splitHtmlMessage, splitMessage } from '../formatting';

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

    const validateBalanced = (chunk: string) => {
      const stack: string[] = [];
      const tagRe = /<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi;
      while (true) {
        const m = tagRe.exec(chunk);
        if (!m) break;
        const raw = m[0] ?? '';
        const name = (m[1] ?? '').toLowerCase();
        if (!name || name === 'br') continue;
        if (raw.startsWith('</')) {
          const top = stack[stack.length - 1];
          expect(top).toBe(name);
          stack.pop();
        } else if (!raw.endsWith('/>')) {
          stack.push(name);
        }
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
});
