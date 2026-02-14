/**
 * Telegram message formatting utilities
 */

/**
 * Escape special characters for Telegram MarkdownV2
 */
export function escapeMarkdownV2(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Strip HTML tags from text
 */
export function stripHtml(text: string): string {
  return text.replace(/<[^>]*>/g, '');
}

/**
 * Truncate text to Telegram's max message length (4096 chars)
 * Splits at word boundaries when possible
 */
export function truncateMessage(text: string, maxLength = 4096): string {
  if (text.length <= maxLength) return text;

  const truncated = text.substring(0, maxLength - 3);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > maxLength * 0.8) {
    return `${truncated.substring(0, lastSpace)}...`;
  }

  return `${truncated}...`;
}

/**
 * Split a long plain message into chunks that fit within Telegram's limits
 */
export function splitMessage(text: string, maxLength = 4096): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n', maxLength);
    if (splitAt < maxLength * 0.5) {
      splitAt = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitAt < maxLength * 0.5) {
      splitAt = maxLength;
    }

    chunks.push(remaining.substring(0, splitAt));
    remaining = remaining.substring(splitAt).trimStart();
  }

  return chunks;
}

type SegmentType = 'plain' | 'pre' | 'code' | 'blockquote';

interface HtmlSegment {
  type: SegmentType;
  value: string;
}

