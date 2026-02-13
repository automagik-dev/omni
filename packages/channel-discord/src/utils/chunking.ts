/**
 * Message chunking utilities for Discord
 *
 * Discord has a 2000 character limit for messages.
 * This module provides utilities to split long messages intelligently.
 */

/** Discord's maximum message length */
export const MAX_MESSAGE_LENGTH = 2000;

type Segment =
  | {
      type: 'text';
      content: string;
    }
  | {
      type: 'code';
      language: string;
      content: string;
    };

/**
 * Split a message into chunks that fit Discord's limit
 *
 * Splits at natural boundaries (paragraphs, then lines, then hard cut) when possible.
 * Keeps fenced code blocks intact; if a fenced code block itself exceeds the limit,
 * it is split and re-wrapped across chunks.
 *
 * @param text - Text to split
 * @param maxLength - Maximum length per chunk (default: 2000)
 * @returns Array of text chunks
 */
export function chunkMessage(text: string, maxLength = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const segments = parseSegments(text);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };

  const appendAtomic = (part: string): void => {
    if (part.length > maxLength) {
      const splitParts = splitLongContent(part, maxLength);
      for (const splitPart of splitParts) {
        appendAtomic(splitPart);
      }
      return;
    }

    if (current.length === 0) {
      current = part;
      return;
    }

    if (current.length + part.length <= maxLength) {
      current += part;
      return;
    }

    pushCurrent();
    current = part;
  };

  const appendText = (content: string): void => {
    let remaining = content;

    while (remaining.length > 0) {
      const available = maxLength - current.length;

      if (available <= 0) {
        pushCurrent();
        continue;
      }

      if (remaining.length <= available) {
        current += remaining;
        break;
      }

      const splitAt = findSplitPoint(remaining, available);
      current += remaining.substring(0, splitAt);
      remaining = remaining.substring(splitAt);
      pushCurrent();
    }
  };

  const appendCodeBlock = (language: string, code: string): void => {
    const prefix = `\`\`\`${language}\n`;
    const suffix = '\n```';
    const wrapped = `${prefix}${code}${suffix}`;

    if (wrapped.length <= maxLength) {
      appendAtomic(wrapped);
      return;
    }

    const availableCode = Math.max(1, maxLength - prefix.length - suffix.length);
    const codeParts = splitLongContent(code, availableCode);

    for (const codePart of codeParts) {
      appendAtomic(`${prefix}${codePart}${suffix}`);
    }
  };

  for (const segment of segments) {
    if (segment.type === 'text') {
      appendText(segment.content);
      continue;
    }

    appendCodeBlock(segment.language, segment.content);
  }

  pushCurrent();

  return chunks;
}

/**
 * Parse text into plain text and fenced code block segments.
 */
function parseSegments(text: string): Segment[] {
  const segments: Segment[] = [];
  const fencedCodeRegex = /```([^\n`]*)\n([\s\S]*?)```/g;

  let lastIndex = 0;
  let match = fencedCodeRegex.exec(text);

  while (match) {
    const [fullMatch, rawLanguage, codeContent] = match;
    const index = match.index;

    if (index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, index),
      });
    }

    segments.push({
      type: 'code',
      language: (rawLanguage ?? '').trim(),
      content: codeContent ?? '',
    });

    lastIndex = index + fullMatch.length;
    match = fencedCodeRegex.exec(text);
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex),
    });
  }

  if (segments.length === 0) {
    segments.push({ type: 'text', content: text });
  }

  return segments;
}

/**
 * Split long content using preferred boundaries.
 */
function splitLongContent(content: string, maxLength: number): string[] {
  if (content.length <= maxLength) {
    return [content];
  }

  const parts: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    const splitAt = findSplitPoint(remaining, maxLength);
    parts.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return parts;
}

/**
 * Find the best split point in text.
 *
 * Prefers splitting at:
 * 1. Double newline (paragraph break)
 * 2. Single newline
 * 3. Hard limit (if no boundary found)
 */
function findSplitPoint(text: string, maxLength: number): number {
  // Try double newline (paragraph break)
  let splitAt = text.lastIndexOf('\n\n', maxLength);
  if (splitAt !== -1) {
    return splitAt + 2; // Include the newlines
  }

  // Try single newline
  splitAt = text.lastIndexOf('\n', maxLength);
  if (splitAt !== -1) {
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

  const codeChunks = splitLongContent(code, Math.max(1, availableLength));
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
