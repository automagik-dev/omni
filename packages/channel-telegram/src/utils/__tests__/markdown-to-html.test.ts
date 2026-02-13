import { describe, expect, test } from 'bun:test';
import { markdownToTelegramHtml } from '../markdown-to-html';

describe('markdownToTelegramHtml', () => {
  test('returns empty string for empty input', () => {
    expect(markdownToTelegramHtml('')).toBe('');
  });

  test('plain text is HTML-escaped', () => {
    expect(markdownToTelegramHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  // ---- Bold ----
  test('converts **bold**', () => {
    expect(markdownToTelegramHtml('hello **world**')).toBe('hello <b>world</b>');
  });

  // ---- Italic ----
  test('converts *italic*', () => {
    expect(markdownToTelegramHtml('hello *world*')).toBe('hello <i>world</i>');
  });

  test('converts _italic_', () => {
    expect(markdownToTelegramHtml('hello _world_')).toBe('hello <i>world</i>');
  });

  // ---- Strikethrough ----
  test('converts ~~strikethrough~~', () => {
    expect(markdownToTelegramHtml('hello ~~world~~')).toBe('hello <s>world</s>');
  });

  // ---- Inline code ----
  test('converts inline `code`', () => {
    expect(markdownToTelegramHtml('use `console.log`')).toBe('use <code>console.log</code>');
  });

  test('escapes HTML inside inline code', () => {
    expect(markdownToTelegramHtml('run `a < b`')).toBe('run <code>a &lt; b</code>');
  });

  // ---- Code blocks ----
  test('converts fenced code block with language', () => {
    const md = '```ts\nconst x = 1;\n```';
    expect(markdownToTelegramHtml(md)).toBe('<pre><code class="language-ts">const x = 1;</code></pre>');
  });

  test('converts fenced code block without language', () => {
    const md = '```\nhello\n```';
    expect(markdownToTelegramHtml(md)).toBe('<pre><code>hello</code></pre>');
  });

  test('escapes HTML inside code blocks', () => {
    const md = '```\na < b && c > d\n```';
    expect(markdownToTelegramHtml(md)).toBe('<pre><code>a &lt; b &amp;&amp; c &gt; d</code></pre>');
  });

  // ---- Blockquotes ----
  test('converts blockquote', () => {
    expect(markdownToTelegramHtml('> quoted text')).toBe('<blockquote>quoted text</blockquote>');
  });

  test('merges consecutive blockquote lines', () => {
    const md = '> line 1\n> line 2';
    expect(markdownToTelegramHtml(md)).toBe('<blockquote>line 1\nline 2</blockquote>');
  });

  // ---- Links ----
  test('converts markdown links', () => {
    expect(markdownToTelegramHtml('[click](https://example.com)')).toBe('<a href="https://example.com">click</a>');
  });

  test('escapes URL special chars in link href', () => {
    expect(markdownToTelegramHtml('[go](https://x.com/a&b)')).toBe('<a href="https://x.com/a&amp;b">go</a>');
  });

  // ---- Headers ----
  test('converts # header to bold', () => {
    expect(markdownToTelegramHtml('# Title')).toBe('<b>Title</b>');
  });

  test('converts ## header to bold', () => {
    expect(markdownToTelegramHtml('## Subtitle')).toBe('<b>Subtitle</b>');
  });

  test('converts ###### header to bold', () => {
    expect(markdownToTelegramHtml('###### Small')).toBe('<b>Small</b>');
  });

  // ---- Nested formatting ----
  test('handles bold inside italic context', () => {
    const result = markdownToTelegramHtml('_hello **world**_');
    expect(result).toContain('<b>world</b>');
  });

  // ---- Lists (passthrough) ----
  test('bullet list is passed through (inline formatted)', () => {
    const md = '- item one\n- item two';
    const result = markdownToTelegramHtml(md);
    expect(result).toContain('- item one');
    expect(result).toContain('- item two');
  });

  // ---- Mixed content ----
  test('handles mixed markdown content', () => {
    const md = '# Hello\n\nThis is **bold** and *italic*.\n\n```js\nconsole.log("hi")\n```\n\n> quote';
    const result = markdownToTelegramHtml(md);
    expect(result).toContain('<b>Hello</b>');
    expect(result).toContain('<b>bold</b>');
    expect(result).toContain('<i>italic</i>');
    expect(result).toContain('<pre><code class="language-js">');
    expect(result).toContain('<blockquote>quote</blockquote>');
  });

  // ---- Unmatched markers ----
  test('unmatched bold markers become literal', () => {
    const result = markdownToTelegramHtml('hello ** world');
    expect(result).toContain('**');
  });
});
