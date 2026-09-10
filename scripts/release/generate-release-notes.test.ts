/**
 * Tests for scripts/release/generate-release-notes.ts (the deterministic
 * release-body generator that replaced the git-cliff step in release.yml).
 *
 * The parsing/grouping/rendering functions are pure, so every case runs on
 * synthetic fixtures. One integration test spawns the real CLI against the
 * repository's own history to prove the git plumbing works.
 *
 * Run: bun test scripts/release/generate-release-notes.test.ts
 */

import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type ParsedCommit,
  type RawCommit,
  detectBreaking,
  extractPrNumber,
  groupSections,
  normalizeArea,
  parseAddedMigrations,
  parseCommit,
  renderReleaseNotes,
  selectHighlights,
  splitLogRecords,
  summarizeMigrationHeader,
} from './generate-release-notes';

const HASH = 'a'.repeat(40);

function raw(subject: string, body = '', author = 'Alice'): RawCommit {
  return { hash: HASH, author, subject, body };
}

function commit(overrides: Partial<ParsedCommit>): ParsedCommit {
  return {
    hash: HASH,
    author: 'Alice',
    type: 'feat',
    scope: 'api',
    area: 'api',
    description: 'do something',
    breaking: false,
    breakingNote: null,
    pr: null,
    ...overrides,
  };
}

describe('parseCommit', () => {
  test('parses type, scope, and description', () => {
    const parsed = parseCommit(raw('feat(api): add batch endpoint (#42)'));
    expect(parsed).toMatchObject({
      type: 'feat',
      scope: 'api',
      area: 'api',
      description: 'add batch endpoint',
      pr: 42,
    });
  });

  test('defaults a missing scope to core', () => {
    const parsed = parseCommit(raw('fix: stop the bleeding'));
    expect(parsed).toMatchObject({ scope: 'core', area: 'core', description: 'stop the bleeding' });
  });

  test('skips unconventional subjects such as merge commits', () => {
    expect(parseCommit(raw('Merge pull request #1015 from automagik-dev/feat/989'))).toBeNull();
    expect(parseCommit(raw('random words with no colon'))).toBeNull();
  });

  test('skips chore(version) bump and chore(merge) sync noise', () => {
    expect(parseCommit(raw('chore(version): bump to 2.260908.12'))).toBeNull();
    expect(parseCommit(raw('chore(merge): resolve conflicts with main'))).toBeNull();
    expect(parseCommit(raw('chore(deps): bump zod'))).not.toBeNull();
  });

  test('flags a ! marker as breaking', () => {
    const parsed = parseCommit(raw('feat(api)!: drop the v1 surface'));
    expect(parsed?.breaking).toBe(true);
  });
});

describe('extractPrNumber', () => {
  test('reads a trailing (#N) reference', () => {
    expect(extractPrNumber('feat(cli): omni events consumers (#989)')).toBe(989);
  });

  test('reads merge-commit subjects', () => {
    expect(extractPrNumber('Merge pull request #1015 from automagik-dev/x')).toBe(1015);
  });

  test('uses the last reference when several appear', () => {
    expect(extractPrNumber('fix(api): follow-up to (#10) cleanup (#12)')).toBe(12);
  });

  test('returns null when no reference exists', () => {
    expect(extractPrNumber('fix(api): no reference here')).toBeNull();
  });
});

describe('detectBreaking', () => {
  test('detects a BREAKING CHANGE footer with its note', () => {
    const result = detectBreaking(false, 'Body text.\n\nBREAKING CHANGE: the /v1 routes are gone,\nuse /v2 instead.');
    expect(result.breaking).toBe(true);
    expect(result.note).toBe('the /v1 routes are gone, use /v2 instead.');
  });

  test('detects the BREAKING-CHANGE spelling', () => {
    expect(detectBreaking(false, 'BREAKING-CHANGE: renamed config keys').breaking).toBe(true);
  });

  test('a bang alone is breaking with no note', () => {
    expect(detectBreaking(true, 'ordinary body')).toEqual({ breaking: true, note: null });
  });

  test('plain commits are not breaking', () => {
    expect(detectBreaking(false, 'ordinary body').breaking).toBe(false);
  });
});

