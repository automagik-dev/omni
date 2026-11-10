import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';

const frontmatter = z
  .object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    'allowed-tools': z.string().trim().min(1).optional(),
  })
  .strict();

/** RFC-0005: count the whole file; only the router is exempt from peer grammar. */
export function lintSkill(text: string, name: string): string[] {
  const errors: string[] = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;
  if (lines > 100) errors.push(`over budget: ${lines} lines (maximum 100)`);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) errors.push('missing YAML frontmatter');
  else {
    try {
      const parsed = frontmatter.safeParse(Bun.YAML.parse(match[1] ?? ''));
      if (!parsed.success) errors.push(`invalid frontmatter: ${parsed.error.message}`);
      else {
        if (parsed.data.name !== name) errors.push(`frontmatter name must match directory: ${name}`);
        if (/`(?:omni|genie)\b/.test(text) && !parsed.data['allowed-tools']) {
          errors.push('shell skills require allowed-tools');
        }
      }
    } catch {
      errors.push('malformed YAML frontmatter');
    }
  }
  if (name !== 'omni') {
    const headings = [...text.matchAll(/^## (.+)\r?$/gm)].map((heading) => heading[1]);
    if (headings.join('|') !== 'When to Use|Flow|Rules') {
      errors.push('peer sections must be When to Use → Flow → Rules');
    }
  }
  return errors;
}

export function lintSkills(dir: string): { count: number; errors: string[] } {
  let count = 0;
  const errors: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(dir, entry.name, 'SKILL.md');
    // Reference-only directories (omni-ops) deliberately have no loadable skill.
    if (entry.name === 'omni-ops' && !existsSync(file)) continue;
    if (!existsSync(file)) {
      errors.push(`${file}: missing peer skill`);
      continue;
    }
    count++;
    errors.push(...lintSkill(readFileSync(file, 'utf8'), entry.name).map((error) => `${file}: ${error}`));
  }
  if (!count) errors.push('No skills linted');
  return { count, errors };
}

if (import.meta.main) {
  const { count, errors } = lintSkills(resolve(import.meta.dir, '../plugins/omni/skills'));
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log(`Skills lint: ${count} skills satisfy the 100-line budget, frontmatter and peer grammar`);
}
