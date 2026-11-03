import { describe, expect, test } from 'bun:test';
import { markdownToDiscord } from '../markdown-to-discord';

describe('markdownToDiscord', () => {
  test.each([
    ['# Title', '**Title**'],
    ['## Subtitle', '**Subtitle**'],
    ['###### Small', '**Small**'],
    ['**bold**', '**bold**'],
    ['*italic*', '*italic*'],
    ['~~strike~~', '~~strike~~'],
    ['`code`', '`code`'],
    ['```js\nconsole.log("hi")\n```', '```js\nconsole.log("hi")\n```'],
    ['> quoted', '> quoted'],
    ['[click](https://example.com)', '[click](https://example.com)'],
  ])('converts or preserves %p', (input, expected) => {
    expect(markdownToDiscord(input)).toBe(expected);
  });

  test('does not convert headers inside code blocks', () => {
    const md = '```\n# not a header\n```';
    expect(markdownToDiscord(md)).toBe(md);
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
