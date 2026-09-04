/**
 * The ASC platform does not carry emoji as characters — it transcodes them to
 * `##<codepoint>[-<codepoint>…]##`, lowercase hex, and expects the same shape
 * back. Their own production flow writes `"Olá! ##1f44b## Seja bem-vindo(a)"`
 * (flow #215, NDS PPO), and a trash can reaches us as `##1f5d1-fe0f##`.
 *
 * Both directions are load-bearing, measured on the live number 01/09:
 *   - inbound raw  → the session cleaner's trash reset never fires and the
 *     agent reads the marker as prose;
 *   - outbound raw → the character is dropped on the way to the handset (the
 *     `✅` of the session-cleared confirmation arrived as `?`).
 *
 * Only emoji are touched. Accented text travels fine as-is — `sessão` survived
 * the same round trip that ate the `✅` — so encoding anything broader would
 * mangle ordinary Portuguese.
 */

const MARKER = /##([0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)##/gi;

/**
 * One emoji plus its modifiers (variation selector, ZWJ joins, skin tone) is a
 * single marker, mirroring how the platform groups them (`2714-fe0f`).
 */
// Alternation rather than a character class: a class cannot express a
// multi-codepoint emoji, and the linter is right to refuse one here.
//
// The first two alternatives are NOT covered by `Extended_Pictographic`, and
// without them a flag or a keycap slips through raw and reaches the handset as
// `?` — the same failure this module exists to prevent:
//   - a flag is a pair of regional indicators (🇧🇷 = 1f1e7 1f1f7);
//   - a keycap is an ASCII base plus U+20E3 (1️⃣ = 31 fe0f 20e3).
// They come first so the pair/keycap wins over any partial pictographic match.
const EMOJI_RUN =
  /[\u{1F1E6}-\u{1F1FF}]{2}|[0-9#*]️?⃣|\p{Extended_Pictographic}(?:️|‍|\p{Emoji_Modifier}|\p{Extended_Pictographic})*/gu;

/** `##1f5d1-fe0f##` → 🗑️. Unparseable sequences keep the marker, never drop text. */
export function decodeAscEmoji(text: string): string {
  return text.replace(MARKER, (marker, codepoints: string) => {
    try {
      return String.fromCodePoint(...codepoints.split('-').map((c) => Number.parseInt(c, 16)));
    } catch {
      return marker;
    }
  });
}

/** 🗑️ → `##1f5d1-fe0f##`. */
export function encodeAscEmoji(text: string): string {
  return text.replace(
    EMOJI_RUN,
    (run) => `##${[...run].map((ch) => (ch.codePointAt(0) ?? 0).toString(16)).join('-')}##`,
  );
}
