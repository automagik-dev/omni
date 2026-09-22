/**
 * Slack reaction emoji name resolution
 *
 * Slack's `reactions.add` / `reactions.remove` accept a *shortname* (`+1`,
 * `white_check_mark`), never a Unicode glyph — passing `👍` fails with
 * `invalid_name`. This module turns whatever the caller typed into the name
 * Slack expects, using `node-emoji`'s gemoji data (the same shortname set
 * Slack uses for standard emoji) instead of a checked-in table.
 */

import { which } from 'node-emoji';

import { SlackError, SlackErrorCode } from '../types';

/** Unicode skin-tone modifiers: U+1F3FB..U+1F3FF map onto Slack's ::skin-tone-2..6 */
const SKIN_TONE_FIRST = 0x1f3fb;
const SKIN_TONE_LAST = 0x1f3ff;
const SKIN_TONE_BASE = 2;

/** VS16 (emoji presentation) and VS15 (text presentation) are not part of a Slack name */
const VARIATION_SELECTORS = /[︎️]/g;

/** Highest code point that still counts as plain ASCII */
const ASCII_MAX = 0x7f;

/** A bare Slack/gemoji shortname is ASCII — workspace custom emoji included */
function isAsciiName(value: string): boolean {
  for (const char of value) {
    if ((char.codePointAt(0) ?? 0) > ASCII_MAX) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve a reaction emoji to the shortname Slack's reactions API expects.
 *
 * Accepts `:name:`, a bare `name`, or a Unicode glyph:
 * - `:name:` / `name` are passed through unchanged (custom workspace emoji
 *   have no Unicode mapping and must survive untouched);
 * - variation selectors are stripped before the lookup, so `✅` and `✅️`
 *   both resolve;
 * - a trailing skin-tone modifier is split off the base glyph and re-attached
 *   as Slack's `::skin-tone-N` suffix;
 * - ZWJ (U+200D) sequences are never split — the joined glyph is the lookup key.
 *
 * @throws SlackError SEND_FAILED when a Unicode glyph has no known shortname.
 */
export function resolveSlackEmojiName(emoji: string): string {
  const bare = emoji.trim().replace(/^:+/, '').replace(/:+$/, '');
  if (bare.length === 0) {
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Unsupported reaction emoji: "${emoji}"`);
  }
  if (isAsciiName(bare)) {
    return bare;
  }

  const stripped = bare.replace(VARIATION_SELECTORS, '');
  const codePoints = [...stripped];
  const lastCode = codePoints[codePoints.length - 1]?.codePointAt(0) ?? 0;
  const skinTone = codePoints.length > 1 && lastCode >= SKIN_TONE_FIRST && lastCode <= SKIN_TONE_LAST;
  // Only a *trailing* modifier is removed; a ZWJ sequence keeps all of its parts.
  const base = skinTone ? codePoints.slice(0, -1).join('') : stripped;

  const name = which(base) ?? which(bare);
  if (!name) {
    throw new SlackError(SlackErrorCode.SEND_FAILED, `Unsupported reaction emoji: ${emoji}`);
  }
  return skinTone ? `${name}::skin-tone-${lastCode - SKIN_TONE_FIRST + SKIN_TONE_BASE}` : name;
}
