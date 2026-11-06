#!/usr/bin/env bun
/**
 * RFC index gate (`make verify-rfcs`, part of `make check` and CI).
 *
 * docs/rfcs/README.md is the one index of design decisions. This static check keeps it and the
 * code honest. No network, no database: it reads the git index and tracked files.
 *
 * 1. Index rows and files match. A row whose # cell links `NNNN-*.md` needs that file; every
 *    `docs/rfcs/NNNN-*.md` (except the 0000 template) needs a row. An unlinked `RFC-NNNN` row is
 *    a reserved number and must be Draft. Numbers are unique, and Status is one word from
 *    STATUSES.
 * 2. Every `RFC-NNNN` cited in apps/ packages/ scripts/ docs/ is a row of the index.
 * 3. Every `ADR-NNNN` cited there is an ADR row of the index (the keys are frozen).
 * 4. Every `.genie/wishes/...` or `.genie/brainstorms/...` path and every `wish <slug>` cited
 *    there resolves to a file git tracks. Citations that were already dangling when the gate
 *    landed sit in ALLOWLIST; an entry that no longer matches anything is an error, so the list
 *    only shrinks.
 *
 * Run: bun scripts/verify-rfcs.ts [--root <repo>]
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const repoRoot = join(import.meta.dir, '..');

export const STATUSES = ['Draft', 'Accepted', 'Shipped', 'Parked', 'Superseded'] as const;

const INDEX_PATH = 'docs/rfcs/README.md';
const RFC_FILE = /^docs\/rfcs\/(\d{4})-[a-z0-9-]+\.md$/;
const TEMPLATE_NUMBER = '0000';
const SCAN_ROOTS = ['apps', 'packages', 'scripts', 'docs'];
/** Files that quote citation shapes as examples, not as citations. */
const SCAN_EXCLUDE = new Set(['scripts/verify-rfcs.ts', 'scripts/verify-rfcs.test.ts', 'docs/rfcs/0000-template.md']);

export interface AllowEntry {
  /** Repo-relative file, or '*' for every file. */
  file: string;
  /** The citation as reported: `.genie/wishes/<path>` or `wish <slug>`. */
  cite: string;
  reason: string;
}

const CHAT_THREADS = 'omni-chat-threads design: rebuilt as RFC-0001 (reserved), then this entry goes';
const NOT_A_WISH = 'prose, not a wish slug';
const LOCAL_ONLY = 'design exists only on one machine; the owner decides whether it is published';
const MISSING = 'design was never committed';
const IETF = 'IETF RFC (UUID format), not an Omni RFC; write "RFC 4122" in new code';

