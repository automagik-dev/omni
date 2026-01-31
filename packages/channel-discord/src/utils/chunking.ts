/**
 * Message chunking utilities for Discord
 *
 * Discord has a 2000 character limit for messages.
 * This module provides utilities to split long messages intelligently.
 */

/** Discord's maximum message length */
export const MAX_MESSAGE_LENGTH = 2000;

/** Code block overhead (```) - reserved for future code block aware chunking */
const _CODE_BLOCK_OVERHEAD = 6; // ``` at start and end

/**
 * Split a message into chunks that fit Discord's limit
 *
 * Splits at natural boundaries (newlines, spaces) when possible.
 *
 * @param text - Text to split
 * @param maxLength - Maximum length per chunk (default: 2000)
 * @returns Array of text chunks
 */
export function chunkMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
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

    // Find a good split point
    const splitAt = findSplitPoint(remaining, maxLength);

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}

/**
 * Find the best split point in text
 *
 * Prefers splitting at:
 * 1. Double newline (paragraph break)
 * 2. Single newline
 * 3. Space
 * 4. Hard limit (if no good split found)
 */
function findSplitPoint(text: string, maxLength: number): number {
  // Try double newline (paragraph break)
  let splitAt = text.lastIndexOf('\n\n', maxLength);
  if (splitAt !== -1 && splitAt > maxLength * 0.5) {
    return splitAt + 2; // Include the newlines
  }

  // Try single newline
  splitAt = text.lastIndexOf('\n', maxLength);
  if (splitAt !== -1 && splitAt > maxLength * 0.5) {
    return splitAt + 1;
  }

  // Try space
  splitAt = text.lastIndexOf(' ', maxLength);
  if (splitAt !== -1 && splitAt > maxLength * 0.3) {
    return splitAt + 1;
  }

  // Hard split at max length
  return maxLength;
}

/**
 * Split a code block into chunks that fit Discord's limit
 *
 * Preserves code block formatting (```) in each chunk.
 *
 * @param code - Code to split (without ``` markers)
 * @param language - Language identifier (optional)
 * @param maxLength - Maximum length per message (default: 2000)
 * @returns Array of formatted code block strings
 */
export function chunkCodeBlock(code: string, language = '', maxLength = MAX_MESSAGE_LENGTH): string[] {
  const prefix = `\`\`\`${language}\n`;
  const suffix = '\n```';
  const overhead = prefix.length + suffix.length;
  const availableLength = maxLength - overhead;

  if (code.length <= availableLength) {
    return [`${prefix}${code}${suffix}`];
  }

  const codeChunks = chunkMessage(code, availableLength);
  return codeChunks.map((chunk) => `${prefix}${chunk}${suffix}`);
}

/**
 * Truncate text to a maximum length with ellipsis
 *
 * @param text - Text to truncate
 * @param maxLength - Maximum length including ellipsis
 * @param ellipsis - Ellipsis string (default: '...')
 * @returns Truncated text
 */
export function truncate(text: string, maxLength: number, ellipsis = '...'): string {
  if (text.length <= maxLength) {
    return text;
  }

  return text.substring(0, maxLength - ellipsis.length) + ellipsis;
}

/**
 * Count how many chunks a message will be split into
 *
 * @param text - Text to check
 * @param maxLength - Maximum length per chunk
 * @returns Number of chunks
 */
export function countChunks(text: string, maxLength = MAX_MESSAGE_LENGTH): number {
  return chunkMessage(text, maxLength).length;
}

/**
 * Check if a message needs to be chunked
 *
 * @param text - Text to check
 * @param maxLength - Maximum length (default: 2000)
 * @returns true if message exceeds limit
 */
export function needsChunking(text: string, maxLength = MAX_MESSAGE_LENGTH): boolean {
  return text.length > maxLength;
}