function splitPlainByBoundaries(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }

    let splitAt = remaining.lastIndexOf('\n\n', maxLength);
    if (splitAt > 0) {
      splitAt += 2; // keep paragraph separator with prior chunk
    }

    if (splitAt <= 0) {
      splitAt = remaining.lastIndexOf('\n', maxLength);
      if (splitAt > 0) splitAt += 1; // keep newline with prior chunk
    }

    if (splitAt <= 0) {
      splitAt = maxLength;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

function splitWrappedContent(prefix: string, content: string, suffix: string, maxLength: number): string[] {
  const budget = maxLength - prefix.length - suffix.length;
  if (budget <= 0) {
    // Defensive fallback; should never happen with Telegram limits and our tags.
    return splitPlainByBoundaries(`${prefix}${content}${suffix}`, maxLength);
  }

  const contentParts = splitPlainByBoundaries(content, budget);
  return contentParts.map((part) => `${prefix}${part}${suffix}`);
}

function trySplitPre(value: string, maxLength: number): string[] | null {
  const preCodeMatch = value.match(/^<pre\b[^>]*>\s*<code\b([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>$/i);
  if (preCodeMatch) {
    return splitWrappedContent(
      `<pre><code${preCodeMatch[1] ?? ''}>`,
      preCodeMatch[2] ?? '',
      '</code></pre>',
      maxLength,
    );
  }

  const preMatch = value.match(/^<pre\b[^>]*>([\s\S]*?)<\/pre>$/i);
  if (preMatch) {
    return splitWrappedContent('<pre>', preMatch[1] ?? '', '</pre>', maxLength);
  }

  return null;
}

function trySplitCode(value: string, maxLength: number): string[] | null {
  const codeMatch = value.match(/^<code\b([^>]*)>([\s\S]*?)<\/code>$/i);
  if (codeMatch) {
    return splitWrappedContent(`<code${codeMatch[1] ?? ''}>`, codeMatch[2] ?? '', '</code>', maxLength);
  }
  return null;
}

function trySplitBlockquote(value: string, maxLength: number): string[] | null {
  const quoteMatch = value.match(/^<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>$/i);
  if (quoteMatch) {
    return splitWrappedContent('<blockquote>', quoteMatch[1] ?? '', '</blockquote>', maxLength);
  }
  return null;
}

const protectedSplitters: Record<SegmentType, (value: string, maxLen: number) => string[] | null> = {
  pre: trySplitPre,
  code: trySplitCode,
  blockquote: trySplitBlockquote,
  plain: () => null,
};

function splitLongProtectedSegment(segment: HtmlSegment, maxLength: number): string[] {
  if (segment.value.length <= maxLength) return [segment.value];

  const splitter = protectedSplitters[segment.type];
  const result = splitter(segment.value, maxLength);
  if (result) return result;

  // Final fallback for malformed HTML
  return splitPlainByBoundaries(segment.value, maxLength);
}

function findNextProtected(html: string, from: number): { start: number; end: number; type: SegmentType } | null {
  const patterns: Array<{ type: SegmentType; open: RegExp; close: RegExp }> = [
    { type: 'pre', open: /<pre\b[^>]*>/gi, close: /<\/pre>/gi },
    { type: 'blockquote', open: /<blockquote\b[^>]*>/gi, close: /<\/blockquote>/gi },
    { type: 'code', open: /<code\b[^>]*>/gi, close: /<\/code>/gi },
  ];

  let best: { start: number; end: number; type: SegmentType } | null = null;

  for (const pattern of patterns) {
    pattern.open.lastIndex = from;
    const openMatch = pattern.open.exec(html);
    if (!openMatch) continue;

    const start = openMatch.index;
    pattern.close.lastIndex = start;
    const closeMatch = pattern.close.exec(html);
    if (!closeMatch) continue;

    const end = closeMatch.index + closeMatch[0].length;

    if (!best || start < best.start) {
      best = { start, end, type: pattern.type };
    }
  }

  return best;
}

function segmentHtml(html: string): HtmlSegment[] {
  const segments: HtmlSegment[] = [];
  let cursor = 0;

  while (cursor < html.length) {
    const next = findNextProtected(html, cursor);

    if (!next) {
      if (cursor < html.length) {
        segments.push({ type: 'plain', value: html.slice(cursor) });
      }
      break;
    }

    if (next.start > cursor) {
      segments.push({ type: 'plain', value: html.slice(cursor, next.start) });
    }

    segments.push({ type: next.type, value: html.slice(next.start, next.end) });
    cursor = next.end;
  }

  return segments;
}

/**
 * Accumulator for building chunks from segments.
 * Extracted to reduce cognitive complexity of the main splitter.
 */
class ChunkAccumulator {
  chunks: string[] = [];
  current = '';

  constructor(private maxLength: number) {}

  flush(): void {
    if (this.current) {
      this.chunks.push(this.current);
      this.current = '';
    }
  }

  append(part: string): void {
    if (!this.current) {
      this.current = part;
      return;
    }
    if (this.current.length + part.length <= this.maxLength) {
      this.current += part;
    } else {
      this.flush();
      this.current = part;
    }
  }

  appendParts(parts: string[]): void {
    for (const part of parts) {
      if (!part) continue;
      this.append(part);
    }
  }

  result(): string[] {
    this.flush();
    return this.chunks.length > 0 ? this.chunks : [''];
  }
}

function processPlainSegment(acc: ChunkAccumulator, segment: HtmlSegment, maxLength: number): void {
  const plainParts = splitPlainByBoundaries(segment.value, maxLength);
  acc.appendParts(plainParts);
}

function processProtectedSegment(acc: ChunkAccumulator, segment: HtmlSegment, maxLength: number): void {
  const protectedParts = splitLongProtectedSegment(segment, maxLength);
  for (const part of protectedParts) {
    if (part.length > maxLength) {
      const hardParts = splitPlainByBoundaries(part, maxLength);
      acc.appendParts(hardParts);
    } else {
      acc.append(part);
    }
  }
}

/**
 * HTML-aware split for Telegram parse_mode=HTML messages.
 *
 * Rules:
 * - Prefer paragraph boundaries, then line boundaries, then hard cut
 * - Never split inside <pre>, <code>, <blockquote> blocks
 * - Long protected blocks are re-wrapped into multiple protected chunks
 */
export function splitHtmlMessage(html: string, maxLength = 4096): string[] {
  if (html.length <= maxLength) return [html];

  const segments = segmentHtml(html);
  const acc = new ChunkAccumulator(maxLength);

  for (const segment of segments) {
    if (segment.type === 'plain') {
      processPlainSegment(acc, segment, maxLength);
    } else {
      processProtectedSegment(acc, segment, maxLength);
    }
  }

  return acc.result();
}
