/**
 * Tests for scripts/verify-migration-contract.ts (the static migration
 * contract gate — not verify-schema-drift.ts, which audits a live DB).
 *
 * The check functions are pure, so every case runs on synthetic fixtures.
 * One integration test spawns the real CLI with `--base HEAD` to prove the
 * git plumbing works and the committed tree honors its own contract.
 *
 * Run: bun test scripts/verify-migration-contract.test.ts
 */

import { describe, expect, test } from 'bun:test';
import {
  type Journal,
  checkBaseImmutability,
  checkJournalIntegrity,
  checkJournalPrefix,
  checkPairing,
  lintNewMigration,
  parseJournal,
  repoRoot,
  stripSqlComments,
} from './verify-migration-contract';

function journal(entries: Array<Partial<Journal['entries'][number]> & { tag: string }>): Journal {
  return {
    version: '7',
    dialect: 'postgresql',
    entries: entries.map((entry, position) => ({
      idx: entry.idx ?? position,
      version: entry.version ?? '7',
      when: entry.when ?? (position + 1) * 100,
      tag: entry.tag,
      breakpoints: entry.breakpoints ?? true,
    })),
  };
}

const GOOD_HEADER = '-- Adds widget config (#999).\n--\n-- Hand-written following the 0043/0044/0052 precedent.\n';

describe('parseJournal', () => {
  test('accepts the real journal shape', () => {
    const raw = JSON.stringify(journal([{ tag: '0000_init' }, { tag: '0001_more' }]));
    const result = parseJournal(raw, 'j');
    expect(result.violations).toEqual([]);
    expect(result.journal?.entries).toHaveLength(2);
  });

  test('rejects invalid JSON with a journal-parse violation', () => {
    const result = parseJournal('{not json', 'j');
    expect(result.journal).toBeUndefined();
    expect(result.violations[0]?.check).toBe('journal-parse');
  });

  test('rejects entries missing required fields', () => {
    const raw = JSON.stringify({ version: '7', dialect: 'postgresql', entries: [{ idx: 0, tag: 'x' }] });
    const result = parseJournal(raw, 'j');
    expect(result.violations[0]?.check).toBe('journal-parse');
  });
});

describe('checkJournalIntegrity (bijection + sequence + when)', () => {
  test('clean journal and matching files pass', () => {
    const j = journal([{ tag: '0000_a' }, { tag: '0001_b' }]);
    expect(checkJournalIntegrity(j, ['0000_a.sql', '0001_b.sql'])).toEqual([]);
  });

  test('SQL file without a journal entry fails (never applied)', () => {
    const j = journal([{ tag: '0000_a' }]);
    const violations = checkJournalIntegrity(j, ['0000_a.sql', '0001_orphan.sql']);
    expect(violations.map((violation) => violation.check)).toContain('journal-bijection');
    expect(violations[0]?.message).toContain('no entry');
  });

  test('journal entry without a SQL file fails', () => {
    const j = journal([{ tag: '0000_a' }, { tag: '0001_ghost' }]);
    const violations = checkJournalIntegrity(j, ['0000_a.sql']);
    expect(violations.map((violation) => violation.check)).toContain('journal-bijection');
  });

  test('duplicate idx (parallel-worktree collision) fails', () => {
    const j = journal([
      { tag: '0000_a', idx: 0 },
      { tag: '0001_b', idx: 1 },
      { tag: '0001_c', idx: 1, when: 300 },
    ]);
    const violations = checkJournalIntegrity(j, ['0000_a.sql', '0001_b.sql', '0001_c.sql']);
    expect(violations.some((violation) => violation.check === 'journal-sequence')).toBe(true);
  });

  test('gap in idx sequence fails', () => {
    const j = journal([
      { tag: '0000_a', idx: 0 },
      { tag: '0002_b', idx: 2 },
    ]);
    const violations = checkJournalIntegrity(j, ['0000_a.sql', '0002_b.sql']);
    expect(violations.some((violation) => violation.check === 'journal-sequence')).toBe(true);
  });

  test('tag number not matching idx fails', () => {
    const j = journal([{ tag: '0000_a' }, { tag: '0005_b' }]);
    const violations = checkJournalIntegrity(j, ['0000_a.sql', '0005_b.sql']);
    expect(violations.some((violation) => violation.message.includes('0001_'))).toBe(true);
  });

  test('non-increasing `when` fails (boot migrator silently skips)', () => {
    const j = journal([
      { tag: '0000_a', when: 200 },
      { tag: '0001_b', when: 200 },
    ]);
    const violations = checkJournalIntegrity(j, ['0000_a.sql', '0001_b.sql']);
    expect(violations.some((violation) => violation.check === 'journal-when')).toBe(true);
  });
});

