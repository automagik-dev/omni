import { describe, expect, it } from 'bun:test';
import { lintSkill } from './skills-lint';

const skill = [
  '---',
  'name: omni-peer',
  'description: Test peer',
  'allowed-tools: Bash(omni *)',
  '---',
  '## When to Use',
  'Use this peer.',
  '## Flow',
  'Read `omni --help`.',
  '## Rules',
  'Preserve scope.',
].join('\n');

describe('RFC-0005 skill shape', () => {
  it('accepts exactly 100 lines, with or without a final newline', () => {
    const hundred = skill + '\nContent'.repeat(89);
    expect(lintSkill(hundred, 'omni-peer')).toEqual([]);
    expect(lintSkill(`${hundred}\n`, 'omni-peer')).toEqual([]);
    expect(lintSkill(`${hundred}\nExtra\n`, 'omni-peer')).toContain('over budget: 101 lines (maximum 100)');
  });

  it.each([
    [skill.replace('name: omni-peer', 'name: other'), 'frontmatter name must match directory'],
    [skill.replace('description: Test peer', 'description: []'), 'invalid frontmatter'],
    [skill.replace('description: Test peer', 'description: ""'), 'invalid frontmatter'],
    [skill.replace('description: Test peer', 'description: ['), 'malformed YAML'],
    [skill.replace('description: Test peer', 'description: Test peer\nmodel: opus'), 'invalid frontmatter'],
    [skill.replace('allowed-tools: Bash(omni *)\n', ''), 'shell skills require allowed-tools'],
    [skill.replace('## Flow', '## Procedure'), 'peer sections'],
    [
      skill.replace('## When to Use', '## Rules').replace('## Rules\nPreserve', '## When to Use\nPreserve'),
      'peer sections',
    ],
    [skill.replace(/^---[\s\S]*?---\n/, ''), 'missing YAML frontmatter'],
  ])('rejects invalid skill shape: %s', (text, expected) => {
    expect(lintSkill(text, 'omni-peer').join('\n')).toContain(expected);
  });

  it('exempts the router only from grammar', () => {
    const router = skill.replace('name: omni-peer', 'name: omni').replace('## Flow', '## Intent → peer');
    expect(lintSkill(router, 'omni')).toEqual([]);
    expect(lintSkill(`${router}\nExtra`.repeat(20), 'omni').join('\n')).toContain('over budget');
    expect(lintSkill(router.replace('description: Test peer', 'description: null'), 'omni').join('\n')).toContain(
      'invalid frontmatter',
    );
  });
});
