/**
 * Tests for Unicode → Slack reaction shortname resolution
 *
 * Regression: `omni react "👍"` on Slack returned `invalid_name` because the
 * glyph reached `reactions.add` verbatim.
 */

import { describe, expect, it } from 'bun:test';

import { SlackError, SlackErrorCode } from '../types';
import { resolveSlackEmojiName } from '../utils/emoji';

describe('resolveSlackEmojiName', () => {
  it('resolves a unicode glyph to its bare Slack shortname', () => {
    expect(resolveSlackEmojiName('👍')).toBe('+1');
  });

  it('resolves a glyph carrying a U+FE0F variation selector', () => {
    expect(resolveSlackEmojiName('✅️')).toBe('white_check_mark');
  });

  it('resolves the same glyph without the variation selector', () => {
    expect(resolveSlackEmojiName('✅')).toBe('white_check_mark');
  });

  it('re-attaches a skin-tone modifier as Slack ::skin-tone-N', () => {
    expect(resolveSlackEmojiName('👍\u{1F3FD}')).toBe('+1::skin-tone-4');
  });

  it('strips colons from a :name: form', () => {
    expect(resolveSlackEmojiName(':+1:')).toBe('+1');
  });

  it('passes a bare ascii name through unchanged (workspace custom emoji)', () => {
    expect(resolveSlackEmojiName('thumbsup')).toBe('thumbsup');
  });

  it('keeps a ZWJ sequence whole instead of resolving one part', () => {
    expect(resolveSlackEmojiName('👨‍👩‍👧')).toBe('family_man_woman_girl');
  });

  it('throws SlackError SEND_FAILED naming an unmappable symbol', () => {
    let thrown: unknown;
    try {
      resolveSlackEmojiName('⌘');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(SlackError);
    expect((thrown as SlackError).channelCode).toBe(SlackErrorCode.SEND_FAILED);
    expect((thrown as SlackError).message).toContain('⌘');
  });
});