/** Dangling citations that predate this gate. Remove an entry when its design is tracked. */
export const ALLOWLIST: AllowEntry[] = [
  { file: '*', cite: 'wish omni-chat-threads', reason: CHAT_THREADS },
  {
    file: 'packages/db/drizzle/0033_close_contact_logs.sql',
    cite: '.genie/wishes/559-close-contact/design.md',
    reason: MISSING,
  },
  { file: 'packages/api/src/scheduler.ts', cite: '.genie/wishes/idle-chat-follow-up/WISH.md', reason: MISSING },
  { file: 'docs/guides/idle-chat-follow-up.md', cite: '.genie/wishes/idle-chat-follow-up/WISH.md', reason: MISSING },
  {
    file: 'packages/cli/src/commands/update.ts',
    cite: '.genie/wishes/update-unify-stages/SHARED-DESIGN.md',
    reason: MISSING,
  },
  {
    file: 'packages/cli/src/lib/pgserve-transport.ts',
    cite: '.genie/wishes/pgserve-singleton-no-proxy/SHARED-DESIGN.md',
    reason: MISSING,
  },
  {
    file: 'packages/cli/src/runtime-env.ts',
    cite: '.genie/wishes/pgserve-singleton-no-proxy/SHARED-DESIGN.md',
    reason: MISSING,
  },
  {
    file: 'packages/cli/src/__tests__/pgserve-transport.test.ts',
    cite: '.genie/wishes/pgserve-singleton-no-proxy/',
    reason: MISSING,
  },
  {
    file: 'packages/cli/src/__tests__/requirements.test.ts',
    cite: '.genie/wishes/pgserve-singleton-no-proxy/',
    reason: MISSING,
  },
  {
    file: 'packages/api/src/lib/__tests__/sentry-scrub-whatsapp-business-audit.test.ts',
    cite: '.genie/wishes/whatsapp-business-channel/WISH.md',
    reason: MISSING,
  },
  { file: 'packages/db/drizzle/0092_connector_ingress.sql', cite: 'wish gitlab-sdlc-connector', reason: LOCAL_ONLY },
  ...[
    'packages/cli/src/signing.ts',
    'packages/cli/src/__tests__/signing.test.ts',
    'packages/cli/src/commands/trust.ts',
    'packages/api/src/routes/v2/trust.ts',
    'packages/api/src/middleware/genie-signature.ts',
    'packages/api/src/middleware/__tests__/genie-signature.test.ts',
    'packages/api/src/middleware/__tests__/scope-enforcer-host-scopes.test.ts',
    'packages/api/src/middleware/require-signed-instance.ts',
    'packages/api/src/middleware/__tests__/require-signed-instance.test.ts',
    'packages/api/src/__tests__/host-fingerprint-pipeline.test.ts',
  ].map((file) => ({ file, cite: 'wish omni-host-fingerprint-trust', reason: MISSING })),
  ...[
    'packages/db/drizzle/0089_connectors.sql',
    'packages/db/drizzle/0090_connector_event_ownership.sql',
    'packages/db/src/tenancy-ownership.ts',
    'packages/db/src/tenancy-db-access-guard.ts',
  ].map((file) => ({ file, cite: 'wish connectors-first-slice-clickup', reason: MISSING })),
  ...[
    'packages/api/src/routes/v2/__tests__/console-profile-scope-coverage.test.ts',
    'packages/api/src/routes/v2/__tests__/keys-console-profiles.test.ts',
    'packages/api/src/routes/v2/__tests__/keys-mint-ceiling.test.ts',
  ].map((file) => ({ file, cite: 'wish omni-appkit-gap', reason: MISSING })),
  { file: 'packages/cli/src/pm2.ts', cite: 'wish omni-install-resilience', reason: MISSING },
  { file: 'packages/cli/src/commands/install.ts', cite: 'wish omni-install-resilience', reason: MISSING },
  { file: 'packages/cli/src/pm2.ts', cite: 'wish pm2-log-noise-and-bumps', reason: MISSING },
  { file: 'packages/api/src/services/media-storage.ts', cite: 'RFC-4122', reason: IETF },
  { file: 'packages/db/src/backfill/person-clone.ts', cite: 'RFC-4122', reason: IETF },
  { file: 'packages/cli/src/update-diagnostics.ts', cite: 'wish per-repo', reason: NOT_A_WISH },
  { file: 'packages/db/src/tenancy-dual-write.ts', cite: 'wish mixed-version', reason: NOT_A_WISH },
  { file: 'packages/db/src/tenancy-ownership.test.ts', cite: 'wish 185-190', reason: NOT_A_WISH },
  { file: 'packages/db/src/tenancy-db-access-guard.test.ts', cite: 'wish operator-surface', reason: NOT_A_WISH },
];

export interface IndexRow {
  key: string;
  linkedFile?: string;
  status: string;
  line: number;
}

export interface Citation {
  file: string;
  line: number;
  cite: string;
}

const KEY_CELL = /^(?:\[(RFC-\d{4})\]\(([^)]+)\)|(RFC-\d{4})|(ADR-[A-Z]+-\d{4})|(ADR-\d{4})|—)$/;

