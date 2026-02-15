/**
 * Minimal markdown conversion for Discord.
 *
 * Discord already supports most markdown, but bot messages do not render
 * markdown headers. Convert headers to bold text and passthrough everything else.
 */

/**
 * Convert markdown text to Discord-friendly markdown.
 *
 * Rules:
 * - # Header / ## Header / ... => **Header**
 * - Everything else: passthrough
 */
export function markdownToDiscord(markdown: string): string {
  const lines = markdown.split('\n');
  const converted: string[] = [];

  let inFencedCodeBlock = false;

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inFencedCodeBlock = !inFencedCodeBlock;
      converted.push(line);
      continue;
    }

    if (inFencedCodeBlock) {
      converted.push(line);
      continue;
    }

    const headerMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (headerMatch) {
      converted.push(`**${headerMatch[1]}**`);
      continue;
    }

    converted.push(line);
  }

  return converted.join('\n');
}
