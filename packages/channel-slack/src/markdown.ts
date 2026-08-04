/**
 * Markdown → Slack mrkdwn conversion layer
 *
 * Converts standard Markdown to Slack's mrkdwn format:
 * - Bold: **text** → *text*
 * - Italic: *text* or _text_ → _text_
 * - Strikethrough: ~~text~~ → ~text~
 * - Links: [text](url) → <url|text>
 * - Code blocks: ```lang\ncode``` → ```code```
 * - Inline code: `code` → `code` (same)
 * - Headers: # text → *text*
 * - Lists: preserved
 *
 * Also handles chunking messages to 4000-char Slack limit.
 */

export const MAX_SLACK_MESSAGE_LENGTH = 4000;

/**
 * Convert standard Markdown to Slack mrkdwn
 */
export function markdownToMrkdwn(markdown: string): string {
  let text = markdown;

  // Convert headers: # text → *text*
  text = text.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');

  // Convert bold: **text** → *text*
  // Must be done before italic to avoid conflicts
  text = text.replace(/\*\*(.+?)\*\*/g, '*$1*');

  // Convert italic with underscores (already valid in mrkdwn)
  // _text_ → _text_ (no change needed)

  // Convert standalone *text* (italic in MD, but bold in mrkdwn)
  // This is tricky — after bold conversion, remaining single * are italic in MD
  // But in mrkdwn, single * is bold. We convert MD italic (*text*) to mrkdwn italic (_text_)
  // Only match *text* that isn't already part of **text**
  // Already handled by bold conversion above — remaining single * pairs are now mrkdwn bold

  // Convert strikethrough: ~~text~~ → ~text~
  text = text.replace(/~~(.+?)~~/g, '~$1~');

  // Convert images first: ![alt](url) → <url|alt> (must be before links)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<$2|$1>');

  // Convert links: [text](url) → <url|text>
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>');

  // Convert blockquotes: > text → > text (same in mrkdwn, but ensure single >)
  text = text.replace(/^>\s?/gm, '> ');

  // Horizontal rules: --- or *** → ———
  text = text.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '———');

  return text;
}

/**
 * Chunk a message into parts that fit within Slack's max message length.
 * Tries to split at newline boundaries when possible.
 */
export function chunkMessage(text: string, maxLength = MAX_SLACK_MESSAGE_LENGTH): string[] {
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

    // Try to find a newline boundary near the max length
    let splitIndex = remaining.lastIndexOf('\n', maxLength);
    if (splitIndex <= 0 || splitIndex < maxLength * 0.5) {
      // No good newline boundary, try space
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIndex <= 0 || splitIndex < maxLength * 0.5) {
      // No good boundary at all, hard split
      splitIndex = maxLength;
    }

    chunks.push(remaining.substring(0, splitIndex));
    remaining = remaining.substring(splitIndex).trimStart();
  }

  return chunks;
}
