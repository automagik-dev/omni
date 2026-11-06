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
 * 2. Every `RFC-NNNN` cited in apps/ packages/ scripts/ docs/ is a row of the index, whatever its
 *    number. IETF standards are written with a space ("RFC 4122"), which is not a citation.
 * 3. Every `ADR-NNNN` or named `ADR-XXX-NNNN` cited there is a row of the index (keys are frozen).
 * 4. Every planning path and every wish slug cited there resolves to a file git tracks. A path is
 *    `.genie/wishes/...` or `.genie/brainstorms/...`, or the same without `.genie/` when it starts
 *    a word (`wishes/<slug>/WISH.md`). A wish slug follows Wish, wish or WISH as `<slug>`,
 *    `: <slug>`, `` `<slug>` `` or `**<slug>**` (also `*`, `_`, `__`). A one-word slug counts only
 *    with the colon, backticks or emphasis, so prose such as "the wish requires" is not a citation.
 *
 * Citations already dangling when the gate landed sit in ALLOWLIST with their count per file.
 * One more in that file, or the same citation in another file, fails; fewer fails too until the
 * count is lowered, so the list only shrinks.
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
  /** Repo-relative file. */
  file: string;
  /** The citation as reported: `.genie/wishes/<path>` or `wish <slug>`. */
  cite: string;
  /** How many times the file cites it today. */
  count: number;
  reason: string;
}

/** IETF standard numbers the code cites (written "RFC 4122"); the index never uses them. */
export const IETF_RFC_NUMBERS = new Set(['4122']);

function allow(cite: string, reason: string, counts: Record<string, number>): AllowEntry[] {
  return Object.entries(counts).map(([file, count]) => ({ file, cite, count, reason }));
}

const CHAT_THREADS = 'omni-chat-threads design: rebuilt as RFC-0001 (reserved), then this entry goes';
const NOT_A_WISH = 'prose, not a wish slug';
const MISSING = 'design was never committed';

