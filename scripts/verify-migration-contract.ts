#!/usr/bin/env bun

/**
 * Migration contract gate (static).
 *
 * Enforces the hand-written-migration contract documented in .claude/CLAUDE.md
 * ("Database & Migrations") against packages/db/drizzle/. All checks are pure
 * git + filesystem — no database connection. NOT the same tool as
 * scripts/verify-schema-drift.ts, which audits a LIVE database at runtime.
 *
 * Checks:
 *   1. Journal ↔ files bijection, gap/duplicate-free idx sequence, idx matching
 *      the file's 4-digit number, strictly increasing `when` timestamps (the
 *      boot migrator silently skips out-of-order entries — see
 *      packages/db/src/migrate.ts).
 *   2. Deployed-migration immutability: every file under packages/db/drizzle/
 *      that exists on the base branch must be byte-identical here; journal
 *      entries present on the base branch must be an untouched prefix.
 *   3. Additive-only lint on NEW migrations (DROP TABLE/COLUMN, ALTER COLUMN
 *      ... TYPE, TRUNCATE are denied; ADD COLUMN / CREATE TABLE / CREATE INDEX
 *      must be IF NOT EXISTS). Escape hatch: a `-- destructive: <why>` header
 *      line waives the lint but forces the justification into the diff.
 *   4. Header requirement: new migrations must open with a `--` comment block.
 *   5. Pairing heuristic: a PR touching packages/db/src/schema.ts must add a
 *      migration and vice versa, with explicit escape-hatch markers
 *      (`// no-migration-needed: <why>` in the schema diff,
 *      `-- no-schema-change: <why>` in the migration header).
 *
 * Usage:
 *   bun scripts/verify-migration-contract.ts [--base <git-ref>]
 *
 * The base ref defaults to `origin/dev`; override with --base or the
 * OMNI_MIGRATION_BASE_REF env var (CI passes the PR's target branch). When the
 * base ref shares history with HEAD the comparison point is the merge-base,
 * otherwise the base ref's tip (correct in CI, where pull_request jobs check
 * out the merge commit).
 *
 * Exits 0 when the tree honors the contract, 1 with actionable messages
 * otherwise. Wired into `make check` and the Quality Gate job in
 * .github/workflows/ci.yml.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';

export const repoRoot = join(import.meta.dir, '..');

const MIGRATIONS_DIR = 'packages/db/drizzle';
const JOURNAL_PATH = `${MIGRATIONS_DIR}/meta/_journal.json`;
const SCHEMA_PATH = 'packages/db/src/schema.ts';
const CONTRACT_DOC = '.claude/CLAUDE.md ("Database & Migrations (Comprehensive Reference)")';

// ---------------------------------------------------------------------------
// Journal schema (Zod at the boundary — the journal is hand-appended)
// ---------------------------------------------------------------------------

export const JournalEntrySchema = z.object({
  idx: z.number().int().nonnegative(),
  version: z.string(),
  when: z.number().int().positive(),
  tag: z.string(),
  breakpoints: z.boolean(),
});

export const JournalSchema = z.object({
  version: z.string(),
  dialect: z.string(),
  entries: z.array(JournalEntrySchema),
});

export type Journal = z.infer<typeof JournalSchema>;

export interface Violation {
  readonly check: string;
  readonly file?: string;
  readonly message: string;
  readonly fix: string;
}

export function parseJournal(raw: string, file: string): { journal?: Journal; violations: Violation[] } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    return {
      violations: [
        {
          check: 'journal-parse',
          file,
          message: `Journal is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
          fix: 'Repair the JSON by hand — the journal is append-only; compare with the base branch to find the bad edit.',
        },
      ],
    };
  }
  const parsed = JournalSchema.safeParse(data);
  if (!parsed.success) {
    return {
      violations: [
        {
          check: 'journal-parse',
          file,
          message: `Journal does not match the expected shape: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}`,
          fix: 'Each entry needs { idx, version: "7", when, tag, breakpoints: true }. Copy the previous entry and adjust idx/when/tag.',
        },
      ],
    };
  }
  return { journal: parsed.data, violations: [] };
}

// ---------------------------------------------------------------------------
// Check 1 — journal ↔ files bijection + sequence + timestamps
// ---------------------------------------------------------------------------

function journalSequenceViolations(journal: Journal): Violation[] {
  const violations: Violation[] = [];
  let prevWhen = 0;
  for (const [position, entry] of journal.entries.entries()) {
    if (entry.idx !== position) {
      violations.push({
        check: 'journal-sequence',
        file: JOURNAL_PATH,
        message: `Entry at position ${position} has idx ${entry.idx} (tag ${entry.tag}) — the idx sequence must be 0,1,2,… with no gaps or duplicates. Duplicate idx values are the classic parallel-worktree collision (two branches both claimed the same number).`,
        fix: 'Renumber YOUR new migration: pick the next free number, rename the .sql file, update the entry tag + idx, and bump `when` above the previous entry. Never renumber a deployed migration.',
      });
    }
    const expectedPrefix = String(entry.idx).padStart(4, '0');
    if (!entry.tag.startsWith(`${expectedPrefix}_`)) {
      violations.push({
        check: 'journal-sequence',
        file: JOURNAL_PATH,
        message: `Entry idx ${entry.idx} has tag "${entry.tag}" — the tag must start with "${expectedPrefix}_" so file numbering and journal order cannot diverge.`,
        fix: `Rename the migration (file + tag) to start with ${expectedPrefix}_, or fix the idx.`,
      });
    }
    if (entry.when <= prevWhen) {
      violations.push({
        check: 'journal-when',
        file: JOURNAL_PATH,
        message: `Entry ${entry.tag} has when=${entry.when}, not greater than the previous entry's ${prevWhen}. The boot migrator SILENTLY SKIPS migrations whose \`when\` is out of order (see packages/db/src/migrate.ts).`,
        fix: 'Set `when` to any value greater than the previous entry (the convention is previous + 100000000).',
      });
    }
    prevWhen = entry.when;
  }
  return violations;
}

export function checkJournalIntegrity(journal: Journal, sqlFileNames: readonly string[]): Violation[] {
  const violations = journalSequenceViolations(journal);
  const tags = new Set(journal.entries.map((entry) => entry.tag));
  const fileTags = new Set(sqlFileNames.map((name) => name.replace(/\.sql$/, '')));
  for (const tag of tags) {
    if (!fileTags.has(tag)) {
      violations.push({
        check: 'journal-bijection',
        file: JOURNAL_PATH,
        message: `Journal entry "${tag}" has no matching ${MIGRATIONS_DIR}/${tag}.sql file.`,
        fix: 'Add the SQL file, or remove the journal entry if it was added by mistake (only if never deployed).',
      });
    }
  }
  for (const tag of fileTags) {
    if (!tags.has(tag)) {
      violations.push({
        check: 'journal-bijection',
        file: `${MIGRATIONS_DIR}/${tag}.sql`,
        message: `Migration file ${tag}.sql has no entry in ${JOURNAL_PATH} — the boot migrator will never apply it.`,
        fix: `Append {"idx": <next>, "version": "7", "when": <prev + 100000000>, "tag": "${tag}", "breakpoints": true} to the journal's entries array.`,
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Check 2 — deployed-migration immutability vs the base branch
// ---------------------------------------------------------------------------

export function checkBaseImmutability(
  baseFiles: ReadonlyMap<string, string>,
  headFiles: ReadonlyMap<string, string>,
): Violation[] {
  const violations: Violation[] = [];
  for (const [file, baseContent] of baseFiles) {
    const headContent = headFiles.get(file);
    if (headContent === undefined) {
      violations.push({
        check: 'base-immutability',
        file,
        message:
          'This file exists on the base branch but is missing here. Deployed migrations are immutable: deleting or renumbering one desyncs every database that already applied it.',
        fix: 'Restore the file exactly as it is on the base branch. If your branch is simply behind, merge the base branch (git merge). If you renamed it to resolve a numbering collision, renumber YOUR new migration instead.',
      });
    } else if (headContent !== baseContent) {
      violations.push({
        check: 'base-immutability',
        file,
        message:
          'This file differs from the base branch. Deployed migrations are immutable — the migrator tracks them by content hash, and an edited file is re-applied (or crashes) on every existing database.',
        fix: 'Revert this file to the base branch version (git checkout <base> -- <file>) and put the change in a NEW migration.',
      });
    }
  }
  return violations;
}

export function checkJournalPrefix(base: Journal, head: Journal): Violation[] {
  const violations: Violation[] = [];
  if (head.entries.length < base.entries.length) {
    violations.push({
      check: 'base-immutability',
      file: JOURNAL_PATH,
      message: `The journal has ${head.entries.length} entries but the base branch has ${base.entries.length}. Deployed journal entries must never be removed.`,
      fix: 'Restore the missing entries (or merge the base branch if you are behind); append new entries at the end only.',
    });
    return violations;
  }
  for (const [position, baseEntry] of base.entries.entries()) {
    const headEntry = head.entries[position];
    if (
      headEntry === undefined ||
      headEntry.idx !== baseEntry.idx ||
      headEntry.tag !== baseEntry.tag ||
      headEntry.when !== baseEntry.when
    ) {
      violations.push({
        check: 'base-immutability',
        file: JOURNAL_PATH,
        message: `Journal entry ${position} (${baseEntry.tag}) was edited or reordered relative to the base branch. Entries that exist on the base branch are an immutable prefix.`,
        fix: 'Restore the base branch entries verbatim and append your new entry after them.',
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Checks 3 + 4 — additive-only lint + mandatory header on NEW migrations
// ---------------------------------------------------------------------------

export function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
}

const DESTRUCTIVE_MARKER = /^--[ \t]*destructive:[ \t]*\S/m;
const NO_SCHEMA_CHANGE_MARKER = /^--[ \t]*no-schema-change:[ \t]*\S/m;
const NO_MIGRATION_NEEDED_MARKER = /no-migration-needed:\s*\S+/;

interface DenyRule {
  readonly pattern: RegExp;
  readonly label: string;
}

const DENY_RULES: readonly DenyRule[] = [
  { pattern: /\bDROP\s+TABLE\b/i, label: 'DROP TABLE' },
  { pattern: /\bDROP\s+COLUMN\b/i, label: 'DROP COLUMN' },
  { pattern: /\bALTER\s+COLUMN\b[^;]*?\bTYPE\b/i, label: 'ALTER COLUMN ... TYPE' },
  { pattern: /\bTRUNCATE\b/i, label: 'TRUNCATE' },
];

const IDEMPOTENCY_RULES: readonly DenyRule[] = [
  { pattern: /\bADD\s+COLUMN\s+(?!IF\s+NOT\s+EXISTS)/i, label: 'ADD COLUMN without IF NOT EXISTS' },
  { pattern: /\bCREATE\s+TABLE\s+(?!IF\s+NOT\s+EXISTS)/i, label: 'CREATE TABLE without IF NOT EXISTS' },
  {
    pattern: /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?!IF\s+NOT\s+EXISTS)/i,
    label: 'CREATE INDEX without IF NOT EXISTS',
  },
];

function headerViolations(name: string, content: string): Violation[] {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine?.startsWith('--') && !firstLine.startsWith('-->')) return [];
  return [
    {
      check: 'header',
      file: `${MIGRATIONS_DIR}/${name}`,
      message:
        'New migrations must start with a `--` comment block explaining what changed, why, and the issue/PR reference (the 0043/0044/0052 precedent).',
      fix: `Add a header, e.g.:\n      -- <What this adds> (#<issue>).\n      --\n      -- <Why, and any operational notes.>\n      -- Hand-written following the 0043/0044/0052 precedent (additive, idempotent).\n    See ${CONTRACT_DOC}.`,
    },
  ];
}

export function lintNewMigration(name: string, content: string): Violation[] {
  const violations = headerViolations(name, content);
  if (DESTRUCTIVE_MARKER.test(content)) return violations;
  const sql = stripSqlComments(content);
  for (const rule of [...DENY_RULES, ...IDEMPOTENCY_RULES]) {
    if (rule.pattern.test(sql)) {
      violations.push({
        check: 'additive-only',
        file: `${MIGRATIONS_DIR}/${name}`,
        message: `Contains ${rule.label}. New migrations must be additive and idempotent — the API auto-migrates on boot against live databases.`,
        fix: 'Rewrite the statement additively (IF NOT EXISTS / new column + backfill). If the destructive change is genuinely required, add a header line `-- destructive: <justification>` — the gate then passes and the justification lands in the diff for review.',
      });
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Check 5 — schema.ts ↔ migration pairing heuristic
// ---------------------------------------------------------------------------

export interface PairingInput {
  readonly schemaChanged: boolean;
  readonly schemaAddedLines: readonly string[];
  readonly newMigrations: ReadonlyArray<{ readonly name: string; readonly content: string }>;
}

export function checkPairing(input: PairingInput): Violation[] {
  const { schemaChanged, schemaAddedLines, newMigrations } = input;
  if (schemaChanged && newMigrations.length === 0) {
    if (schemaAddedLines.some((line) => NO_MIGRATION_NEEDED_MARKER.test(line))) return [];
    return [
      {
        check: 'pairing',
        file: SCHEMA_PATH,
        message:
          'schema.ts changed but no new migration was added. The schema and its SQL migration ship together — a schema-only change leaves every database behind the code.',
        fix: 'Add a hand-written migration under packages/db/drizzle/ + a journal entry. For a genuinely type-only change (no DDL impact), add a comment `// no-migration-needed: <why>` on one of the changed schema.ts lines.',
      },
    ];
  }
  if (!schemaChanged && newMigrations.length > 0) {
    const covered = newMigrations.some((migration) => NO_SCHEMA_CHANGE_MARKER.test(migration.content));
    if (covered) return [];
    return [
      {
        check: 'pairing',
        file: `${MIGRATIONS_DIR}/${newMigrations[0]?.name ?? ''}`,
        message:
          'A new migration was added but packages/db/src/schema.ts is unchanged. DDL that Drizzle should know about must land in schema.ts in the same PR.',
        fix: 'Update schema.ts to match, or — for data-only/index-only migrations with no schema.ts impact — add a header line `-- no-schema-change: <why>` to the migration.',
      },
    ];
  }
  return [];
}

// ---------------------------------------------------------------------------
// git plumbing + orchestration
// ---------------------------------------------------------------------------

function git(...args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = Bun.spawnSync(['git', ...args], { cwd: repoRoot, stdout: 'pipe', stderr: 'pipe' });
  return { ok: result.exitCode === 0, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function resolveBaseRef(argv: readonly string[]): string {
  const flagIndex = argv.indexOf('--base');
  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (!value) {
      console.error('--base requires a git ref argument');
      process.exit(2);
    }
    return value;
  }
  return process.env.OMNI_MIGRATION_BASE_REF ?? 'origin/dev';
}

/** Merge-base when history allows it, otherwise the base ref tip (shallow CI clones). */
function resolveComparePoint(baseRef: string): { commit: string; label: string } {
  const verified = git('rev-parse', '--verify', `${baseRef}^{commit}`);
  if (!verified.ok) {
    console.error(
      `Cannot resolve base ref "${baseRef}": ${verified.stderr.trim()}\nFetch it first (git fetch origin dev) or pass --base <ref> / set OMNI_MIGRATION_BASE_REF.`,
    );
    process.exit(2);
  }
  const tip = verified.stdout.trim();
  const mergeBase = git('merge-base', tip, 'HEAD');
  if (mergeBase.ok) return { commit: mergeBase.stdout.trim(), label: `${baseRef} (merge-base)` };
  return { commit: tip, label: `${baseRef} (tip — no shared history available)` };
}