describe('checkBaseImmutability', () => {
  const base = new Map([['packages/db/drizzle/0001_b.sql', 'ALTER TABLE t ADD COLUMN IF NOT EXISTS c text;']]);

  test('identical files pass; extra new files are allowed', () => {
    const head = new Map([...base, ['packages/db/drizzle/0002_new.sql', 'anything']]);
    expect(checkBaseImmutability(base, head)).toEqual([]);
  });

  test('edited deployed migration fails', () => {
    const head = new Map([['packages/db/drizzle/0001_b.sql', 'ALTER TABLE t ADD COLUMN IF NOT EXISTS c2 text;']]);
    const violations = checkBaseImmutability(base, head);
    expect(violations[0]?.check).toBe('base-immutability');
    expect(violations[0]?.message).toContain('differs from the base branch');
  });

  test('deleted/renumbered deployed migration fails', () => {
    const violations = checkBaseImmutability(base, new Map());
    expect(violations[0]?.check).toBe('base-immutability');
    expect(violations[0]?.message).toContain('missing here');
  });
});

describe('checkJournalPrefix', () => {
  const base = journal([{ tag: '0000_a' }, { tag: '0001_b' }]);

  test('appending a new entry passes', () => {
    const head = journal([{ tag: '0000_a' }, { tag: '0001_b' }, { tag: '0002_c' }]);
    expect(checkJournalPrefix(base, head)).toEqual([]);
  });

  test('editing a deployed entry fails', () => {
    const head = journal([{ tag: '0000_a' }, { tag: '0001_RENAMED' }, { tag: '0002_c' }]);
    const violations = checkJournalPrefix(base, head);
    expect(violations[0]?.check).toBe('base-immutability');
  });

  test('removing deployed entries fails', () => {
    const head = journal([{ tag: '0000_a' }]);
    const violations = checkJournalPrefix(base, head);
    expect(violations[0]?.message).toContain('never be removed');
  });
});