describe('normalizeArea', () => {
  test('maps channel scopes under channels/', () => {
    expect(normalizeArea('channel-whatsapp')).toBe('channels/whatsapp');
    expect(normalizeArea('discord')).toBe('channels/discord');
  });

  test('keeps ordinary scopes as-is, lowercased', () => {
    expect(normalizeArea('API')).toBe('api');
    expect(normalizeArea('events')).toBe('events');
  });

  test('joins multi-scope commits with +', () => {
    expect(normalizeArea('cli,sdk')).toBe('cli+sdk');
    expect(normalizeArea('sdk, cli')).toBe('sdk+cli');
  });
});

describe('groupSections', () => {
  test('orders sections by type and omits empty ones', () => {
    const sections = groupSections([
      commit({ type: 'docs', description: 'a runbook' }),
      commit({ type: 'fix', description: 'a fix' }),
      commit({ type: 'feat', description: 'a feature' }),
    ]);
    expect(sections.map((s) => s.title)).toEqual(['🚀 Features', '🐛 Bug Fixes', '📚 Documentation']);
  });

  test('clusters a section by area while preserving history order within one', () => {
    const sections = groupSections([
      commit({ type: 'feat', area: 'db', description: 'db one' }),
      commit({ type: 'feat', area: 'api', description: 'api one' }),
      commit({ type: 'feat', area: 'db', description: 'db two' }),
      commit({ type: 'feat', area: 'cli', description: 'cli one' }),
    ]);
    expect(sections[0]?.commits.map((c) => c.description)).toEqual(['api one', 'cli one', 'db one', 'db two']);
  });

  test('routes unknown types into Miscellaneous', () => {
    const sections = groupSections([commit({ type: 'build', description: 'tarball tweak' })]);
    expect(sections.map((s) => s.title)).toEqual(['🔧 Miscellaneous']);
  });
});

describe('selectHighlights', () => {
  test('returns nothing when there are no feat commits', () => {
    expect(selectHighlights([commit({ type: 'fix' })])).toEqual([]);
  });

  test('groups feats by PR and represents the group by its most descriptive subject', () => {
    const highlights = selectHighlights([
      commit({ pr: 989, area: 'cli', description: 'short one' }),
      commit({ pr: 989, area: 'api', description: 'durable consumer surface — register, pull, ack, lag' }),
      commit({ pr: 989, area: 'db', description: 'registry table' }),
      commit({ pr: 7, area: 'ui', description: 'tiny tweak' }),
    ]);
    expect(highlights).toHaveLength(2);
    expect(highlights[0]).toMatchObject({ area: 'api', pr: 989, extraAreas: ['cli', 'db'] });
    expect(highlights[1]).toMatchObject({ area: 'ui', pr: 7, extraAreas: [] });
  });

  test('ranks breaking changes first, then larger changes, then recency', () => {
    const highlights = selectHighlights([
      commit({ pr: 1, description: 'newest small feat' }),
      commit({ pr: 2, description: 'big feat part one' }),
      commit({ pr: 2, description: 'big feat part two!' }),
      commit({ pr: 3, description: 'old breaking feat', breaking: true }),
    ]);
    expect(highlights.map((h) => h.pr)).toEqual([3, 2, 1]);
  });

  test('caps the list at six', () => {
    const feats = Array.from({ length: 9 }, (_, i) => commit({ pr: i + 1, description: `feat ${i + 1}` }));
    expect(selectHighlights(feats)).toHaveLength(6);
  });
});

describe('parseAddedMigrations', () => {
  test('keeps only added drizzle .sql files, sorted', () => {
    const output = [
      'A\tpackages/db/drizzle/0062_agent_event_manifest.sql',
      'M\tpackages/db/drizzle/meta/_journal.json',
      'A\tpackages/db/drizzle/0053_gupshup_handoff_options.sql',
      'A\tpackages/db/drizzle/meta/0001_snapshot.json',
      'D\tpackages/db/drizzle/0001_gone.sql',
      'A\tpackages/db/src/schema.ts',
    ].join('\n');
    expect(parseAddedMigrations(output)).toEqual([
      'packages/db/drizzle/0053_gupshup_handoff_options.sql',
      'packages/db/drizzle/0062_agent_event_manifest.sql',
    ]);
  });

  test('returns an empty list for an empty diff', () => {
    expect(parseAddedMigrations('')).toEqual([]);
  });
});

