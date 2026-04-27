/**
 * Tests for Markdown → Teams conversion + chunking.
 */

import { describe, expect, it } from 'bun:test';

import { chunkMessage, markdownToTeams } from '../markdown';

describe('markdownToTeams', () => {
  it('returns plain text unchanged', () => {
    expect(markdownToTeams('Hello world')).toBe('Hello world');
  });

  it('preserves bold / italic / inline code (Teams renders Markdown verbatim)', () => {
    expect(markdownToTeams('**bold** _italic_ `code`')).toBe('**bold** _italic_ `code`');
  });

  it('normalises CRLF line endings to LF', () => {
    expect(markdownToTeams('one\r\ntwo\r\nthree')).toBe('one\ntwo\nthree');
  });

  it('strips trailing whitespace from each line', () => {
    const input = 'line one   \nline two\t\t\nline three';
    expect(markdownToTeams(input)).toBe('line one\nline two\nline three');
  });

  it('replaces horizontal-rule constructs with em-dashes (Teams collapses HR)', () => {
    expect(markdownToTeams('above\n---\nbelow')).toBe('above\n———\nbelow');
    expect(markdownToTeams('above\n***\nbelow')).toBe('above\n———\nbelow');
    expect(markdownToTeams('above\n___\nbelow')).toBe('above\n———\nbelow');
  });

  it('preserves code blocks', () => {
    const code = '```ts\nconst x = 1;\n```';
    expect(markdownToTeams(code)).toBe(code);
  });
});

describe('chunkMessage', () => {
  it('returns the original text in one chunk when below the limit', () => {
    expect(chunkMessage('short message', 100)).toEqual(['short message']);
  });

  it('splits at a paragraph boundary when one is reachable', () => {
    const text = `${'a'.repeat(60)}\n\n${'b'.repeat(60)}`;
    const chunks = chunkMessage(text, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toBe('a'.repeat(60));
  });

  it('falls back to single newline boundary', () => {
    const text = `${'a'.repeat(60)}\n${'b'.repeat(60)}`;
    const chunks = chunkMessage(text, 80);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toBe('a'.repeat(60));
  });

  it('falls back to whitespace boundary', () => {
    const text = `${'a'.repeat(40)} ${'b'.repeat(40)}`;
    const chunks = chunkMessage(text, 50);
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    expect(chunks[0]).toBe('a'.repeat(40));
  });

  it('hard-splits when no boundary is available', () => {
    const text = 'a'.repeat(120);
    const chunks = chunkMessage(text, 50);
    expect(chunks.length).toBe(3);
    expect(chunks[0]).toBe('a'.repeat(50));
    expect(chunks[1]).toBe('a'.repeat(50));
    expect(chunks[2]).toBe('a'.repeat(20));
  });

  it('every chunk respects the limit', () => {
    const text = `${'a'.repeat(50)}\n\n${'b'.repeat(50)}\n\n${'c'.repeat(50)}\n\n${'d'.repeat(50)}`;
    const chunks = chunkMessage(text, 80);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(80);
    }
  });

  it('does not lose characters across chunk boundaries', () => {
    const text = `${'word '.repeat(200)}`.trim();
    const chunks = chunkMessage(text, 100);
    const reassembled = chunks.join(' ').replace(/\s+/g, ' ').trim();
    expect(reassembled).toBe(text);
  });
});