function readBaseFiles(commit: string): Map<string, string> {
  const files = new Map<string, string>();
  const listing = git('ls-tree', '-r', '--name-only', commit, '--', MIGRATIONS_DIR);
  if (!listing.ok) return files;
  for (const path of listing.stdout.split('\n').filter(Boolean)) {
    const shown = git('show', `${commit}:${path}`);
    if (shown.ok) files.set(path, shown.stdout);
  }
  return files;
}

function readHeadFiles(): Map<string, string> {
  const files = new Map<string, string>();
  const root = join(repoRoot, MIGRATIONS_DIR);
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else files.set(join(MIGRATIONS_DIR, relative(root, full)), readFileSync(full, 'utf-8'));
    }
  };
  walk(root);
  return files;
}

function schemaDiff(compareCommit: string): { changed: boolean; addedLines: string[] } {
  const baseSchema = git('show', `${compareCommit}:${SCHEMA_PATH}`);
  const headSchema = readFileSync(join(repoRoot, SCHEMA_PATH), 'utf-8');
  const changed = !baseSchema.ok || baseSchema.stdout !== headSchema;
  if (!changed) return { changed: false, addedLines: [] };
  const diff = git('diff', compareCommit, '--', SCHEMA_PATH);
  const addedLines = diff.stdout
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));
  return { changed: true, addedLines };
}