/** Dangling citations that predate this gate, with their count per file. Lower or remove as designs land. */
export const ALLOWLIST: AllowEntry[] = [
  ...allow('wish omni-chat-threads', CHAT_THREADS, {
    'apps/omni-channels-dsh/src/host/asks.js': 1,
    'apps/omni-channels-dsh/src/host/standing-recovery.js': 1,
    'apps/omni-channels-dsh/src/host/standing-runs.js': 1,
    'apps/omni-channels-dsh/src/host/thread-tools.js': 1,
    'apps/omni-channels-dsh/test/dshbot-migration.test.js': 1,
    'apps/omni-channels-dsh/test/omni-api.test.js': 2,
    'apps/omni-channels-dsh/test/omni-link.test.js': 1,
    'apps/omni-channels-dsh/test/team-view.test.js': 1,
    'apps/omni-channels-dsh/test/thread-fixture.js': 1,
    'apps/omni-channels-dsh/test/thread-keys.test.js': 1,
    'apps/omni-channels-dsh/test/thread-tools.test.js': 1,
    'apps/omni-channels-dsh/test/threads.test.js': 1,
    'packages/api/src/__tests__/openapi-route-coverage.test.ts': 1,
    'packages/api/src/constants/__tests__/scope-map-coverage.test.ts': 1,
    'packages/api/src/constants/scopes.ts': 1,
    'packages/api/src/routes/v2/__tests__/keys-device-child.test.ts': 1,
    'packages/api/src/routes/v2/__tests__/keys-mint-ceiling.test.ts': 1,
    'packages/api/src/routes/v2/keys.ts': 1,
    'packages/api/src/schemas/openapi/keys.ts': 1,
    'packages/api/src/services/__tests__/api-key-children-postgres.test.ts': 1,
    'packages/api/src/services/api-keys.ts': 1,
    'packages/api/src/tenancy/__tests__/route-ownership-gate.test.ts': 1,
    'packages/api/src/tenancy/route-ownership.ts': 1,
    'packages/db/drizzle/0088_api_key_parent.sql': 1,
    'packages/db/src/schema.ts': 1,
  }),
  ...allow('.genie/wishes/idle-chat-follow-up/WISH.md', MISSING, {
    'docs/guides/idle-chat-follow-up.md': 1,
    'packages/api/src/scheduler.ts': 1,
  }),
  ...allow('wish omni-host-fingerprint-trust', MISSING, {
    'packages/api/src/__tests__/host-fingerprint-pipeline.test.ts': 1,
    'packages/api/src/middleware/__tests__/genie-signature.test.ts': 1,
    'packages/api/src/middleware/__tests__/require-signed-instance.test.ts': 1,
    'packages/api/src/middleware/__tests__/scope-enforcer-host-scopes.test.ts': 1,
    'packages/api/src/middleware/genie-signature.ts': 1,
    'packages/api/src/middleware/require-signed-instance.ts': 1,
    'packages/api/src/routes/v2/trust.ts': 1,
    'packages/cli/src/__tests__/signing.test.ts': 1,
    'packages/cli/src/commands/trust.ts': 1,
    'packages/cli/src/signing.ts': 1,
  }),
  ...allow('.genie/wishes/whatsapp-business-channel/WISH.md', MISSING, {
    'packages/api/src/lib/__tests__/sentry-scrub-whatsapp-business-audit.test.ts': 1,
  }),
  ...allow('wish omni-appkit-gap', MISSING, {
    'packages/api/src/routes/v2/__tests__/console-profile-scope-coverage.test.ts': 1,
    'packages/api/src/routes/v2/__tests__/keys-console-profiles.test.ts': 1,
    'packages/api/src/routes/v2/__tests__/keys-mint-ceiling.test.ts': 1,
  }),
  ...allow('.genie/wishes/pgserve-singleton-no-proxy/', MISSING, {
    'packages/cli/src/__tests__/pgserve-transport.test.ts': 1,
    'packages/cli/src/__tests__/requirements.test.ts': 1,
  }),
  ...allow('wish omni-install-resilience', MISSING, {
    'packages/cli/src/commands/install.ts': 1,
    'packages/cli/src/pm2.ts': 1,
  }),
  ...allow('.genie/wishes/update-unify-stages/SHARED-DESIGN.md', MISSING, {
    'packages/cli/src/commands/update.ts': 1,
  }),
  ...allow('.genie/wishes/pgserve-singleton-no-proxy/SHARED-DESIGN.md', MISSING, {
    'packages/cli/src/lib/pgserve-transport.ts': 1,
    'packages/cli/src/runtime-env.ts': 1,
  }),
  ...allow('wish pm2-log-noise-and-bumps', MISSING, {
    'packages/cli/src/pm2.ts': 1,
  }),
  ...allow('wish per-repo', NOT_A_WISH, {
    'packages/cli/src/update-diagnostics.ts': 1,
  }),
  ...allow('.genie/wishes/559-close-contact/design.md', MISSING, {
    'packages/db/drizzle/0033_close_contact_logs.sql': 1,
  }),
  ...allow('wish connectors-first-slice-clickup', MISSING, {
    'packages/db/drizzle/0089_connectors.sql': 1,
    'packages/db/drizzle/0090_connector_event_ownership.sql': 1,
    'packages/db/src/tenancy-db-access-guard.ts': 1,
    'packages/db/src/tenancy-ownership.ts': 1,
  }),
  ...allow('wish operator-surface', NOT_A_WISH, {
    'packages/db/src/tenancy-db-access-guard.test.ts': 1,
  }),
  ...allow('wish mixed-version', NOT_A_WISH, {
    'packages/db/src/tenancy-dual-write.ts': 1,
  }),
  ...allow('wish 185-190', NOT_A_WISH, {
    'packages/db/src/tenancy-ownership.test.ts': 1,
  }),
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
    if (IETF_RFC_NUMBERS.has(row.key.slice(4))) {
      errors.push(`${INDEX_PATH}:${row.line}: ${row.key} is an IETF standard number; take the next free number`);
    }
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
const ADR_CITE = /\bADR-((?:[A-Z]+-)?\d{4})\b/g;
const GENIE_CITE = /\.genie\/(?:wishes|brainstorms)\/[A-Za-z0-9_.\-/]*/g;
/** `wishes/<slug>/...` without `.genie/`, at the start of a word (not `brain/wishes/...`). */
const SHORT_GENIE_CITE = /(?<![A-Za-z0-9_./-])(?:wishes|brainstorms)\/[a-z0-9][A-Za-z0-9_.\-/]*/g;
const WISH_CITE =
  /\b(?:[Ww]ish|WISH)(?::?\s+`?([a-z0-9]+(?:-[a-z0-9]+)+)|:\s+`?([a-z0-9]+)(?![a-z0-9-])|\s+`([a-z0-9]+)`|:?\s+(\*{1,2}|_{1,2})([a-z0-9]+(?:-[a-z0-9]+)*)\4)/g;

/** Every citation in one file's text. Genie paths lose trailing dots; empty slugs are skipped. */
export function findCitations(file: string, text: string): Citation[] {
  const found: Citation[] = [];
  for (const [i, line] of text.split('\n').entries()) {
    const add = (cite: string) => found.push({ file, line: i + 1, cite });
    for (const m of line.matchAll(RFC_CITE)) add(m[0]);
    for (const m of line.matchAll(ADR_CITE)) add(`ADR-${m[1]}`);
    for (const m of line.matchAll(GENIE_CITE)) {
      const path = m[0].replace(/\.+$/, '');
      if (!/^\.genie\/(?:wishes|brainstorms)\/$/.test(path)) add(path);
    }
    for (const m of line.matchAll(SHORT_GENIE_CITE)) add(`.genie/${m[0].replace(/\.+$/, '')}`);
    for (const m of line.matchAll(WISH_CITE)) add(`wish ${m[1] ?? m[2] ?? m[3] ?? m[5]}`);
  }
  return found;
}

function genieTracked(path: string, trackedFiles: string[]): boolean {
  const dir = path.endsWith('/') ? path : `${path}/`;
  return trackedFiles.some((file) => file === path || file.startsWith(dir));
}

function resolves(cite: string, keys: Set<string>, trackedFiles: string[]): string | undefined {
  if (cite.startsWith('RFC-') || cite.startsWith('ADR-')) {
    return keys.has(cite) ? undefined : `${cite} is not a row of ${INDEX_PATH}`;
  }
  if (cite.startsWith('wish ')) {
    const slug = cite.slice(5);
    const found =
      genieTracked(`.genie/wishes/${slug}/`, trackedFiles) || genieTracked(`.genie/brainstorms/${slug}/`, trackedFiles);
    return found
      ? undefined
      : `no tracked .genie/wishes/${slug}/ or .genie/brainstorms/${slug}/; track the design or cite its RFC`;
  }
  return genieTracked(cite, trackedFiles) ? undefined : `${cite} is not tracked; track the design or cite its RFC`;
}

/**
 * Citations that do not resolve, after the allowlist. An allowlisted (file, citation) pair passes
 * only while the file holds exactly the allowlisted count; entries that match nothing fail.
 */
export function checkCitations(
  citations: Citation[],
  rows: IndexRow[],
  trackedFiles: string[],
  allowlist: AllowEntry[] = ALLOWLIST,
): string[] {
  const errors: string[] = [];
  const keys = new Set(rows.map((row) => row.key));
  const dangling = new Map<string, { citations: Citation[]; hint: string }>();
  for (const citation of citations) {
    const hint = resolves(citation.cite, keys, trackedFiles);
    if (!hint) continue;
    const pair = `${citation.file}\0${citation.cite}`;
    const group = dangling.get(pair) ?? { citations: [], hint };
    group.citations.push(citation);
    dangling.set(pair, group);
  }
  const entries = new Map(allowlist.map((entry) => [`${entry.file}\0${entry.cite}`, entry]));
  for (const [pair, { citations: found, hint }] of dangling) {
    const entry = entries.get(pair);
    entries.delete(pair);
    if (entry && found.length === entry.count) continue;
    if (entry && found.length < entry.count) {
      errors.push(
        `scripts/verify-rfcs.ts ALLOWLIST: "${entry.cite}" in ${entry.file} is cited ${found.length} time(s), not ${entry.count}; lower the count`,
      );
      continue;
    }
    const note = entry ? ` (the allowlist covers ${entry.count} existing citation(s) here; one is new)` : '';
    for (const citation of found) errors.push(`${citation.file}:${citation.line}: ${hint}${note}`);
  }
  for (const entry of entries.values()) {
    errors.push(
      `scripts/verify-rfcs.ts ALLOWLIST: "${entry.cite}" in ${entry.file} no longer dangles; remove the entry`,
    );
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

  const candidates = git(root, [
    'grep',
    '-l',
    '-z',
    '-I',
    '-i',
    '-E',
    'rfc-|adr-|\\.genie/|wish|brainstorm',
    '--',
    ...SCAN_ROOTS,
  ])
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
