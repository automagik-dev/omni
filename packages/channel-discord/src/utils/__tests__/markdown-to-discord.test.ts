import { describe, expect, test } from 'bun:test';
import { markdownToDiscord } from '../markdown-to-discord';

describe('markdownToDiscord', () => {
  test('converts # header to bold', () => {
    expect(markdownToDiscord('# Title')).toBe('**Title**');
  });

  test('converts ## header to bold', () => {
    expect(markdownToDiscord('## Subtitle')).toBe('**Subtitle**');
  });

  test('converts ###### header to bold', () => {
    expect(markdownToDiscord('###### Small')).toBe('**Small**');
  });

  test('passes through **bold** unchanged', () => {
    expect(markdownToDiscord('**bold**')).toBe('**bold**');
  });

  test('passes through *italic* unchanged', () => {
    expect(markdownToDiscord('*italic*')).toBe('*italic*');
  });

  test('passes through ~~strikethrough~~ unchanged', () => {
    expect(markdownToDiscord('~~strike~~')).toBe('~~strike~~');
  });

  test('passes through inline `code` unchanged', () => {
    expect(markdownToDiscord('`code`')).toBe('`code`');
  });

  test('passes through code blocks unchanged', () => {
    const md = '```js\nconsole.log("hi")\n```';
    expect(markdownToDiscord(md)).toBe(md);
  });

  test('does not convert headers inside code blocks', () => {
    const md = '```\n# not a header\n```';
    expect(markdownToDiscord(md)).toBe(md);
  });

  test('passes through blockquotes unchanged', () => {
    expect(markdownToDiscord('> quoted')).toBe('> quoted');
  });

  test('passes through links unchanged', () => {
    expect(markdownToDiscord('[click](https://example.com)')).toBe('[click](https://example.com)');
  });

  test('handles mixed content', () => {
    const md = '# Hello\n\n**bold** and *italic*\n\n```js\ncode\n```\n\n> quote';
    const result = markdownToDiscord(md);
    expect(result).toContain('**Hello**');
    expect(result).toContain('**bold**');
    expect(result).toContain('```js\ncode\n```');
    expect(result).toContain('> quote');
  });
});
