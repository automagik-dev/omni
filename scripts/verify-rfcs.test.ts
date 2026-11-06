/**
 * Tests for scripts/verify-rfcs.ts (the RFC index gate).
 *
 * Each case builds a throwaway git repository, so "tracked" means what git says, as in the real
 * run. Nothing depends on the live repository's content; `make verify-rfcs` runs the gate on it.
 *
 * Run: bun test scripts/verify-rfcs.test.ts
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type AllowEntry, findCitations, parseIndex, verifyRfcs } from './verify-rfcs';

const HEADER = '| # | Title | Status | Milestone | Issue | Design |\n|---|---|---|---|---|---|\n';

const GREEN_INDEX = `# RFCs\n\n${HEADER}| [RFC-0001](0001-first.md) | First | Accepted | — | #1 | — |
| RFC-0002 | Reserved | Draft | — | — | — |

## Earlier records

${HEADER}| ADR-0001 | Ownership | Accepted | — | — | — |
| — | Paired agents | Accepted | — | — | — |
`;

const repos: string[] = [];

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'verify-rfcs-'));
  repos.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  for (const args of [
    ['init', '-q'],
    ['add', '-A'],
  ]) {
    const result = Bun.spawnSync(['git', '-C', root, ...args]);
    if (result.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr.toString()}`);
  }
  return root;
}

function green(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'docs/rfcs/README.md': GREEN_INDEX,
    'docs/rfcs/0000-template.md': '# RFC-NNNN: Title\n',
    'docs/rfcs/0001-first.md': '# RFC-0001: First\n',
    '.genie/wishes/tracked-wish/WISH.md': '# Wish\n',
    '.genie/brainstorms/tracked-design/DESIGN.md': '# Design\n',
    'packages/core/src/a.ts': [
      '// RFC-0001 and RFC-0002 (reserved) and ADR-0001',
      '// wish: tracked-wish, Wish tracked-design',
      '// see .genie/wishes/tracked-wish/WISH.md.',
      '// see `.genie/brainstorms/tracked-design/`',
      '// IETF RFC 7231 is not an RFC citation',
    ].join('\n'),
    ...extra,
  };
}

afterEach(() => {
  for (const root of repos.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('verifyRfcs on a consistent repository', () => {
  test('passes', () => {
    expect(verifyRfcs(repo(green()), [])).toEqual([]);
  });

  test('passes when an allowlisted citation still dangles', () => {
    const allow: AllowEntry[] = [{ file: 'apps/x.js', cite: 'wish gone-design', reason: 'test' }];
    expect(verifyRfcs(repo(green({ 'apps/x.js': '// wish gone-design' })), allow)).toEqual([]);
  });
});

describe('citations (RED for any new dangling one)', () => {
  test('a new .genie path that git does not track fails', () => {
    const root = repo(green({ 'packages/api/src/b.ts': '// design: .genie/wishes/lost-wish/WISH.md' }));
    expect(verifyRfcs(root, [])).toEqual([
      'packages/api/src/b.ts:1: .genie/wishes/lost-wish/WISH.md is not tracked; track the design or cite its RFC',
    ]);
  });

  test('a path that exists on disk but is ignored by git still fails', () => {
    const root = repo(
      green({
        '.gitignore': '.genie/wishes/local-only/\n',
        '.genie/wishes/local-only/WISH.md': '# only on this machine\n',
        'apps/c.js': '// .genie/wishes/local-only/WISH.md',
      }),
    );
    expect(verifyRfcs(root, [])).toEqual([
      'apps/c.js:1: .genie/wishes/local-only/WISH.md is not tracked; track the design or cite its RFC',
    ]);
  });

  test('a new wish slug with no tracked wish or brainstorm fails', () => {
    const root = repo(green({ 'packages/db/drizzle/0100_x.sql': '-- Things (wish: lost-design, Group 1).' }));
    expect(verifyRfcs(root, [])).toEqual([
      'packages/db/drizzle/0100_x.sql:1: no tracked .genie/wishes/lost-design/ or .genie/brainstorms/lost-design/; track the design or cite its RFC',
    ]);
  });

  test('an allowlist entry for one file does not cover the same citation in a new file', () => {
    const allow: AllowEntry[] = [{ file: 'apps/x.js', cite: 'wish gone-design', reason: 'test' }];
    const root = repo(green({ 'apps/x.js': '// wish gone-design', 'apps/y.js': '// wish gone-design' }));
    expect(verifyRfcs(root, allow)).toEqual([
      'apps/y.js:1: no tracked .genie/wishes/gone-design/ or .genie/brainstorms/gone-design/; track the design or cite its RFC',
    ]);
  });

  test('an unknown RFC or ADR number fails', () => {
    const root = repo(green({ 'docs/guide.md': 'See RFC-0042 and ADR-0099.' }));
    expect(verifyRfcs(root, [])).toEqual([
      'docs/guide.md:1: RFC-0042 is not a row of docs/rfcs/README.md',
      'docs/guide.md:1: ADR-0099 is not a row of docs/rfcs/README.md',
    ]);
  });

  test('citations outside apps/ packages/ scripts/ docs/ are not scanned', () => {
    expect(verifyRfcs(repo(green({ 'README.md': 'RFC-0042 wish: lost-design' })), [])).toEqual([]);
  });

  test('a stale allowlist entry fails so the list only shrinks', () => {
    const allow: AllowEntry[] = [{ file: 'apps/x.js', cite: 'wish tracked-wish', reason: 'test' }];
    expect(verifyRfcs(repo(green({ 'apps/x.js': '// wish tracked-wish' })), allow)).toEqual([
      'scripts/verify-rfcs.ts ALLOWLIST: "wish tracked-wish" in apps/x.js no longer dangles; remove the entry',
    ]);
  });
});

describe('index rows and files', () => {
  const withIndex = (rows: string, extra: Record<string, string> = {}) =>
    repo({
      ...green(extra),
      'packages/core/src/a.ts': '',
      'docs/rfcs/README.md': `${HEADER}| [RFC-0001](0001-first.md) | First | Accepted | — | — | — |\n${rows}`,
    });

  test('an RFC file without a row fails', () => {
    expect(verifyRfcs(withIndex('', { 'docs/rfcs/0003-orphan.md': '# x\n' }), [])).toContain(
      'docs/rfcs/0003-orphan.md: no index row in docs/rfcs/README.md links it',
    );
  });

  test('a linked row without its file fails', () => {
    expect(verifyRfcs(withIndex('| [RFC-0004](0004-missing.md) | Missing | Draft | — | — | — |\n'), [])).toEqual([
      'docs/rfcs/README.md:4: RFC-0004 links 0004-missing.md, which is not a tracked file',
    ]);
  });

  test('a row linking a file of another number fails', () => {
    expect(verifyRfcs(withIndex('| [RFC-0005](0001-first.md) | Wrong | Draft | — | — | — |\n'), [])).toEqual([
      'docs/rfcs/README.md:4: RFC-0005 links 0001-first.md; the file must be named 0005-short-name.md',
    ]);
  });

  test('a reserved row must be Draft', () => {
    expect(verifyRfcs(withIndex('| RFC-0006 | Reserved | Accepted | — | — | — |\n'), [])).toEqual([
      'docs/rfcs/README.md:4: RFC-0006 has no file, so it is a reserved number and must be Draft',
    ]);
  });

  test('a duplicate number fails', () => {
    expect(verifyRfcs(withIndex('| RFC-0001 | Again | Draft | — | — | — |\n'), [])).toContain(
      'docs/rfcs/README.md:4: RFC-0001 is already used on line 3; whoever merges second renumbers',
    );
  });

  test('two files with the same number fail', () => {
    expect(verifyRfcs(withIndex('', { 'docs/rfcs/0001-second.md': '# x\n' }), [])).toContain(
      'docs/rfcs/0001-second.md: RFC-0001 is also docs/rfcs/0001-first.md; whoever merges second renumbers',
    );
  });

  test('a status outside the five words fails, including progress text', () => {
    const errors = verifyRfcs(withIndex('| RFC-0007 | Busy | Accepted (delivery 1 merged) | — | — | — |\n'), []);
    expect(errors[0]).toStartWith('docs/rfcs/README.md:4: status "Accepted (delivery 1 merged)" is not one of');
  });

  test('a malformed # cell fails', () => {
    expect(parseIndex(`${HEADER}| 7 | Bad | Draft | — | — | — |\n`).errors).toEqual([
      'docs/rfcs/README.md:3: # cell "7" is not [RFC-NNNN](NNNN-name.md), RFC-NNNN, ADR-NNNN or —',
    ]);
  });

  test('a missing index fails', () => {
    expect(verifyRfcs(repo({ 'apps/a.js': '' }), [])).toEqual(['docs/rfcs/README.md is missing']);
  });
});

describe('findCitations', () => {
  test('reads each citation shape and ignores prose and placeholders', () => {
    const text = [
      'RFC-0001, ADR-0003 and ADR-LID-0003',
      'Wish omni-chat-threads; WISH: omni-install-resilience; wish `slack-personal-oauth`',
      'see .genie/wishes/a-b/WISH.md. and .genie/brainstorms/<slug>/DESIGN.md',
      'a wish that holds, wishes come-true, RFC 7231',
    ].join('\n');
    expect(findCitations('f', text).map((c) => `${c.line} ${c.cite}`)).toEqual([
      '1 RFC-0001',
      '1 ADR-0003',
      '2 wish omni-chat-threads',
      '2 wish omni-install-resilience',
      '2 wish slack-personal-oauth',
      '3 .genie/wishes/a-b/WISH.md',
    ]);
  });
});
