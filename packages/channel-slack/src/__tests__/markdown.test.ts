/**
 * Tests for Markdown → Slack mrkdwn conversion
 *
 * Tests Group B: Markdown conversion layer
 */

import { describe, expect, it } from 'bun:test';

import { chunkMessage, markdownToMrkdwn } from '../markdown';

// ─────────────────────────────────────────────────────────────
// Markdown to mrkdwn conversion
// ─────────────────────────────────────────────────────────────

describe('markdownToMrkdwn', () => {
  it('converts bold text', () => {
    expect(markdownToMrkdwn('**bold**')).toBe('*bold*');
  });

  it('preserves underscored italic', () => {
    expect(markdownToMrkdwn('_italic_')).toBe('_italic_');
  });

  it('converts strikethrough', () => {
    expect(markdownToMrkdwn('~~deleted~~')).toBe('~deleted~');
  });

  it('converts links', () => {
    expect(markdownToMrkdwn('[Click here](https://example.com)')).toBe('<https://example.com|Click here>');
  });

  it('converts images to links', () => {
    expect(markdownToMrkdwn('![alt text](https://example.com/image.png)')).toBe(
      '<https://example.com/image.png|alt text>',
    );
  });

  it('converts headers to bold', () => {
    expect(markdownToMrkdwn('# Heading')).toBe('*Heading*');
    expect(markdownToMrkdwn('## Subheading')).toBe('*Subheading*');
    expect(markdownToMrkdwn('### Third')).toBe('*Third*');
  });

  it('preserves inline code', () => {
    expect(markdownToMrkdwn('Use `code` here')).toBe('Use `code` here');
  });

  it('preserves code blocks', () => {
    const input = '```\nconst x = 1;\n```';
    // Code blocks should be preserved as-is
    expect(markdownToMrkdwn(input)).toContain('```');
  });

  it('converts horizontal rules', () => {
    expect(markdownToMrkdwn('---')).toBe('———');
    expect(markdownToMrkdwn('***')).toBe('———');
  });

  it('preserves blockquotes', () => {
    const result = markdownToMrkdwn('> This is a quote');
    expect(result).toContain('> This is a quote');
  });

  it('handles mixed content', () => {
    const input = '# Title\n\n**Bold** and _italic_ with [a link](https://test.com)\n\n> Quote';
    const result = markdownToMrkdwn(input);
    expect(result).toContain('*Title*');
    expect(result).toContain('*Bold*');
    expect(result).toContain('_italic_');
    expect(result).toContain('<https://test.com|a link>');
    expect(result).toContain('> Quote');
  });

  it('handles empty string', () => {
    expect(markdownToMrkdwn('')).toBe('');
  });

  it('handles plain text', () => {
    expect(markdownToMrkdwn('Hello world')).toBe('Hello world');
  });
});

// ─────────────────────────────────────────────────────────────
// Message chunking
// ─────────────────────────────────────────────────────────────

describe('chunkMessage', () => {
  it('returns single chunk for short messages', () => {
    const chunks = chunkMessage('Hello world');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('Hello world');
  });

  it('returns single chunk at max length', () => {
    const text = 'a'.repeat(4000);
    const chunks = chunkMessage(text);
    expect(chunks).toHaveLength(1);
  });

  it('splits at newlines for long messages', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `Line ${i}: ${'x'.repeat(50)}`);
    const text = lines.join('\n');
    const chunks = chunkMessage(text);
    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should be within limit
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it('handles custom max length', () => {
    const text = 'a'.repeat(100);
    const chunks = chunkMessage(text, 50);
    expect(chunks.length).toBe(2);
    expect(chunks[0]?.length).toBeLessThanOrEqual(50);
  });

  it('handles empty string', () => {
    const chunks = chunkMessage('');
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('');
  });

  it('preserves content across chunks', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `Line ${i}`);
    const text = lines.join('\n');
    const chunks = chunkMessage(text);
    const rejoined = chunks.join('\n');
    // All original lines should be present
    for (const line of lines) {
      expect(rejoined).toContain(line);
    }
  });
});