describe('summarizeMigrationHeader', () => {
  test('returns the first header paragraph, stopping at a blank comment line', () => {
    const sql = '-- Gupshup per-instance handoff options.\n--\n-- More detail.\nALTER TABLE x ADD COLUMN y;';
    expect(summarizeMigrationHeader(sql)).toBe('Gupshup per-instance handoff options.');
  });

  test('joins a wrapped first paragraph into one line', () => {
    const sql =
      '-- Connector lifecycle contract (#961) — liveness, heartbeat, declared\n-- verbs.\n--\n-- Detail.\nSELECT 1;';
    expect(summarizeMigrationHeader(sql)).toBe(
      'Connector lifecycle contract (#961) — liveness, heartbeat, declared verbs.',
    );
  });

  test('skips a leading empty comment line', () => {
    expect(summarizeMigrationHeader('--\n-- The real summary.\nSELECT 1;')).toBe('The real summary.');
  });

  test('returns empty for a file without a header comment', () => {
    expect(summarizeMigrationHeader('ALTER TABLE x ADD COLUMN y;')).toBe('');
  });
});

describe('splitLogRecords', () => {
  const FS = '\u001f';
  const RS = '\u001e';

  test('splits field- and record-separated git log output', () => {
    const record = `${HASH}${FS}Alice${FS}feat(api): thing (#1)${FS}body line\n${RS}\n`;
    const commits = splitLogRecords(record + record.replace(/^a{40}/, 'b'.repeat(40)));
    expect(commits).toHaveLength(2);
    expect(commits[0]).toMatchObject({ hash: HASH, author: 'Alice', subject: 'feat(api): thing (#1)' });
  });

  test('rejects malformed hashes via the Zod boundary', () => {
    expect(() => splitLogRecords(`nothash${FS}A${FS}s${FS}b${RS}`)).toThrow();
  });
});

describe('renderReleaseNotes', () => {
  const repo = 'automagik-dev/omni';

  test('renders every section for a full release and links PRs over commits', () => {
    const body = renderReleaseNotes({
      repo,
      fromTag: 'v1.0.0',
      toTag: 'v1.1.0',
      commits: [
        commit({ pr: 989, description: 'durable consumer surface' }),
        commit({ type: 'fix', pr: null, description: 'unexport internal clamps' }),
        commit({
          type: 'feat',
          pr: 12,
          description: 'drop legacy flag',
          breaking: true,
          breakingNote: 'use --new instead',
        }),
      ],
      migrations: [{ file: 'packages/db/drizzle/0056_x.sql', summary: 'Adds x.' }],
    });
    expect(body).toContain('### ✨ Highlights');
    expect(body).toContain('### 💥 Breaking changes');
    expect(body).toContain('use --new instead');
    expect(body).toContain('### 🗄️ Database migrations');
    expect(body).toContain(
      '[`0056_x.sql`](https://github.com/automagik-dev/omni/blob/v1.1.0/packages/db/drizzle/0056_x.sql) — Adds x.',
    );
    expect(body).toContain('[#989](https://github.com/automagik-dev/omni/pull/989)');
    expect(body).toContain(`[\`${HASH.slice(0, 7)}\`](https://github.com/automagik-dev/omni/commit/${HASH})`);
    expect(body).toContain('### 👥 Contributors');
    expect(body).toContain('gh attestation verify omni-1.1.0-<platform>.tar.gz --repo automagik-dev/omni');
    expect(body).toContain('[v1.0.0...v1.1.0](https://github.com/automagik-dev/omni/compare/v1.0.0...v1.1.0)');
  });

  test('omits empty sections entirely', () => {
    const body = renderReleaseNotes({
      repo,
      fromTag: null,
      toTag: 'v1.0.0',
      commits: [commit({ type: 'fix', description: 'one fix' })],
      migrations: [],
    });
    expect(body).not.toContain('Highlights');
    expect(body).not.toContain('Breaking changes');
    expect(body).not.toContain('Database migrations');
    expect(body).not.toContain('Full changelog');
    expect(body).toContain('### 🐛 Bug Fixes');
  });

  test('excludes bot authors from contributors', () => {
    const body = renderReleaseNotes({
      repo,
      fromTag: null,
      toTag: 'v1.0.0',
      commits: [commit({ author: 'github-actions[bot]', type: 'fix' }), commit({ author: 'Sofia', type: 'fix' })],
      migrations: [],
    });
    expect(body).toContain('- Sofia');
    expect(body).not.toContain('github-actions[bot]');
  });
});

