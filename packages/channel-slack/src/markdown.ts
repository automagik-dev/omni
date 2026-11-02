/**
 * Markdown → Slack mrkdwn conversion layer
 *
 * mrkdwn is NOT Markdown. The differences that matter:
 * - Bold is *one* asterisk, not two
 * - Italic is _underscores_ only
 * - Strikethrough is ~one~ tilde
 * - Links are <url|text>
 * - There are no headers, no images, no tables, and no list syntax
 * - `&`, `<` and `>` outside inline user/channel/link tokens must be escaped
 *
 * Conversions applied:
 * - Bold: **text** → *text*
 * - Italic: *text* → _text_
 * - Strikethrough: ~~text~~ → ~text~
 * - Links: [text](url) → <url|text>
 * - Images: ![alt](url) → <url|alt>
 * - Headers: # text → *text* (mrkdwn has no headers; bold is the closest)
 * - Fenced code blocks and inline code are passed through UNTOUCHED
 *
 * Also handles chunking messages to Slack's 4000-char limit.
 */

export const MAX_SLACK_MESSAGE_LENGTH = 4000;

/**
 * Escape the three characters Slack treats as markup.
 *
 * Use this directly when text must remain literal. The converter protects
 * recognized Slack tokens separately before escaping the surrounding prose.
 *
 * Slack specifies exactly these three, and `&` must go first or it would
 * double-escape the entities produced by the other two.
 */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A run of source text: fenced/inline code is preserved verbatim. */
interface Segment {
  text: string;
  isCode: boolean;
}

/**
 * Split text into code and non-code runs.
 *
 * Conversion must never reach inside code. Running the regexes over a whole
 * string mangles exactly the content an engineering agent produces most:
 * `**kwargs` in a Python sample becomes `*kwargs`, and a markdown link in a
 * snippet turns into Slack link syntax.
 *
 * Fences are matched before inline spans so a ``` block containing single
 * backticks stays whole.
 */
function segment(text: string): Segment[] {
  const segments: Segment[] = [];
  const codePattern = /(```[\s\S]*?```|`[^`\n]*`)/;
  // Consume native tokens atomically so backticks in link labels are not parsed as code.
  const pattern = new RegExp(`${PROTECTED_SLACK_PATTERN.source}|${codePattern.source}`, 'g');
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    if (match[1] === undefined) continue; // Native token: leave it in the surrounding prose run.
    const start = match.index ?? 0;
    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start), isCode: false });
    }
    segments.push({ text: match[0], isCode: true });
    lastIndex = start + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isCode: false });
  }
  return segments;
}

/** Undo escaping inside a URL, where & is a query separator and not markup. */
function unescapeUrl(url: string): string {
  return url.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/**
 * Inline Slack tokens plus literal placeholder-shaped input (to prevent collisions).
 * Broadcasts and subteams are deliberately excluded: model output, quoted user
 * content and errors must not page a whole channel or user group (#889).
 */
const PROTECTED_SLACK_PATTERN =
  /<(?:@[UW][A-Z0-9]+(?:\|[^<>\r\n]+)?|#[CG][A-Z0-9]+(?:\|[^<>\r\n]+)?|(?:https?:\/\/|mailto:|tel:|slack:\/\/)[^\s<>|]+(?:\|[^<>\r\n]*)?)>|OMNISLACKTOKEN\d+END/g;

/** Canonical live mention tokens, excluding literal examples inside code. */
export function inlineSlackMentions(text: string): Set<string> {
  const mentions = new Set<string>();
  const pattern =
    /<(?:@[UW][A-Z0-9]+|#[CG][A-Z0-9]+|!(?:here|channel|everyone)|!subteam\^S[A-Z0-9]+)(?:\|[^<>\r\n]+)?>/g;
  for (const run of segment(text)) {
    if (run.isCode) continue;
    for (const match of run.text.matchAll(pattern)) {
      mentions.add(match[0].replace(/\|[^>]*>/, '>'));
    }
  }
  return mentions;
}

/** Apply the markdown→mrkdwn rewrites to a single non-code run. */
function convertProse(text: string): string {
  const BOLD = '\u0000B\u0000';
  // Park tokens through all rewrites, including emphasis inside URL/label text.
  // Park literal placeholders too; restoration is a single pass, never recursive.
  const tokens: string[] = [];
  const protectedText = text.replace(PROTECTED_SLACK_PATTERN, (token) => `OMNISLACKTOKEN${tokens.push(token) - 1}END`);
  let out = escapeMrkdwn(protectedText);

  // Restore blockquotes. `>` is real mrkdwn markup at the start of a line, so
  // escaping it wholesale (correct for inline `>`) would silently kill every
  // quote. Only the line-leading marker comes back.
  out = out.replace(/^&gt;\s?/gm, '> ');

  // Headers → bold, via the placeholder rather than a literal `*`. Emitting
  // `*Title*` here would then be read by the italic pass below as markdown
  // italic and flipped to `_Title_`.
  out = out.replace(/^#{1,6}\s+(.+)$/gm, `${BOLD}$1${BOLD}`);

  // Images before links — ![alt](url) is a superset of [text](url).
  // The URL is un-escaped first: escapeMrkdwn turned & into &amp; inside
  // query strings, which would break the link target.
  out = out.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `<${unescapeUrl(url)}|${alt}>`);
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<${unescapeUrl(url)}|${label}>`);

  // Horizontal rules before the bullet pass, which would otherwise eat `---`.
  out = out.replace(/^(-{3,}|\*{3,}|_{3,})$/gm, '———');

  // Bullets: mrkdwn has no list syntax, so normalise the marker to a bullet
  // character. Claiming lists were "preserved" was wishful — `- item` renders
  // literally as `- item`. Runs before the emphasis passes so a `*` bullet is
  // not mistaken for italic markup.
  out = out.replace(/^(\s*)[-*+]\s+/gm, '$1• ');

  // Bold is parked in the placeholder so the single-asterisk italic pass
  // cannot see it. Running bold first (the old order) left markdown italic
  // `*text*` looking like mrkdwn bold, silently flipping the meaning.
  out = out.replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${BOLD}`);
  out = out.replace(/(^|[\s(])\*(?!\s)([^*\n]+?)\*(?=[\s).,;:!?]|$)/g, '$1_$2_');
  out = out.split(BOLD).join('*');

  // Strikethrough: ~~text~~ → ~text~
  out = out.replace(/~~(.+?)~~/g, '~$1~');

  return out.replace(/OMNISLACKTOKEN(\d+)END/g, (_match, index) => tokens[Number(index)] ?? '');
}

/**
 * Convert standard Markdown to Slack mrkdwn.
 */
export function markdownToMrkdwn(markdown: string): string {
  return segment(markdown)
    .map((s) => (s.isCode ? s.text : convertProse(s.text)))
    .join('');
}

/**
 * Return the language of an unterminated fence, '' when it has none, or null
 * when every fence in the text is balanced.
 */
function findOpenFence(text: string): string | null {
  const fences = text.match(/```[^\n]*/g);
  if (!fences || fences.length % 2 === 0) return null;
  return fences[fences.length - 1]?.slice(3).trim() ?? '';
}