/** Rows of every index table (a table whose header starts `| # | Title | Status |`). */
export function parseIndex(text: string): { rows: IndexRow[]; errors: string[] } {
  const rows: IndexRow[] = [];
  const errors: string[] = [];
  let inTable = false;
  for (const [i, raw] of text.split('\n').entries()) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      inTable = false;
      continue;
    }
    const cells = line
      .slice(1, line.endsWith('|') ? -1 : undefined)
      .split('|')
      .map((cell) => cell.trim());
    if (cells[0] === '#' && cells[1] === 'Title' && cells[2] === 'Status') {
      inTable = true;
      continue;
    }
    if (!inTable || /^:?-+:?$/.test(cells[0] ?? '')) continue;
    const at = `${INDEX_PATH}:${i + 1}`;
    const match = KEY_CELL.exec(cells[0] ?? '');
    if (!match) {
      errors.push(`${at}: # cell "${cells[0]}" is not [RFC-NNNN](NNNN-name.md), RFC-NNNN, ADR-NNNN or —`);
      continue;
    }
    const status = cells[2] ?? '';
    if (!(STATUSES as readonly string[]).includes(status)) {
      errors.push(
        `${at}: status "${status}" is not one of ${STATUSES.join(', ')} (one word; progress goes in the RFC)`,
      );
    }
    const key = match[1] ?? match[3] ?? match[4] ?? match[5] ?? '—';
    rows.push({ key, linkedFile: match[2], status, line: i + 1 });
  }
  return { rows, errors };
}

/** Index rows against docs/rfcs/NNNN-*.md files. */
export function checkIndex(rows: IndexRow[], trackedFiles: string[]): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (row.key === '—') continue;
    const first = seen.get(row.key);
    if (first !== undefined) {
      errors.push(
        `${INDEX_PATH}:${row.line}: ${row.key} is already used on line ${first}; whoever merges second renumbers`,
      );
    } else seen.set(row.key, row.line);
  }

  const files = new Map<string, string>();
  for (const file of trackedFiles) {
    const match = RFC_FILE.exec(file);
    if (!match?.[1] || match[1] === TEMPLATE_NUMBER) continue;
    const other = files.get(match[1]);
    if (other) errors.push(`${file}: RFC-${match[1]} is also ${other}; whoever merges second renumbers`);
    else files.set(match[1], file);
  }

  const linked = new Set<string>();
  for (const row of rows) {
    if (!row.key.startsWith('RFC-')) continue;
    const number = row.key.slice(4);
    const at = `${INDEX_PATH}:${row.line}`;
    if (!row.linkedFile) {
      if (row.status !== 'Draft')
        errors.push(`${at}: ${row.key} has no file, so it is a reserved number and must be Draft`);
      if (files.has(number))
        errors.push(`${at}: ${row.key} has a file (${files.get(number)}); link it from the # cell`);
      continue;
    }
    const path = `docs/rfcs/${row.linkedFile}`;
    const match = RFC_FILE.exec(path);
    if (match?.[1] !== number) {
      errors.push(`${at}: ${row.key} links ${row.linkedFile}; the file must be named ${number}-short-name.md`);
    } else if (!trackedFiles.includes(path)) {
      errors.push(`${at}: ${row.key} links ${row.linkedFile}, which is not a tracked file`);
    }
    linked.add(number);
  }
  for (const [number, file] of files) {
    if (!linked.has(number)) errors.push(`${file}: no index row in ${INDEX_PATH} links it`);
  }
  return errors;
}