describe('candidate range (#1097)', () => {
  const script = join(import.meta.dir, 'generate-release-notes.ts');

  /**
   * main: feat A → v1.0.0 (promoted). dev, off main: feat B (#5), bump → v1.0.1,
   * fix C (#6), bump → v1.0.2 (the candidate). The previous tag v1.0.1 is a
   * bump-only commit, so previous-tag notes for v1.0.2 would list only fix C.
   */
  function fixtureRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'release-notes-'));
    const git = (...args: string[]) => {
      const result = Bun.spawnSync(['git', ...args], { cwd: dir });
      if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    };
    const commit = (subject: string) => {
      writeFileSync(join(dir, 'f'), subject);
      git('add', 'f');
      git('-c', 'user.name=Alice', '-c', 'user.email=a@x', 'commit', '-q', '-m', subject);
    };
    git('init', '-q', '-b', 'main');
    commit('feat(api): A');
    git('tag', 'v1.0.0');
    git('checkout', '-q', '-b', 'dev');
    commit('feat(cli): B (#5)');
    commit('chore(version): bump to 1.0.1');
    git('tag', 'v1.0.1');
    commit('fix(api): C (#6)');
    commit('chore(version): bump to 1.0.2');
    git('tag', 'v1.0.2');
    return dir;
  }

  function run(dir: string, ...args: string[]): string {
    const result = Bun.spawnSync(['bun', script, '--to', 'v1.0.2', '--repo', 'o/r', ...args], { cwd: dir });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString();
  }

  test('stable compares against the last tag reachable from main, not the bump-only previous tag', () => {
    const body = run(fixtureRepo(), '--from', 'v1.0.1', '--channel', 'stable', '--main-ref', 'main');
    expect(body).toContain('### 🚀 Features');
    expect(body).toContain('- **cli:** B ([#5](https://github.com/o/r/pull/5))');
    expect(body).toContain('- **api:** C ([#6](https://github.com/o/r/pull/6))');
    expect(body).not.toContain('feat(api): A');
    expect(body).toContain('[v1.0.0...v1.0.2](https://github.com/o/r/compare/v1.0.0...v1.0.2)');
    expect(body).toContain('### 🔐 Verifying release assets');
  });

  test('dev keeps the previous-tag range', () => {
    const body = run(fixtureRepo(), '--from', 'v1.0.1', '--channel', 'dev');
    expect(body).not.toContain('Features');
    expect(body).toContain('- **api:** C ([#6](https://github.com/o/r/pull/6))');
    expect(body).toContain('[v1.0.1...v1.0.2]');
  });

  test('stable falls back to --from when main has no release tag', () => {
    const dir = fixtureRepo();
    Bun.spawnSync(['git', 'tag', '-d', 'v1.0.0'], { cwd: dir });
    const body = run(dir, '--from', 'v1.0.1', '--channel', 'stable', '--main-ref', 'main');
    expect(body).toContain('[v1.0.1...v1.0.2]');
  });
});

describe('CLI integration', () => {
  test('renders notes for a real range in this repository', () => {
    const result = Bun.spawnSync([
      'bun',
      'scripts/release/generate-release-notes.ts',
      '--from',
      'v2.260908.11',
      '--to',
      'v2.260908.12',
      '--repo',
      'automagik-dev/omni',
    ]);
    expect(result.exitCode).toBe(0);
    const body = result.stdout.toString();
    expect(body).toContain('### 🚀 Features');
    expect(body).toContain('Full changelog');
  });

  test('rejects a malformed --to tag', () => {
    const result = Bun.spawnSync(['bun', 'scripts/release/generate-release-notes.ts', '--to', 'not-a-tag']);
    expect(result.exitCode).not.toBe(0);
  });
});
