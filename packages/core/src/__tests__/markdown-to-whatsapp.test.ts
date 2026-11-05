import { describe, expect, test } from 'bun:test';
import { markdownToWhatsApp } from '../markdown-to-whatsapp';

describe('markdownToWhatsApp', () => {
  test.each([
    ['converts **bold** to *bold*', 'hello **world**', 'hello *world*'],
    ['converts ~~strike~~ to ~strike~', 'hello ~~world~~', 'hello ~world~'],
    ['preserves inline `code`', 'use `console.log`', 'use `console.log`'],
    ['preserves blockquotes', '> quoted text', '> quoted text'],
    ['converts markdown links to text: url', '[click here](https://example.com)', 'click here: https://example.com'],
    ['converts headers to bold', '# Title', '*Title*'],
    ['converts ## headers to bold', '## Subtitle', '*Subtitle*'],
    ['preserves bullet lists', '- item one\n- item two', '- item one\n- item two'],
    ['preserves numbered lists', '1. first\n2. second', '1. first\n2. second'],
  ])('%s', (_name, input, expected) => {
    expect(markdownToWhatsApp(input)).toBe(expected);
  });

  test('strips language hint from code blocks', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const result = markdownToWhatsApp(md);
    expect(result).toContain('```\nconst x = 1;\n```');
    expect(result).not.toContain('typescript');
  });

  test('does not convert formatting inside code blocks', () => {
    const md = '```\n**not bold** ~~not strike~~\n```';
    const result = markdownToWhatsApp(md);
    expect(result).toContain('**not bold**');
    expect(result).toContain('~~not strike~~');
  });

  test('handles mixed content', () => {
    const md = '# Hello\n\n**bold** and *italic*\n\n```js\ncode\n```\n\n> quote';
    const result = markdownToWhatsApp(md);
    expect(result).toContain('*Hello*');
    expect(result).toContain('*bold*');
    expect(result).toContain('```\ncode\n```');
    expect(result).toContain('> quote');
  });
});
