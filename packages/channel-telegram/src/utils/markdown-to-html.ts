/**
 * Convert markdown-like assistant output to Telegram HTML.
 *
 * This is intentionally lightweight (no external parser), covering the
 * subset we need for channel output.
 */

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(text: string): string {
  return escapeHtml(text).replace(/"/g, '&quot;');
}

function wrapTag(tag: 'b' | 'i' | 's', content: string): string {
  return `<${tag}>${content}</${tag}>`;
}

type InlineMarker = '**' | '*' | '_' | '~~';
interface MarkerNode {
  marker: InlineMarker;
  content: string[];
}

const MARKER_TAG: Record<InlineMarker, 'b' | 'i' | 's'> = {
  '**': 'b',
  '~~': 's',
  '*': 'i',
  _: 'i',
};

function closesTopMarker(stack: MarkerNode[], marker: InlineMarker): boolean {
  const top = stack[stack.length - 1];
  return top?.marker === marker;
}

function closeMarker(stack: MarkerNode[], root: string[]): void {
  const node = stack.pop();
  if (!node) return;
  const tag = MARKER_TAG[node.marker];
  const current = stack.length > 0 ? (stack[stack.length - 1]?.content ?? root) : root;
  current.push(wrapTag(tag, node.content.join('')));
}

function openMarker(stack: MarkerNode[], marker: InlineMarker): void {
  stack.push({ marker, content: [] });
}

function flushUnmatched(stack: MarkerNode[], root: string[]): void {
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node) break;
    const current = stack.length > 0 ? (stack[stack.length - 1]?.content ?? root) : root;
    current.push(`${escapeHtml(node.marker)}${node.content.join('')}`);
  }
}

function isAlphaNumericChar(ch: string | undefined): boolean {
  return !!ch && /[0-9A-Za-z]/.test(ch);
}

function isIntrawordSingleMarker(text: string, index: number): boolean {
  const prev = index > 0 ? text[index - 1] : undefined;
  const next = index + 1 < text.length ? text[index + 1] : undefined;
  return isAlphaNumericChar(prev) && isAlphaNumericChar(next);
}

function readInlineMarker(text: string, index: number): { marker: InlineMarker; length: number } | null {
  const two = text.slice(index, index + 2);
  if (two === '**' || two === '~~') return { marker: two as InlineMarker, length: 2 };
  const one = text[index];
  if (one === '*' || one === '_') return { marker: one as InlineMarker, length: 1 };
  return null;
}

function toggleMarker(stack: MarkerNode[], root: string[], marker: InlineMarker): void {
  if (closesTopMarker(stack, marker)) closeMarker(stack, root);
  else openMarker(stack, marker);
}

function applyInlineDecorations(text: string): string {
  const stack: MarkerNode[] = [];
  const root: string[] = [];

  const current = () => (stack.length > 0 ? (stack[stack.length - 1]?.content ?? root) : root);
  const flushText = (value: string) => {
    if (value) current().push(escapeHtml(value));
  };

  let i = 0;
  let buffer = '';

  while (i < text.length) {
    const marker = readInlineMarker(text, i);
    if (marker) {
      // Avoid intraword emphasis: foo_bar_baz, 2*3*4 should stay literal.
      if ((marker.marker === '*' || marker.marker === '_') && isIntrawordSingleMarker(text, i)) {
        buffer += text[i] ?? '';
        i += 1;
        continue;
      }

      flushText(buffer);
      buffer = '';
      toggleMarker(stack, root, marker.marker);
      i += marker.length;
      continue;
    }

    buffer += text[i] ?? '';
    i += 1;
  }

  flushText(buffer);
  flushUnmatched(stack, root);
  return root.join('');
}

function tryParseInlineCode(text: string, i: number): { html: string; next: number } | null {
  if (text[i] !== '`') return null;
  const end = text.indexOf('`', i + 1);
  if (end === -1) return null;
  return { html: `<code>${escapeHtml(text.slice(i + 1, end))}</code>`, next: end + 1 };
}

function tryParseLink(text: string, i: number): { html: string; next: number } | null {
  if (text[i] !== '[') return null;
  const closeBracket = text.indexOf(']', i + 1);
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') return null;
  const closeParen = text.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return null;
  const label = text.slice(i + 1, closeBracket);
  const url = text.slice(closeBracket + 2, closeParen);
  return { html: `<a href="${escapeAttribute(url)}">${parseInline(label)}</a>`, next: closeParen + 1 };
}

function parseInline(text: string): string {
  let i = 0;
  let result = '';
  let plainBuffer = '';

  const flushPlain = () => {
    if (!plainBuffer) return;
    result += applyInlineDecorations(plainBuffer);
    plainBuffer = '';
  };

  while (i < text.length) {
    const code = tryParseInlineCode(text, i);
    if (code) {
      flushPlain();
      result += code.html;
      i = code.next;
      continue;
    }

    const link = tryParseLink(text, i);
    if (link) {
      flushPlain();
      result += link.html;
      i = link.next;
      continue;
    }

    plainBuffer += text[i];
    i += 1;
  }

  flushPlain();
  return result;
}

function convertCodeFence(lines: string[], start: number): { html: string; nextIndex: number } {
  const startLine = lines[start] ?? '';
  const lang = startLine.slice(3).trim();

  let i = start + 1;
  const codeLines: string[] = [];

  while (i < lines.length && !/^[ \t]*```/.test(lines[i] ?? '')) {
    codeLines.push(lines[i] ?? '');
    i += 1;
  }

  const code = escapeHtml(codeLines.join('\n'));
  const classAttr = lang ? ` class="language-${escapeAttribute(lang)}"` : '';
  const html = `<pre><code${classAttr}>${code}</code></pre>`;

  // Skip closing fence if present.
  if (i < lines.length && /^[ \t]*```/.test(lines[i] ?? '')) {
    i += 1;
  }

  return { html, nextIndex: i };
}

function convertBlockquote(lines: string[], start: number): { html: string; nextIndex: number } {
  const quoteLines: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i] ?? '';
    const match = line.match(/^[ \t]*>[ \t]?(.*)$/);
    if (!match) break;
    quoteLines.push(parseInline(match[1] ?? ''));
    i += 1;
  }

  return {
    html: `<blockquote>${quoteLines.join('\n')}</blockquote>`,
    nextIndex: i,
  };
}

export function markdownToTelegramHtml(markdown: string): string {
  if (!markdown) return '';

  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const output: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';

    // Code fence
    if (/^[ \t]*```/.test(line)) {
      const { html, nextIndex } = convertCodeFence(lines, i);
      output.push(html);
      i = nextIndex;
      continue;
    }

    // Blockquote lines (merged)
    if (/^[ \t]*>/.test(line)) {
      const { html, nextIndex } = convertBlockquote(lines, i);
      output.push(html);
      i = nextIndex;
      continue;
    }

    // Headers #..######
    const headerMatch = line.match(/^[ \t]*(#{1,6})[ \t]+(.+)$/);
    if (headerMatch) {
      output.push(`<b>${parseInline(headerMatch[2] ?? '')}</b>`);
      i += 1;
      continue;
    }

    // Lists are plain passthrough (no extra Telegram markup)
    output.push(parseInline(line));
    i += 1;
  }

  return output.join('\n');
}