describe('lintNewMigration (header + additive-only)', () => {
  test('precedent-style additive migration passes', () => {
    const sql = `${GOOD_HEADER}\nALTER TABLE "instances"\n  ADD COLUMN IF NOT EXISTS "widget" text;\nCREATE INDEX IF NOT EXISTS "idx_widget" ON "instances" ("widget");\nCREATE TABLE IF NOT EXISTS "widgets" ("id" uuid PRIMARY KEY);\n`;
    expect(lintNewMigration('0099_widget.sql', sql)).toEqual([]);
  });

  test('headerless migration fails the header check', () => {
    const violations = lintNewMigration('0099_x.sql', 'ALTER TABLE t ADD COLUMN IF NOT EXISTS c text;');
    expect(violations.some((violation) => violation.check === 'header')).toBe(true);
  });

  test('a statement-breakpoint line does not count as a header', () => {
    const violations = lintNewMigration('0099_x.sql', '--> statement-breakpoint\nSELECT 1;');
    expect(violations.some((violation) => violation.check === 'header')).toBe(true);
  });

  test.each([
    ['DROP TABLE', 'DROP TABLE "widgets";'],
    ['DROP COLUMN', 'ALTER TABLE "t" DROP COLUMN "c";'],
    ['ALTER COLUMN ... TYPE', 'ALTER TABLE "t" ALTER COLUMN "c" TYPE bigint;'],
    ['ALTER COLUMN ... SET DATA TYPE', 'ALTER TABLE "t" ALTER COLUMN "c" SET DATA TYPE bigint;'],
    ['TRUNCATE', 'TRUNCATE "t";'],
    ['ADD COLUMN without IF NOT EXISTS', 'ALTER TABLE "t" ADD COLUMN "c" text;'],
    ['CREATE TABLE without IF NOT EXISTS', 'CREATE TABLE "t" ("id" uuid);'],
    ['CREATE INDEX without IF NOT EXISTS', 'CREATE UNIQUE INDEX "i" ON "t" ("c");'],
  ])('%s fails the additive lint', (_label, statement) => {
    const violations = lintNewMigration('0099_x.sql', `${GOOD_HEADER}\n${statement}\n`);
    expect(violations.some((violation) => violation.check === 'additive-only')).toBe(true);
  });

  test('the `-- destructive:` escape hatch waives the additive lint', () => {
    const sql = `${GOOD_HEADER}-- destructive: dropping legacy column per #999, data copied in 0098.\nALTER TABLE "t" DROP COLUMN "legacy";\n`;
    expect(lintNewMigration('0099_x.sql', sql)).toEqual([]);
  });

  test('a bare `-- destructive:` marker with no justification does not count', () => {
    const sql = `${GOOD_HEADER}-- destructive:\nALTER TABLE "t" DROP COLUMN "legacy";\n`;
    expect(lintNewMigration('0099_x.sql', sql).some((violation) => violation.check === 'additive-only')).toBe(true);
  });

  test('deny-listed words inside comments do not trip the lint', () => {
    const sql = `${GOOD_HEADER}-- Note: we deliberately do NOT DROP TABLE here; TRUNCATE was considered.\nALTER TABLE "t" ADD COLUMN IF NOT EXISTS "c" text;\n`;
    expect(lintNewMigration('0099_x.sql', sql)).toEqual([]);
  });
});

describe('stripSqlComments', () => {
  test('removes line and block comments', () => {
    expect(stripSqlComments('-- DROP TABLE x\nSELECT 1; /* TRUNCATE y */')).not.toMatch(/DROP|TRUNCATE/);
  });
});

describe('checkPairing (schema.ts ↔ migration)', () => {
  const migration = { name: '0099_x.sql', content: `${GOOD_HEADER}SELECT 1;` };

  test('schema change + new migration passes', () => {
    expect(
      checkPairing({ schemaChanged: true, schemaAddedLines: ['foo: text()'], newMigrations: [migration] }),
    ).toEqual([]);
  });

  test('no change on either side passes', () => {
    expect(checkPairing({ schemaChanged: false, schemaAddedLines: [], newMigrations: [] })).toEqual([]);
  });

  test('schema change without a migration fails', () => {
    const violations = checkPairing({ schemaChanged: true, schemaAddedLines: ['foo: text()'], newMigrations: [] });
    expect(violations[0]?.check).toBe('pairing');
  });

  test('`// no-migration-needed:` in the added schema lines waives it', () => {
    const violations = checkPairing({
      schemaChanged: true,
      schemaAddedLines: ['export type Foo = string; // no-migration-needed: type-only, no DDL impact'],
      newMigrations: [],
    });
    expect(violations).toEqual([]);
  });

  test('new migration without a schema change fails', () => {
    const violations = checkPairing({ schemaChanged: false, schemaAddedLines: [], newMigrations: [migration] });
    expect(violations[0]?.check).toBe('pairing');
  });

  test('`-- no-schema-change:` header waives the migration-only case', () => {
    const dataOnly = {
      name: '0099_x.sql',
      content: `${GOOD_HEADER}-- no-schema-change: backfill only, no DDL.\nSELECT 1;`,
    };
    const violations = checkPairing({ schemaChanged: false, schemaAddedLines: [], newMigrations: [dataOnly] });
    expect(violations).toEqual([]);
  });
});

describe('integration: the committed tree honors its own contract', () => {
  test('CLI exits 0 with --base HEAD', () => {
    const result = Bun.spawnSync(['bun', 'scripts/verify-migration-contract.ts', '--base', 'HEAD'], {
      cwd: repoRoot,
      stdout: 'pipe',
      stderr: 'pipe',
    });
    expect(result.stderr.toString()).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain('Migration contract OK');
  });
});
