import { describe, expect, test } from 'bun:test';
import { markdownToWhatsApp } from '../markdown-to-whatsapp';

describe('markdownToWhatsApp', () => {
  test('converts **bold** to *bold*', () => {
    expect(markdownToWhatsApp('hello **world**')).toBe('hello *world*');
  });

  test('converts ~~strike~~ to ~strike~', () => {
    expect(markdownToWhatsApp('hello ~~world~~')).toBe('hello ~world~');
  });

  test('preserves inline `code`', () => {
    expect(markdownToWhatsApp('use `console.log`')).toBe('use `console.log`');
  });

  test('strips language hint from code blocks', () => {
    const md = '```typescript\nconst x = 1;\n```';
    const result = markdownToWhatsApp(md);
    expect(result).toContain('```\nconst x = 1;\n```');
    expect(result).not.toContain('typescript');
  });

  test('preserves blockquotes', () => {
    expect(markdownToWhatsApp('> quoted text')).toBe('> quoted text');
  });

  test('converts markdown links to text: url', () => {
    expect(markdownToWhatsApp('[click here](https://example.com)')).toBe('click here: https://example.com');
  });

  test('converts headers to bold', () => {
    expect(markdownToWhatsApp('# Title')).toBe('*Title*');
  });

  test('converts ## headers to bold', () => {
    expect(markdownToWhatsApp('## Subtitle')).toBe('*Subtitle*');
  });

  test('preserves bullet lists', () => {
    const md = '- item one\n- item two';
    expect(markdownToWhatsApp(md)).toBe('- item one\n- item two');
  });

  test('preserves numbered lists', () => {
    const md = '1. first\n2. second';
    expect(markdownToWhatsApp(md)).toBe('1. first\n2. second');
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