/**
 * Chunk a message into parts that fit within Slack's max message length.
 *
 * Splits at newline boundaries when possible, and never leaves a fenced code
 * block open: a naive split drops an unbalanced ``` so the remainder of the
 * message renders as one big code block. When a chunk ends mid-fence the
 * fence is closed and reopened (with its language) in the next chunk.
 */
export function chunkMessage(text: string, maxLength = MAX_SLACK_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;
  /** Fence language carried across a split, so the reopened block keeps it. */
  let carryFence: string | null = null;

  while (remaining.length > 0) {
    const prefix = carryFence === null ? '' : `\`\`\`${carryFence}\n`;

    if (prefix.length + remaining.length <= maxLength) {
      chunks.push(prefix + remaining);
      break;
    }

    // Only reserve room for a closing fence once we know we need one.
    // Reserving unconditionally shrinks every chunk and produces more of them
    // than asked for, which the caller sees as a wrong chunk count.
    const split = (budget: number): number => {
      let at = remaining.lastIndexOf('\n', budget);
      if (at <= 0 || at < budget * 0.5) at = remaining.lastIndexOf(' ', budget);
      if (at <= 0 || at < budget * 0.5) at = budget;
      return at;
    };

    const plainBudget = Math.max(1, maxLength - prefix.length);
    let splitIndex = split(plainBudget);
    let head = remaining.slice(0, splitIndex);
    let openFence = findOpenFence(prefix + head);

    // A fence stayed open, so this chunk needs a closing ``` appended. Re-split
    // against the smaller budget so the result still fits.
    if (openFence !== null) {
      const fencedBudget = Math.max(1, maxLength - prefix.length - 4);
      splitIndex = split(fencedBudget);
      head = remaining.slice(0, splitIndex);
      openFence = findOpenFence(prefix + head);
    }

    chunks.push(openFence === null ? prefix + head : `${prefix + head}\n\`\`\``);
    carryFence = openFence;
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return chunks;
}