function collectViolations(compareCommit: string): { violations: Violation[]; newMigrationCount: number } {
  const violations: Violation[] = [];
  const baseFiles = readBaseFiles(compareCommit);
  const headFiles = readHeadFiles();

  const headJournalRaw = headFiles.get(JOURNAL_PATH);
  const headSqlNames = [...headFiles.keys()]
    .filter((path) => path.endsWith('.sql'))
    .map((path) => path.slice(MIGRATIONS_DIR.length + 1));
  let headJournal: Journal | undefined;
  if (headJournalRaw === undefined) {
    violations.push({
      check: 'journal-parse',
      file: JOURNAL_PATH,
      message: 'Journal file is missing.',
      fix: 'Restore it from the base branch.',
    });
  } else {
    const parsed = parseJournal(headJournalRaw, JOURNAL_PATH);
    violations.push(...parsed.violations);
    headJournal = parsed.journal;
  }
  if (headJournal) violations.push(...checkJournalIntegrity(headJournal, headSqlNames));

  const immutableBase = new Map([...baseFiles].filter(([path]) => path !== JOURNAL_PATH));
  violations.push(...checkBaseImmutability(immutableBase, headFiles));

  const baseJournalRaw = baseFiles.get(JOURNAL_PATH);
  if (baseJournalRaw !== undefined && headJournal) {
    const baseParsed = parseJournal(baseJournalRaw, `${JOURNAL_PATH} (base)`);
    if (baseParsed.journal) violations.push(...checkJournalPrefix(baseParsed.journal, headJournal));
  }

  const newMigrations = [...headFiles]
    .filter(([path]) => path.endsWith('.sql') && !baseFiles.has(path))
    .map(([path, content]) => ({ name: path.slice(MIGRATIONS_DIR.length + 1), content }));
  for (const migration of newMigrations) {
    violations.push(...lintNewMigration(migration.name, migration.content));
  }

  const { changed, addedLines } = schemaDiff(compareCommit);
  violations.push(...checkPairing({ schemaChanged: changed, schemaAddedLines: addedLines, newMigrations }));

  return { violations, newMigrationCount: newMigrations.length };
}

function printReport(violations: readonly Violation[], label: string, newMigrationCount: number): void {
  if (violations.length === 0) {
    console.log(`Migration contract OK vs ${label} — ${newMigrationCount} new migration(s), journal consistent.`);
    return;
  }
  console.error(`Migration contract violations (vs ${label}):\n`);
  for (const violation of violations) {
    console.error(`  ✗ [${violation.check}] ${violation.file ?? ''}`);
    console.error(`    ${violation.message}`);
    console.error(`    Fix: ${violation.fix}\n`);
  }
  console.error(`${violations.length} violation(s). Contract reference: ${CONTRACT_DOC}.`);
}

function main(): void {
  const baseRef = resolveBaseRef(process.argv.slice(2));
  const { commit, label } = resolveComparePoint(baseRef);
  const { violations, newMigrationCount } = collectViolations(commit);
  printReport(violations, label, newMigrationCount);
  process.exit(violations.length === 0 ? 0 : 1);
}

if (import.meta.main) main();
