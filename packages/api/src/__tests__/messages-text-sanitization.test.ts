/**
 * Unit tests for message-text NUL-byte sanitization.
 *
 * `a0800e2f` fixed the Postgres `invalid byte sequence for encoding "UTF8":
 * 0x00` failure for the four media-text columns but left `textContent` — the
 * column PATCH /api/v2/messages/:id and POST /api/v2/messages write — raw.
 *
 * No database required; these are the pure helpers both write paths use.
 */

import { describe, expect, test } from 'bun:test';
import { sanitizeMediaText, sanitizeMessageText } from '../services/messages';

describe('sanitizeMessageText', () => {
  test('strips NUL bytes', () => {
    const raw: string = 'hello\u0000world';
    expect(sanitizeMessageText(raw)).toBe('helloworld');
  });

  test('preserves an empty string instead of collapsing it to undefined', () => {
    const empty: string = '';
    expect(sanitizeMessageText(empty)).toBe('');
  });

  test('an all-NUL string becomes an empty string, not undefined', () => {
    const raw: string = '\u0000\u0000';
    expect(sanitizeMessageText(raw)).toBe('');
  });

  test('passes undefined and null through unchanged', () => {
    expect(sanitizeMessageText(undefined)).toBeUndefined();
    expect(sanitizeMessageText(null)).toBeNull();
  });

  test('leaves valid text (including emoji) untouched', () => {
    const raw: string = 'olá 👋 tudo bem?';
    expect(sanitizeMessageText(raw)).toBe('olá 👋 tudo bem?');
  });
});

describe('sanitizeMediaText', () => {
  test('sanitizes textContent on the update path', () => {
    const out = sanitizeMediaText({ textContent: 'pdf\u0000text' });
    expect(out.textContent).toBe('pdftext');
  });

  test('keeps an empty textContent as an empty string', () => {
    const out = sanitizeMediaText({ textContent: '' });
    expect(out.textContent).toBe('');
  });

  test('leaves an absent textContent absent (no accidental column clear)', () => {
    const out = sanitizeMediaText({ transcription: 'a\u0000b' });
    expect('textContent' in out).toBe(false);
    expect(out.transcription).toBe('ab');
  });

  test('still sanitizes the four media fields', () => {
    const out = sanitizeMediaText({
      transcription: 't\u0000',
      imageDescription: 'i\u0000',
      videoDescription: 'v\u0000',
      documentExtraction: 'd\u0000',
    });
    expect(out).toMatchObject({
      transcription: 't',
      imageDescription: 'i',
      videoDescription: 'v',
      documentExtraction: 'd',
    });
  });
});
