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

type HtmlToken = { type: 'tag' | 'text'; value: string };

function tokenizeHtml(value: string): HtmlToken[] {
  const tokens: HtmlToken[] = [];
  const tagRe = /<[^>]+>/g;
  let last = 0;
  while (true) {
    const match = tagRe.exec(value);
    if (!match) break;
    const start = match.index;
    const end = start + match[0].length;
    if (start > last) tokens.push({ type: 'text', value: value.slice(last, start) });
    tokens.push({ type: 'tag', value: match[0] });
    last = end;
  }

  if (last < value.length) tokens.push({ type: 'text', value: value.slice(last) });
  return tokens;
}

function isSelfClosingTag(tag: string): boolean {
  return /\/>$/.test(tag) || /^<\s*(br|hr)\b/i.test(tag);
}

function parseOpeningTag(tag: string): { name: string; raw: string } | null {
  if (!/^</.test(tag) || /^<\//.test(tag) || isSelfClosingTag(tag)) return null;
  const m = tag.match(/^<\s*([a-z0-9]+)\b[^>]*>$/i);
  if (!m?.[1]) return null;
  return { name: m[1].toLowerCase(), raw: tag };
}

function parseClosingTag(tag: string): { name: string } | null {
  const m = tag.match(/^<\s*\/\s*([a-z0-9]+)\s*>$/i);
  if (!m?.[1]) return null;
  return { name: m[1].toLowerCase() };
}

function closingTagsFor(stack: Array<{ name: string; raw: string }>): string {
  let suffix = '';
  for (let i = stack.length - 1; i >= 0; i -= 1) suffix += `</${stack[i]?.name ?? ''}>`;
  return suffix;
}

function reopeningTagsFor(stack: Array<{ name: string; raw: string }>): string {
  return stack.map((t) => t.raw).join('');
}

function takeTextChunk(text: string, budget: number): { chunk: string; rest: string } {
  if (text.length <= budget) return { chunk: text, rest: '' };

  let splitAt = text.lastIndexOf('\n\n', budget);
  if (splitAt > 0) splitAt += 2;

  if (splitAt <= 0) {
    splitAt = text.lastIndexOf('\n', budget);
    if (splitAt > 0) splitAt += 1;
  }

  // Prefer not to split too early; otherwise hard cut.
  if (splitAt <= 0 || splitAt < budget * 0.5) splitAt = budget;

  return { chunk: text.slice(0, splitAt), rest: text.slice(splitAt) };
}

type OpenTag = { name: string; raw: string };
type PlainHtmlSplitState = {
  maxLength: number;
  chunks: string[];
  openStack: OpenTag[];
  current: string;
};

function appendCombinedChunk(chunks: string[], combined: string, maxLength: number): void {
  if (combined.length > maxLength) {
    // Should be extremely rare (would imply an enormous tag stack). Fallback to best-effort splitting.
    chunks.push(...splitPlainByBoundaries(combined, maxLength));
  } else {
    chunks.push(combined);
  }
}

function flushPlainHtmlState(state: PlainHtmlSplitState): void {
  if (!state.current) return;
  const suffix = closingTagsFor(state.openStack);
  appendCombinedChunk(state.chunks, state.current + suffix, state.maxLength);
  state.current = reopeningTagsFor(state.openStack);
}

function canAppendPlainHtml(state: PlainHtmlSplitState, part: string, nextOpen?: OpenTag): boolean {
  const suffixLen = nextOpen
    ? closingTagsFor([...state.openStack, nextOpen]).length
    : closingTagsFor(state.openStack).length;
  return state.current.length + part.length + suffixLen <= state.maxLength;
}

function popStackToMatchingTag(openStack: OpenTag[], name: string): void {
  const idxFromTop = [...openStack].reverse().findIndex((t) => t.name === name);
  if (idxFromTop < 0) return;
  openStack.splice(openStack.length - 1 - idxFromTop, idxFromTop + 1);
}

function appendTagTokenToState(state: PlainHtmlSplitState, tokenValue: string): void {
  const close = parseClosingTag(tokenValue);
  const open = parseOpeningTag(tokenValue);

  // If adding this tag would overflow, flush first (keeping stack as-is).
  if (open) {
    if (!canAppendPlainHtml(state, tokenValue, open)) flushPlainHtmlState(state);
  } else if (!canAppendPlainHtml(state, tokenValue)) {
    flushPlainHtmlState(state);
  }

  state.current += tokenValue;

  if (close) {
    popStackToMatchingTag(state.openStack, close.name);
    return;
  }

  if (open) state.openStack.push(open);
}

function appendTextTokenToState(state: PlainHtmlSplitState, text: string): void {
  let remaining = text;
  while (remaining) {
    if (canAppendPlainHtml(state, remaining)) {
      state.current += remaining;
      return;
    }

    const suffixLen = closingTagsFor(state.openStack).length;
    const budget = state.maxLength - state.current.length - suffixLen;
    if (budget <= 0) {
      flushPlainHtmlState(state);
      continue;
    }

    const { chunk, rest } = takeTextChunk(remaining, budget);
    state.current += chunk;
    remaining = rest;
    flushPlainHtmlState(state);
  }
}

/**
 * Split HTML while keeping each chunk valid Telegram HTML by ensuring inline tags are balanced.
 *
 * Assumes input is valid HTML (tags are balanced in the full string). We close/reopen open inline tags
 * at chunk boundaries to avoid unbalanced tags per message chunk.
 */
function splitPlainHtmlPreservingTags(value: string, maxLength: number): string[] {
  if (value.length <= maxLength) return [value];

  const tokens = tokenizeHtml(value);
  const state: PlainHtmlSplitState = {
    maxLength,
    chunks: [],
    openStack: [],
    current: '',
  };
  state.current = reopeningTagsFor(state.openStack);

  for (const token of tokens) {
    if (token.type === 'tag') {
      appendTagTokenToState(state, token.value);
      continue;
    }

    // Text token
    appendTextTokenToState(state, token.value);
  }

  // Final chunk
  flushPlainHtmlState(state);

  // Defensive: never return empty.
  return state.chunks.length > 0 ? state.chunks : [''];
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
  const plainParts = splitPlainHtmlPreservingTags(segment.value, maxLength);
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