const RFC_CITE = /\bRFC-(\d{4})\b/g;
const ADR_CITE = /\bADR-(\d{4})\b/g;
const GENIE_CITE = /\.genie\/(?:wishes|brainstorms)\/[A-Za-z0-9_.\-/]*/g;
const WISH_CITE = /\b(?:[Ww]ish|WISH):?\s+`?([a-z0-9]+(?:-[a-z0-9]+)+)/g;

/** Every citation in one file's text. Genie paths lose trailing dots; empty slugs are skipped. */
export function findCitations(file: string, text: string): Citation[] {
  const found: Citation[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    const add = (cite: string) => found.push({ file, line: i + 1, cite });
    for (const m of line.matchAll(RFC_CITE)) add(`RFC-${m[1]}`);
    for (const m of line.matchAll(ADR_CITE)) add(`ADR-${m[1]}`);
    for (const m of line.matchAll(GENIE_CITE)) {
      const path = m[0].replace(/\.+$/, '');
      if (!/^\.genie\/(?:wishes|brainstorms)\/$/.test(path)) add(path);
    }
    for (const m of line.matchAll(WISH_CITE)) add(`wish ${m[1]}`);
  }
  return found;
}

function genieTracked(path: string, trackedFiles: string[]): boolean {
  const dir = path.endsWith('/') ? path : `${path}/`;
  return trackedFiles.some((file) => file === path || file.startsWith(dir));
}

/** Citations that do not resolve, after the allowlist; plus allowlist entries that matched nothing. */
export function checkCitations(
  citations: Citation[],
  rows: IndexRow[],
  trackedFiles: string[],
  allowlist: AllowEntry[] = ALLOWLIST,
): string[] {
  const errors: string[] = [];
  const keys = new Set(rows.map((row) => row.key));
  const used = new Set<AllowEntry>();
  for (const citation of citations) {
    const { cite } = citation;
    let resolved: boolean;
    let hint: string;
    if (cite.startsWith('RFC-') || cite.startsWith('ADR-')) {
      resolved = keys.has(cite);
      hint = `${cite} is not a row of ${INDEX_PATH}`;
    } else if (cite.startsWith('wish ')) {
      const slug = cite.slice(5);
      resolved =
        genieTracked(`.genie/wishes/${slug}/`, trackedFiles) ||
        genieTracked(`.genie/brainstorms/${slug}/`, trackedFiles);
      hint = `no tracked .genie/wishes/${slug}/ or .genie/brainstorms/${slug}/; track the design or cite its RFC`;
    } else {
      resolved = genieTracked(cite, trackedFiles);
      hint = `${cite} is not tracked; track the design or cite its RFC`;
    }
    if (resolved) continue;
    const entry = allowlist.find((e) => e.cite === cite && (e.file === '*' || e.file === citation.file));
    if (entry) {
      used.add(entry);
      continue;
    }
    errors.push(`${citation.file}:${citation.line}: ${hint}`);
  }
  for (const entry of allowlist) {
    if (!used.has(entry)) {
      errors.push(
        `scripts/verify-rfcs.ts ALLOWLIST: "${entry.cite}" in ${entry.file} no longer dangles; remove the entry`,
      );
    }
  }
  return errors;
}

function git(root: string, args: string[]): string {
  const result = Bun.spawnSync(['git', '-C', root, ...args], { stdout: 'pipe', stderr: 'pipe' });
  // git grep exits 1 when nothing matches.
  if (result.exitCode !== 0 && !(args[0] === 'grep' && result.exitCode === 1)) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

export function verifyRfcs(root: string, allowlist: AllowEntry[] = ALLOWLIST): string[] {
  const trackedFiles = git(root, ['ls-files', '-z']).split('\0').filter(Boolean);
  if (!trackedFiles.includes(INDEX_PATH)) return [`${INDEX_PATH} is missing`];
  const { rows, errors } = parseIndex(readFileSync(join(root, INDEX_PATH), 'utf8'));
  errors.push(...checkIndex(rows, trackedFiles));

  const candidates = git(root, ['grep', '-l', '-z', '-I', '-i', '-E', 'rfc-|adr-|\\.genie/|wish', '--', ...SCAN_ROOTS])
    .split('\0')
    .filter((file) => file && !SCAN_EXCLUDE.has(file));
  const citations = candidates.flatMap((file) => findCitations(file, readFileSync(join(root, file), 'utf8')));
  errors.push(...checkCitations(citations, rows, trackedFiles, allowlist));
  return errors;
}

function main(): void {
  const flag = process.argv.indexOf('--root');
  const root = flag >= 0 && process.argv[flag + 1] ? process.argv[flag + 1] : repoRoot;
  const errors = verifyRfcs(root);
  if (errors.length > 0) {
    console.error(`RFC index gate: ${errors.length} problem(s)`);
    for (const error of errors) console.error(`  ${error}`);
    console.error(`See ${INDEX_PATH} for the process.`);
    process.exit(1);
  }
  console.log('RFC index gate: index, files and citations agree.');
}

if (import.meta.main) main();
