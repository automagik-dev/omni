#!/usr/bin/env bun
/**
 * Deterministic release-notes generator for the GitHub release body.
 *
 * Replaces the git-cliff step in .github/workflows/release.yml. Reads the
 * conventional-commit history and the packages/db/drizzle diff for a tag
 * range, then renders:
 *
 *   - Highlights          — the few feat changes a user actually cares about
 *   - Breaking changes    — `!` markers and BREAKING CHANGE footers
 *   - Database migrations — new drizzle .sql files with their header summary
 *   - Detail sections     — grouped by conventional type, clustered by scope
 *   - Contributors, asset-verification instructions, and a compare link
 *
 * Everything is derived offline from git — no network calls — so the same
 * range always renders the same notes.
 *
 * Usage:
 *   bun scripts/release/generate-release-notes.ts \
 *     --to v2.260908.12 [--from v2.260902.5] [--channel stable|dev] \
 *     [--main-ref origin/main] [--repo automagik-dev/omni] [--output /tmp/release-notes.md]
 *
 * `--from` is the previous tag on dev, which is right for a dev prerelease
 * (per-merge notes). For `--channel stable` (a promoted candidate) that tag is
 * almost always a bare chore(version) bump, so the range is instead anchored at
 * the last release tag reachable from `--main-ref` — the last promoted release
 * (#1097). `--from` is only the fallback when main carries no release tag.
 *
 * The pure functions are exported for scripts/release/generate-release-notes.test.ts.
 */

import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types and schemas
// ---------------------------------------------------------------------------

export const RawCommitSchema = z.object({
  hash: z.string().regex(/^[0-9a-f]{40}$/),
  author: z.string(),
  subject: z.string(),
  body: z.string(),
});

export type RawCommit = z.infer<typeof RawCommitSchema>;

export type ParsedCommit = {
  hash: string;
  author: string;
  type: string;
  /** Raw conventional scope, defaulted to "core" when absent. */
  scope: string;
  /** Normalized grouping area, e.g. "channels/whatsapp" for scope "channel-whatsapp". */
  area: string;
  /** Subject description with any trailing " (#N)" PR reference stripped. */
  description: string;
  breaking: boolean;
  breakingNote: string | null;
  pr: number | null;
};

export type MigrationEntry = {
  /** Path relative to the repo root, e.g. packages/db/drizzle/0056_x.sql. */
  file: string;
  /** First header comment line of the migration, or "" when absent. */
  summary: string;
};

export type Highlight = {
  area: string;
  description: string;
  pr: number | null;
  hash: string;
  /** Other areas the same change (PR group) touched, excluding `area`. */
  extraAreas: string[];
};

export type ReleaseNotesInput = {
  repo: string;
  fromTag: string | null;
  toTag: string;
  commits: ParsedCommit[];
  migrations: MigrationEntry[];
};

// ---------------------------------------------------------------------------
// Commit parsing
// ---------------------------------------------------------------------------

