/**
 * Markdown → Teams message format conversion.
 *
 * Microsoft Teams renders bot messages with a (mostly) Markdown-compatible
 * subset when the activity's `textFormat` is set to `'markdown'`. The notable
 * differences from CommonMark:
 * - Headers above level 3 are silently flattened by the Teams client; we leave
 *   them in place but the renderer collapses them.
 * - Tables are unsupported in 1:1 chats; we leave them through and let Teams
 *   degrade gracefully in those contexts.
 * - Inline images use the same `![alt](url)` syntax but Teams downloads via
 *   the bot's auth token, which means signed URLs survive the round-trip.
 * - Mention syntax (`<at>name</at>`) is *not* Markdown — the senders module
 *   will inject mention entities separately at the activity level. This module
 *   only handles plain prose.
 *
 * The chunker mirrors Slack's behaviour because the Teams chat client visibly
 * truncates messages around the 4,000-char mark even though the Bot Framework
 * activity itself accepts up to 28,000.
 */

const TEAMS_DEFAULT_CHUNK_LIMIT = 4_000;

/**
 * Convert standard Markdown to the subset Teams renders cleanly.
 *
 * For now this is mostly an identity function with light normalisation —
 * Teams' Markdown renderer accepts CommonMark almost verbatim. We trim
 * trailing whitespace per line so the chat surface doesn't show ghost
 * blank lines, and we replace `---` horizontal rules with em-dashes
 * because the Teams renderer collapses HR lines.
 */
export function markdownToTeams(markdown: string): string {
  let text = markdown;

  // Normalise CRLF to LF so the chunker's offsets stay deterministic.
  text = text.replace(/\r\n/g, '\n');

  // Strip trailing whitespace on every line.
  text = text.replace(/[ \t]+$/gm, '');

  // Horizontal rules: --- / *** / ___ → ———
  text = text.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '———');

  return text;
}

/**
 * Chunk a long message into pieces that fit comfortably in the Teams chat
 * surface. Tries to split at paragraph (double newline), then newline, then
 * space boundaries before falling back to a hard split.
 */
export function chunkMessage(text: string, maxLength = TEAMS_DEFAULT_CHUNK_LIMIT): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitIndex = remaining.lastIndexOf('\n\n', maxLength);
    if (splitIndex <= 0 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf('\n', maxLength);
    }
    if (splitIndex <= 0 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex <= 0 || splitIndex < maxLength * 0.5) {
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}
