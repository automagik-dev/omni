/**
 * Convert markdown syntax into WhatsApp-compatible formatting.
 */

const CODE_BLOCK_TOKEN_PREFIX = '__WA_CODE_BLOCK_';
const INLINE_CODE_TOKEN_PREFIX = '__WA_INLINE_CODE_';

function replaceWithTokens(
  input: string,
  regex: RegExp,
  formatter: (match: RegExpExecArray, index: number) => string,
  tokenPrefix: string,
): { text: string; tokens: string[] } {
  const tokens: string[] = [];
  const text = input.replace(regex, (match: string, ...rest: unknown[]) => {
    const token = `${tokenPrefix}${tokens.length}__`;
    const execMatch = Object.assign([match], {
      0: match,
      index: 0,
      input,
      groups: undefined,
    }) as unknown as RegExpExecArray;
    // Extract capture groups from rest (last two args are offset and input)
    for (let g = 0; g < rest.length - 2; g++) {
      (execMatch as unknown as string[])[g + 1] = rest[g] as string;
    }
    tokens.push(formatter(execMatch, tokens.length));
    return token;
  });

  return { text, tokens };
}

function restoreTokens(input: string, tokens: string[], tokenPrefix: string): string {
  let result = input;
  for (let i = 0; i < tokens.length; i += 1) {
    result = result.replace(`${tokenPrefix}${i}__`, tokens[i] ?? '');
  }
  return result;
}

function convertHeaders(input: string): string {
  // Convert headers to markdown-bold first so emphasis conversion can process consistently.
  return input.replace(/^(#{1,6})\s+(.+)$/gm, (_full, _hashes: string, content: string) => `**${content.trim()}**`);
}

function convertLinks(input: string): string {
  return input.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1: $2');
}

function convertEmphasis(input: string): string {
  const boldTokenPrefix = '__WA_BOLD_';
  const tripleTokenPrefix = '__WA_TRIPLE_';

  const triple = replaceWithTokens(input, /\*\*\*([^*\n]+?)\*\*\*/g, (match) => `*_${match[1]}_*`, tripleTokenPrefix);

  const bold = replaceWithTokens(triple.text, /\*\*([^*\n]+?)\*\*/g, (match) => `*${match[1]}*`, boldTokenPrefix);

  const converted = bold.text
    .replace(/~~~([\s\S]+?)~~~/g, '~$1~')
    .replace(/~~([\s\S]+?)~~/g, '~$1~')
    .replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1_$2_');

  const withBold = restoreTokens(converted, bold.tokens, boldTokenPrefix);
  return restoreTokens(withBold, triple.tokens, tripleTokenPrefix);
}

/**
 * Convert Markdown text into WhatsApp formatting syntax.
 */
export function markdownToWhatsApp(markdown: string): string {
  const fenced = replaceWithTokens(
    markdown,
    /```([^\n`]*)\n([\s\S]*?)```/g,
    (match) => {
      const code = match[2] ?? '';
      return `\`\`\`\n${code}\`\`\``;
    },
    CODE_BLOCK_TOKEN_PREFIX,
  );

  const inline = replaceWithTokens(
    fenced.text,
    /`([^`\n]+?)`/g,
    (match) => `\`${match[1]}\``,
    INLINE_CODE_TOKEN_PREFIX,
  );

  const converted = convertEmphasis(convertLinks(convertHeaders(inline.text)));
  const withInline = restoreTokens(converted, inline.tokens, INLINE_CODE_TOKEN_PREFIX);
  return restoreTokens(withInline, fenced.tokens, CODE_BLOCK_TOKEN_PREFIX);
}
