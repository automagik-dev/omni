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
 * Accented text travels fine as-is — `sessão` survived the same round trip
 * that ate the `✅` — so nothing here touches ordinary Portuguese.
 *
 * **The platform is LATIN-1, and that is the rule behind both halves.** Probed
 * on 05/09 by sending one message and reading it back off `/atendimento`:
 *
 *   sent   `latin1[áéíóúçãõ °ª] fora[— – … “ ” ‘ ’ → ≥ ✓]`
 *   stored `latin1[áéíóúçãõ °ª] fora[? ? ? ? ? ? ? ? ? ?]`
 *
 * Everything ISO-8859-1 can hold survives; everything it cannot becomes `?`.
 * Emoji get the `##codepoint##` markers because the platform speaks them.
 * Punctuation gets no such marker and never will, so it is TRANSLITERATED —
 * the em dashes the agent writes reached a real beneficiary as
 * `Clínico Geral ? inclusive por teleconsulta ?` (atendimento 22342782).
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

/**
 * Characters an LLM writes that ISO-8859-1 cannot hold, and the ASCII the
 * beneficiary should read instead of `?`.
 *
 * Deliberately small: only what the agent actually produces. Anything outside
 * it is left alone and reported by `nonLatin1Left`, so the next unknown
 * character shows up in a log rather than as a `?` on someone's handset.
 */
const TRANSLITERATIONS: Array<[RegExp, string]> = [
  [/[\u2014\u2013\u2212]/g, '-'], // em dash, en dash, minus
  [/\u2026/g, '...'],
  [/[\u201C\u201D\u201E]/g, '"'],
  [/[\u2018\u2019\u201A]/g, "'"],
  [/\u2192/g, '->'],
  [/\u2190/g, '<-'],
  [/\u2265/g, '>='],
  [/\u2264/g, '<='],
  [/\u00A0/g, ' '], // NBSP: latin-1 HAS it, but it reads as a stray byte
  [/[\u2022\u00B7]/g, '-'],
];

/** Characters still outside ISO-8859-1 — each one will reach the handset as `?`. */
export function nonLatin1Left(text: string): string[] {
  return [...new Set([...text].filter((ch) => (ch.codePointAt(0) ?? 0) > 0xff))];
}

/**
 * 🗑️ → `##1f5d1-fe0f##`, and punctuation the platform cannot carry → ASCII.
 *
 * Emoji FIRST: their markers are pure ASCII, so nothing below can touch them,
 * and a pictographic dash-like glyph is an emoji before it is punctuation.
 */
export function encodeAscEmoji(text: string): string {
  const withMarkers = text.replace(
    EMOJI_RUN,
    (run) => `##${[...run].map((ch) => (ch.codePointAt(0) ?? 0).toString(16)).join('-')}##`,
  );
  return TRANSLITERATIONS.reduce((acc, [pattern, ascii]) => acc.replace(pattern, ascii), withMarkers);
}