const CONVENTIONAL_SUBJECT = /^(?<type>[a-z]+)(?:\((?<scope>[^)]*)\))?(?<bang>!)?:\s*(?<desc>.+)$/;
const TRAILING_PR_REF = /\s*\(#\d+\)\s*$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:\s*(?<note>[^\n]*(?:\n(?!\n)[^\n]*)*)/m;

const CHANNEL_SCOPES = new Set([
  'baileys',
  'discord',
  'email',
  'evolution',
  'gupshup',
  'instagram',
  'slack',
  'sms',
  'telegram',
  'whatsapp',
]);

/** Normalize a conventional scope into a grouping area. */
export function normalizeArea(scope: string): string {
  const lowered = scope.toLowerCase().replace(/\s*,\s*/g, '+');
  if (lowered.startsWith('channel-')) return `channels/${lowered.slice('channel-'.length)}`;
  if (CHANNEL_SCOPES.has(lowered)) return `channels/${lowered}`;
  return lowered;
}

/** Extract a PR number from "Merge pull request #N ..." or a "(#N)" reference. */
export function extractPrNumber(subject: string): number | null {
  const merge = /^Merge pull request #(\d+)/.exec(subject);
  if (merge?.[1]) return Number(merge[1]);
  const refs = [...subject.matchAll(/\(#(\d+)\)/g)];
  const last = refs.at(-1);
  return last?.[1] ? Number(last[1]) : null;
}

/** Detect a breaking change from the subject `!` marker or a BREAKING CHANGE footer. */
export function detectBreaking(bang: boolean, body: string): { breaking: boolean; note: string | null } {
  const footer = BREAKING_FOOTER.exec(body);
  const note = footer?.groups?.note?.replaceAll('\n', ' ').trim() || null;
  return { breaking: bang || footer !== null, note };
}

/**
 * Parse one raw commit. Returns null for commits the notes should skip:
 * unconventional subjects (merge commits included) and chore(version) bumps.
 */
export function parseCommit(raw: RawCommit): ParsedCommit | null {
  const match = CONVENTIONAL_SUBJECT.exec(raw.subject);
  if (!match?.groups) return null;
  const type = match.groups.type ?? '';
  const scope = match.groups.scope?.trim() || 'core';
  if (type === 'chore' && (scope === 'version' || scope === 'merge')) return null;
  const { breaking, note } = detectBreaking(match.groups.bang === '!', raw.body);
  const description = (match.groups.desc ?? '').replace(TRAILING_PR_REF, '').trim();
  return {
    hash: raw.hash,
    author: raw.author,
    type,
    scope,
    area: normalizeArea(scope),
    description,
    breaking,
    breakingNote: note,
    pr: extractPrNumber(raw.subject),
  };
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

const SECTIONS: ReadonlyArray<{ types: readonly string[]; title: string }> = [
  { types: ['feat'], title: '🚀 Features' },
  { types: ['fix'], title: '🐛 Bug Fixes' },
  { types: ['perf'], title: '⚡ Performance' },
  { types: ['refactor'], title: '♻️ Refactoring' },
  { types: ['test'], title: '🧪 Testing' },
  { types: ['docs'], title: '📚 Documentation' },
  { types: ['ci'], title: '⚙️ CI/CD' },
];
const FALLBACK_SECTION = '🔧 Miscellaneous';

/** Sort order for areas inside a section; unknown areas follow, alphabetically. */
const AREA_ORDER: readonly string[] = ['api', 'cli', 'ui', 'channels/', 'events', 'automations', 'db', 'core', 'sdk'];

function areaRank(area: string): number {
  const index = AREA_ORDER.findIndex((entry) => (entry.endsWith('/') ? area.startsWith(entry) : area === entry));
  return index === -1 ? AREA_ORDER.length : index;
}

function sectionTitle(type: string): string {
  return SECTIONS.find((section) => section.types.includes(type))?.title ?? FALLBACK_SECTION;
}

/**
 * Group commits into ordered sections by conventional type, clustering each
 * section's entries by area (known areas first, then alphabetically), while
 * preserving history order within an area. Empty sections are omitted.
 */
export function groupSections(commits: ParsedCommit[]): Array<{ title: string; commits: ParsedCommit[] }> {
  const titles = [...SECTIONS.map((section) => section.title), FALLBACK_SECTION];
  return titles
    .map((title) => {
      const members = commits
        .map((commit, index) => ({ commit, index }))
        .filter(({ commit }) => sectionTitle(commit.type) === title)
        .sort((a, b) => {
          const rank = areaRank(a.commit.area) - areaRank(b.commit.area);
          if (rank !== 0) return rank;
          const alpha = a.commit.area.localeCompare(b.commit.area);
          if (alpha !== 0) return alpha;
          return a.index - b.index;
        })
        .map(({ commit }) => commit);
      return { title, commits: members };
    })
    .filter((section) => section.commits.length > 0);
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

const MAX_HIGHLIGHTS = 6;

/**
 * Pick the 3–6 feat changes a reader cares about. Feat commits are grouped by
 * PR (commits without a PR reference stand alone); groups are ranked by
 * breaking-change presence, then by how many commits the change spans, then
 * by recency (history order). The group's representative line is its most
 * descriptive commit subject.
 */
export function selectHighlights(commits: ParsedCommit[]): Highlight[] {
  const feats = commits.filter((commit) => commit.type === 'feat');
  const groups = new Map<string, ParsedCommit[]>();
  for (const commit of feats) {
    const key = commit.pr === null ? commit.hash : `#${commit.pr}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(commit);
    else groups.set(key, [commit]);
  }
  return [...groups.values()]
    .map((group, index) => ({ group, index }))
    .sort((a, b) => {
      const breaking = Number(b.group.some((c) => c.breaking)) - Number(a.group.some((c) => c.breaking));
      if (breaking !== 0) return breaking;
      const size = b.group.length - a.group.length;
      if (size !== 0) return size;
      return a.index - b.index;
    })
    .slice(0, MAX_HIGHLIGHTS)
    .map(({ group }) => {
      const representative = group.reduce((best, candidate) =>
        candidate.description.length > best.description.length ? candidate : best,
      );
      const extraAreas = [...new Set(group.map((c) => c.area))]
        .filter((area) => area !== representative.area)
        .sort((a, b) => areaRank(a) - areaRank(b) || a.localeCompare(b));
      return {
        area: representative.area,
        description: representative.description,
        pr: representative.pr,
        hash: representative.hash,
        extraAreas,
      };
    });
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

/** Filter `git diff --name-status` output down to added drizzle migration files. */
export function parseAddedMigrations(nameStatusOutput: string): string[] {
  return nameStatusOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      return { status: status ?? '', path: rest.join('\t') };
    })
    .filter(({ status, path }) => status === 'A' && /^packages\/db\/drizzle\/[^/]+\.sql$/.test(path))
    .map(({ path }) => path)
    .sort();
}

/**
 * First paragraph of a migration's `--` header comment, joined into one line.
 * Stops at the first blank comment line (`--` alone) or non-comment line.
 */
export function summarizeMigrationHeader(sql: string): string {
  const paragraph: string[] = [];
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('--')) break;
    const text = trimmed.replace(/^--\s?/, '').trim();
    if (text.length === 0) {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(text);
  }
  return paragraph.join(' ');
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function commitUrl(repo: string, hash: string): string {
  return `https://github.com/${repo}/commit/${hash}`;
}

function refLink(repo: string, pr: number | null, hash: string): string {
  if (pr !== null) return `[#${pr}](https://github.com/${repo}/pull/${pr})`;
  return `[\`${hash.slice(0, 7)}\`](${commitUrl(repo, hash)})`;
}

function renderHighlights(input: ReleaseNotesInput, lines: string[]): void {
  const highlights = selectHighlights(input.commits);
  if (highlights.length === 0) return;
  lines.push('### ✨ Highlights', '');
  for (const highlight of highlights) {
    const spans = highlight.extraAreas.length > 0 ? ` — with changes across ${highlight.extraAreas.join(', ')}` : '';
    lines.push(
      `- **${highlight.area}:** ${capitalize(highlight.description)}${spans} (${refLink(input.repo, highlight.pr, highlight.hash)})`,
    );
  }
  lines.push('');
}

function renderBreakingChanges(input: ReleaseNotesInput, lines: string[]): void {
  const breaking = input.commits.filter((commit) => commit.breaking);
  if (breaking.length === 0) return;
  lines.push('### 💥 Breaking changes', '');
  for (const commit of breaking) {
    const note = commit.breakingNote ? ` — ${commit.breakingNote}` : '';
    lines.push(
      `- **${commit.area}:** ${capitalize(commit.description)}${note} (${refLink(input.repo, commit.pr, commit.hash)})`,
    );
  }
  lines.push('');
}

function renderMigrations(input: ReleaseNotesInput, lines: string[]): void {
  if (input.migrations.length === 0) return;
  const plural = input.migrations.length === 1 ? 'migration' : 'migrations';
  lines.push(
    '### 🗄️ Database migrations',
    '',
    `This release adds ${input.migrations.length} database ${plural}. Migrations are additive and idempotent`,
    'per the repository migration contract, and the API applies them automatically at boot',
    '(`migrateDb()`) — no manual upgrade step is required. See `packages/db/drizzle/` for details.',
    '',
  );
  for (const migration of input.migrations) {
    const name = migration.file.split('/').at(-1) ?? migration.file;
    const url = `https://github.com/${input.repo}/blob/${input.toTag}/${migration.file}`;
    const summary = migration.summary.length > 0 ? ` — ${migration.summary}` : '';
    lines.push(`- [\`${name}\`](${url})${summary}`);
  }
  lines.push('');
}

function renderDetailSections(input: ReleaseNotesInput, lines: string[]): void {
  for (const section of groupSections(input.commits)) {
    lines.push(`### ${section.title}`, '');
    for (const commit of section.commits) {
      lines.push(`- **${commit.area}:** ${commit.description} (${refLink(input.repo, commit.pr, commit.hash)})`);
    }
    lines.push('');
  }
}

function renderContributors(input: ReleaseNotesInput, lines: string[]): void {
  const contributors = [...new Set(input.commits.map((commit) => commit.author))].filter(
    (author) => author.length > 0 && !author.endsWith('[bot]'),
  );
  if (contributors.length === 0) return;
  lines.push('### 👥 Contributors', '');
  for (const author of contributors) lines.push(`- ${author}`);
  lines.push('');
}

function renderVerification(input: ReleaseNotesInput, lines: string[]): void {
  const version = input.toTag.replace(/^v/, '');
  lines.push(
    '### 🔐 Verifying release assets',
    '',
    'Each platform tarball (`darwin-arm64`, `linux-arm64`, `linux-x64-glibc`, `linux-x64-musl`) ships with a',
    'cosign keyless signature (`.bundle`) and GitHub-native build provenance (`.provenance.json`). Verify any',
    'tarball with:',
    '',
    '```sh',
    `gh attestation verify omni-${version}-<platform>.tar.gz --repo ${input.repo}`,
    '```',
    '',
  );
}

/** Render the full release body. Empty sections are omitted. */
export function renderReleaseNotes(input: ReleaseNotesInput): string {
  const lines: string[] = [];
  renderHighlights(input, lines);
  renderBreakingChanges(input, lines);
  renderMigrations(input, lines);
  renderDetailSections(input, lines);
  renderContributors(input, lines);
  renderVerification(input, lines);
  if (input.fromTag) {
    lines.push(
      `**Full changelog:** [${input.fromTag}...${input.toTag}](https://github.com/${input.repo}/compare/${input.fromTag}...${input.toTag})`,
      '',
    );
  }
  return `${lines.join('\n').trim()}\n`;
}

// ---------------------------------------------------------------------------
// Git plumbing (thin, untested wrapper around the pure logic above)
// ---------------------------------------------------------------------------

const FIELD_SEPARATOR = '\u001f';
const RECORD_SEPARATOR = '\u001e';
const TAG_PATTERN = /^v\d+\.\d+\.\d+$/;
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;

function runGit(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
}

/** Split `git log` output produced with the %H%x1f%an%x1f%s%x1f%b%x1e format. */
export function splitLogRecords(logOutput: string): RawCommit[] {
  return logOutput
    .split(RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n/, ''))
    .filter((record) => record.trim().length > 0)
    .map((record) => {
      const [hash, author, subject, body] = record.split(FIELD_SEPARATOR);
      return RawCommitSchema.parse({
        hash: hash?.trim() ?? '',
        author: author ?? '',
        subject: subject ?? '',
        body: body ?? '',
      });
    });
}

function collectCommits(fromTag: string | null, toTag: string): ParsedCommit[] {
  const range = fromTag ? `${fromTag}..${toTag}` : toTag;
  const output = runGit([
    'log',
    `--format=%H${FIELD_SEPARATOR}%an${FIELD_SEPARATOR}%s${FIELD_SEPARATOR}%b${RECORD_SEPARATOR}`,
    range,
  ]);
  return splitLogRecords(output)
    .map(parseCommit)
    .filter((commit): commit is ParsedCommit => commit !== null);
}

/**
 * Last vX.Y.Z tag reachable from `mainRef` other than `toTag` itself — the
 * previously promoted release. Null when main carries no release tag.
 */
function resolvePromotedBaseTag(mainRef: string, toTag: string): string | null {
  try {
    const tag = runGit(['describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', '--exclude', toTag, mainRef]).trim();
    return TAG_PATTERN.test(tag) ? tag : null;
  } catch {
    return null;
  }
}

function collectMigrations(fromTag: string | null, toTag: string): MigrationEntry[] {
  if (!fromTag) return [];
  const diff = runGit(['diff', '--name-status', `${fromTag}..${toTag}`, '--', 'packages/db/drizzle']);
  return parseAddedMigrations(diff).map((file) => ({
    file,
    summary: summarizeMigrationHeader(runGit(['show', `${toTag}:${file}`])),
  }));
}

function main(): void {
  const { values } = parseArgs({
    options: {
      from: { type: 'string' },
      to: { type: 'string' },
      repo: { type: 'string' },
      output: { type: 'string' },
      channel: { type: 'string' },
      'main-ref': { type: 'string' },
    },
  });
  const toTag = values.to ?? '';
  if (!TAG_PATTERN.test(toTag)) {
    throw new Error(`--to must be a vX.Y.Z release tag, got: ${toTag || '(missing)'}`);
  }
  let fromTag = values.from ?? null;
  if (fromTag !== null && !TAG_PATTERN.test(fromTag)) {
    throw new Error(`--from must be a vX.Y.Z release tag, got: ${fromTag}`);
  }
  const channel = values.channel ?? 'dev';
  if (channel !== 'stable' && channel !== 'dev') {
    throw new Error(`--channel must be stable or dev, got: ${channel}`);
  }
  if (channel === 'stable') {
    const mainRef = values['main-ref'] ?? 'origin/main';
    const promoted = resolvePromotedBaseTag(mainRef, toTag);
    if (promoted) {
      console.error(`stable channel: comparing against ${promoted}, the last release tag reachable from ${mainRef}`);
      fromTag = promoted;
    } else {
      console.error(
        `stable channel: no release tag reachable from ${mainRef}; falling back to ${fromTag ?? 'full history'}`,
      );
    }
  }
  const repo = values.repo ?? process.env.GITHUB_REPOSITORY ?? 'automagik-dev/omni';
  if (!REPO_PATTERN.test(repo)) {
    throw new Error(`repo must look like owner/name, got: ${repo}`);
  }

  const notes = renderReleaseNotes({
    repo,
    fromTag,
    toTag,
    commits: collectCommits(fromTag, toTag),
    migrations: collectMigrations(fromTag, toTag),
  });

  if (values.output) {
    writeFileSync(values.output, notes);
    console.error(`wrote release notes for ${toTag} to ${values.output}`);
  } else {
    console.log(notes);
  }
}

if (import.meta.main) {
  main();
}
