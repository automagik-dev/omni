/**
 * Static companion to pg-gate's runtime zero-skip check. Discovery and opt-ins
 * come from the gate itself; importing it must not acquire a server. This scans
 * tracked tests across the repository, and tracked text (except .genie/) for
 * retired opt-ins. Needles are constructed so this guard needs no self-exclusion.
 */
import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import {
  POSTGRES_SUITE_ROOTS,
  POSTGRES_SUITE_SUFFIX,
  POSTGRES_URL_VARS,
  PSQL_BIN_VARS,
  findPostgresSuites,
} from './pg-gate';

const root = resolve(import.meta.dir, '..');
const deadNames = [['ENABLE', 'DB', 'TESTS'].join('_'), ['TEST', 'DATABASE', 'URL'].join('_')];
const supplied = new Set<string>([...POSTGRES_URL_VARS, ...PSQL_BIN_VARS, 'OMNI_PG_TEST_TARGET', 'LOG_LEVEL']);
const testSuffix = /[.-](?:test|spec)\.[cm]?[jt]sx?$/;
/** The PostgreSQL test harness, by package subpath or relative path; importing it is a PG opt-in. */
const harnessModule = /(^|\/)(pg-testing|pg-migrated-template)(\.[cm]?[jt]s)?$/;

/**
 * Non-postgres tests that import the harness without a database, one reason
 * each. The importers found must equal this list exactly.
 */
const harnessUnitTests: ReadonlyMap<string, string> = new Map([
  [
    'packages/db/src/pg-test-role.test.ts',
    'unit tests of assertPgTestTarget, pgRoleUrl and the load-time URL refusal; psql is never run',
  ],
]);

/** pg-gate's own discovery, over its own roots. */
function discoverSuites(): Set<string> {
  return new Set(POSTGRES_SUITE_ROOTS.flatMap((directory) => findPostgresSuites(join(root, directory))));
}

/** A no-lib, no-import-resolution program supplies lexical bindings, not regex aliases. */
function analyze(
  files: Map<string, string>,
): Map<string, { reads: Set<string>; gates: Set<string>; database: boolean; harness: boolean }> {
  const sources = new Map(
    [...files].map(([file, text]) => [file, ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)]),
  );
  const host = ts.createCompilerHost({});
  host.getSourceFile = (file) => sources.get(file);
  const program = ts.createProgram([...files.keys()], { noLib: true, noResolve: true, allowJs: true }, host);
  const checker = program.getTypeChecker();

  function unwrap(node: ts.Node): ts.Node {
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression(node)
    )
      return unwrap(node.expression);
    return node;
  }

  function binding(node: ts.Node): ts.Symbol | undefined {
    if (!ts.isIdentifier(node)) return undefined;
    const parent = node.parent;
    // Property names are not lexical bindings; asking the checker to resolve
    // them would type-check arbitrary unresolved imports in this no-lib program.
    if (
      parent &&
      (ts.isImportSpecifier(parent) ||
        ts.isExportSpecifier(parent) ||
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isMethodDeclaration(parent) && parent.name === node) ||
        (ts.isBindingElement(parent) && parent.propertyName === node))
    )
      return undefined;
    if (parent && ts.isShorthandPropertyAssignment(parent)) return checker.getShorthandAssignmentValueSymbol(parent);
    return checker.getSymbolAtLocation(node);
  }

  function string(expression: ts.Node | undefined, seen = new Set<ts.Symbol>()): string | undefined {
    if (!expression) return undefined;
    const node = unwrap(expression);
    if (ts.isStringLiteralLike(node)) return node.text;
    const symbol = binding(node);
    if (!symbol || seen.has(symbol)) return undefined;
    const declaration = symbol.valueDeclaration;
    return declaration && ts.isVariableDeclaration(declaration)
      ? string(declaration.initializer, new Set([...seen, symbol]))
      : undefined;
  }

  function path(expression: ts.Node, seen = new Set<ts.Symbol>()): string[] | undefined {
    const node = unwrap(expression);
    if (ts.isPropertyAccessExpression(node)) {
      const base = path(node.expression, seen);
      return base && [...base, node.name.text];
    }
    if (ts.isElementAccessExpression(node)) {
      const base = path(node.expression, seen);
      const key = string(node.argumentExpression);
      return base && key !== undefined ? [...base, key] : undefined;
    }
    if (!ts.isIdentifier(node)) return undefined;
    const symbol = binding(node);
    if (!symbol) return node.text === 'process' || node.text === 'Bun' ? [node.text] : undefined;
    if (seen.has(symbol)) return undefined;
    const next = new Set([...seen, symbol]);
    const declaration = symbol.valueDeclaration;
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
      return path(declaration.initializer, next);
    if (declaration && ts.isBindingElement(declaration) && ts.isObjectBindingPattern(declaration.parent)) {
      const owner = declaration.parent.parent;
      if (!ts.isVariableDeclaration(owner) || !owner.initializer) return undefined;
      const base = path(owner.initializer, next);
      const key = declaration.propertyName ?? declaration.name;
      const name = ts.isIdentifier(key) ? key.text : string(key);
      return base && name !== undefined ? [...base, name] : undefined;
    }
    return undefined;
  }

  function envName(node: ts.Node): string | undefined {
    const parts = path(node);
    if (parts?.[0] === 'process' && parts[1] === 'env') return parts[2];
    if (parts?.[0] === 'Bun' && parts[1] === 'env') return parts[2];
    return undefined;
  }

  function dependencies(node: ts.Node, seen = new Set<ts.Symbol>()): Set<string> {
    const result = new Set<string>();
    const name = envName(node);
    if (name) result.add(name);
    if (ts.isIdentifier(node)) {
      const symbol = binding(node);
      if (symbol && !seen.has(symbol)) {
        const next = new Set([...seen, symbol]);
        const declaration = symbol.valueDeclaration;
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
          for (const value of dependencies(declaration.initializer, next)) result.add(value);
        }
      }
    }
    ts.forEachChild(node, (child) => {
      for (const value of dependencies(child, seen)) result.add(value);
    });
    return result;
  }

  function contains(node: ts.Node, predicate: (node: ts.Node) => boolean): boolean {
    if (predicate(node)) return true;
    // An inner callback's returns do not skip the enclosing setup/test.
    if (ts.isFunctionLike(node)) return false;
    return ts.forEachChild(node, (child) => contains(child, predicate) || undefined) ?? false;
  }

  function skip(node: ts.Node): boolean {
    return ts.isPropertyAccessExpression(node) && ['skip', 'skipIf', 'todo'].includes(node.name.text);
  }

  function registration(node: ts.Node): boolean {
    if (!ts.isCallExpression(node)) return false;
    const expression = node.expression;
    return /^(describe|test|it)$/.test(expression.getText()) || contains(expression, skip);
  }

  return new Map(
    [...sources].map(([file, source]) => {
      const reads = new Set<string>();
      const gates = new Set<string>();
      let database = false;
      let harness = false;
      const addGate = (expression: ts.Node) => {
        for (const name of dependencies(expression)) gates.add(name);
      };
      function visit(node: ts.Node): void {
        const name = envName(node);
        const parent = node.parent;
        const write =
          (parent &&
            ts.isBinaryExpression(parent) &&
            parent.left === node &&
            parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
          (parent && ts.isDeleteExpression(parent));
        if (name && !write) reads.add(name);
        if (ts.isConditionalExpression(node) && (contains(node.whenTrue, skip) || contains(node.whenFalse, skip)))
          addGate(node.condition);
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
          if (['skipIf', 'runIf'].includes(node.expression.name.text)) {
            for (const argument of node.arguments) addGate(argument);
          }
        }
        if (ts.isIfStatement(node)) {
          const exits = (branch: ts.Node) =>
            contains(branch, (child) => ts.isReturnStatement(child) || registration(child));
          if (exits(node.thenStatement) || (node.elseStatement && exits(node.elseStatement))) addGate(node.expression);
        }
        if (
          ts.isBinaryExpression(node) &&
          [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind) &&
          contains(node.right, registration)
        )
          addGate(node.left);
        if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
          // DATABASE_URL reads that only save/restore process state are unit tests,
          // unlike passing it into a PostgreSQL client or database setup helper.
          if (
            /\b(postgres|Pool|Client|connect|createDb|createDatabase|open\w*Connection|provision\w*)$/.test(
              node.expression.getText(),
            )
          ) {
            for (const argument of node.arguments ?? []) {
              if (dependencies(argument).has('DATABASE_URL')) database = true;
            }
          }
        }
        // Static imports, re-exports and dynamic import() of the harness.
        const specifier =
          (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier
            ? string(node.moduleSpecifier)
            : ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
              ? string(node.arguments[0])
              : undefined;
        if (specifier !== undefined && harnessModule.test(specifier)) harness = true;
        ts.forEachChild(node, visit);
      }
      visit(source);
      return [file, { reads, gates, database, harness }];
    }),
  );
}

function violations(files: Map<string, string>, discovered: Set<string>): string[] {
  const errors: string[] = [];
  for (const [file, result] of analyze(files)) {
    const postgres = POSTGRES_SUITE_SUFFIX.test(file);
    const harness = result.harness && !harnessUnitTests.has(file);
    if (
      !postgres &&
      ([...result.reads].some((name) => /^OMNI_G\d+_POSTGRES_URL$/.test(name)) || result.database || harness)
    )
      errors.push(`${file}: PostgreSQL opt-in test must be named *-postgres.test.ts`);
    if (!postgres) continue;
    if (!discovered.has(file)) errors.push(`${file}: outside pg-gate discovery`);
    for (const name of result.gates) {
      if (!supplied.has(name)) errors.push(`${file}: gate depends on ${name}, which pg-gate does not set`);
    }
  }
  return errors.sort();
}

function deadViolations(files: Map<string, string>): string[] {
  return [...files].flatMap(([file, text]) =>
    file.startsWith('.genie/')
      ? []
      : deadNames
          .filter((name) => text.toLowerCase().includes(name.toLowerCase()))
          .map((name) => `${file}: retired ${name}`),
  );
}

/** Non-postgres tests that import the harness, sorted. */
function harnessImporters(tests: Map<string, string>): string[] {
  const candidates = new Map(
    [...tests].filter(
      ([file, text]) => !POSTGRES_SUITE_SUFFIX.test(file) && /pg-testing|pg-migrated-template/.test(text),
    ),
  );
  return [...analyze(candidates)]
    .filter(([, result]) => result.harness)
    .map(([file]) => file)
    .sort();
}

/**
 * Raw DROP DATABASE rule. Scope: discovered *-postgres.test.ts suites, tracked
 * non-test TypeScript under __tests__/ or tests/ (fixtures), the drop helper
 * module and the provisioning harness. Every DROP DATABASE literal is a site
 * unless an exemption below names it; each exemption is bound to its file and
 * enclosing function (and a catch clause where it says so) and covers exactly
 * one literal. The remaining sites run the statement themselves and throw on
 * failure; they must equal checkedExitDrops, one entry per site.
 */
const dropHelperModule = 'packages/db/src/backfill/pg-testing.ts';
const templateModule = 'packages/db/src/pg-migrated-template.ts';
const dropStatement = /\bDROP\s+DATABASE\b/i;

interface DropExemption {
  readonly file: string;
  readonly fn: string;
  readonly inCatch: boolean;
  readonly reason: string;
}

const dropExemptions: readonly DropExemption[] = [
  {
    file: dropHelperModule,
    fn: 'dropDatabaseOrThrow',
    inCatch: false,
    reason: 'the helper every suite drop goes through; throws on a non-zero psql exit',
  },
  {
    file: templateModule,
    fn: 'ensureSqlTemplate',
    inCatch: true,
    reason: 'best-effort staging cleanup in a catch that rethrows the original replay error',
  },
];

const exitChecked = 'spawnSync exit status checked; throws stderr';
const checkedExitDrops: readonly (readonly [file: string, reason: string])[] = [
  ['packages/api/src/__tests__/connector-hooks-postgres.test.ts', exitChecked],
  ['packages/api/src/__tests__/event-consumers-tenant-enforced-postgres.test.ts', exitChecked],
  ['packages/api/src/__tests__/journal-consumer-source-postgres.test.ts', exitChecked],
  ['packages/api/src/__tests__/paired-agent-consumers-postgres.test.ts', exitChecked],
  ['packages/api/src/__tests__/paired-agent-grants-postgres.test.ts', exitChecked],
  ['packages/api/src/__tests__/paired-agent-rollback-postgres.test.ts', exitChecked],
  ['packages/api/src/__tests__/provenance-stamp-postgres.test.ts', exitChecked],
  ['packages/api/src/__tests__/webhook-event-ownership-postgres.test.ts', exitChecked],
  ['packages/api/src/__tests__/webhook-tenant-ingress-postgres.test.ts', exitChecked],
  ['packages/api/src/plugins/__tests__/agent-dispatcher-active-target-postgres.test.ts', exitChecked],
  ['packages/api/src/routes/v2/__tests__/instances-agent-key-postgres.test.ts', exitChecked],
  ['packages/api/src/routes/v2/__tests__/routes-agent-key-postgres.test.ts', exitChecked],
  ['packages/api/src/services/__tests__/agent-activation-postgres.test.ts', exitChecked],
  ['packages/api/src/services/__tests__/agent-key-lifecycle-postgres.test.ts', exitChecked],
  ['packages/api/src/services/__tests__/agent-key-reconciliation-postgres.test.ts', exitChecked],
  ['packages/api/src/services/__tests__/platform-bootstrap-postgres.test.ts', 'awaited db.execute rejects on error'],
  ['packages/db/src/paired-agent-schema-postgres.test.ts', 'fixtureSql throws on a non-zero psql exit'],
  [templateModule, 'ensureSqlTemplate staging reset runs through runSqlOrThrow'],
];

function dropScope(files: Map<string, string>, discovered: Set<string>): Map<string, string> {
  const support = (file: string) =>
    /\.[cm]?tsx?$/.test(file) && !testSuffix.test(file) && /(^|\/)(__tests__|tests)\//.test(file);
  return new Map(
    [...files].filter(
      ([file]) => discovered.has(file) || file === dropHelperModule || file === templateModule || support(file),
    ),
  );
}

interface DropSite {
  readonly file: string;
  readonly line: number;
}

/** Every DROP DATABASE literal in `files`, split into unexempted sites and exempted ones, sorted by file and line. */
function rawDrops(
  files: Map<string, string>,
  exemptions: readonly DropExemption[] = dropExemptions,
): { found: DropSite[]; exempt: DropSite[] } {
  const found: DropSite[] = [];
  const exempt: DropSite[] = [];
  for (const [file, text] of files) {
    if (!dropStatement.test(text)) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const unused = new Set(exemptions.filter((exemption) => exemption.file === file));
    // `fn` is the nearest enclosing function declaration; any function boundary leaves a catch.
    const visit = (node: ts.Node, outerFn: string | undefined, outerCatch: boolean): void => {
      const fn = ts.isFunctionDeclaration(node) ? node.name?.text : outerFn;
      const inCatch = ts.isCatchClause(node) || (outerCatch && !ts.isFunctionLike(node));
      if ((ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) && dropStatement.test(node.getText(source))) {
        const site = { file, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
        const exemption = [...unused].find((candidate) => candidate.fn === fn && candidate.inCatch === inCatch);
        if (exemption) unused.delete(exemption);
        (exemption ? exempt : found).push(site);
        return;
      }
      ts.forEachChild(node, (child) => visit(child, fn, inCatch));
    };
    visit(source, undefined, false);
  }
  const order = (a: DropSite, b: DropSite) => a.file.localeCompare(b.file) || a.line - b.line;
  return { found: found.sort(order), exempt: exempt.sort(order) };
}

function trackedFiles(): Map<string, string> {
  const paths = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  return new Map(paths.map((file) => [file, readFileSync(join(root, file), 'utf8')]));
}

test('tracked PostgreSQL tests are discoverable and use only pg-gate opt-ins', () => {
  const all = trackedFiles();
  const tests = new Map([...all].filter(([file]) => testSuffix.test(file)));
  const discovered = discoverSuites();
  const pgAnalysis = analyze(new Map([...tests].filter(([file]) => discovered.has(file))));
  const optInsRead = [...pgAnalysis.values()].flatMap(({ reads }) => [...reads]).filter((name) => supplied.has(name));
  expect(optInsRead.length).toBeGreaterThan(0);
  expect(discovered.size).toBeGreaterThan(60);
  expect(POSTGRES_URL_VARS.length).toBeGreaterThan(0);
  for (const file of discovered) expect(tests.has(file)).toBe(true);
  expect(violations(tests, discovered)).toEqual([]);
  expect(harnessImporters(tests)).toEqual([...harnessUnitTests.keys()].sort());
}, 30_000);

test('a non-postgres test importing the harness is a PG opt-in: static, re-export or dynamic', () => {
  const file = 'packages/foo.test.ts';
  for (const source of [
    "import { dropDatabaseOrThrow } from '@omni/db/pg-testing';",
    "import { pgRoleUrl } from '@omni/db/pg-migrated-template';",
    "import { runSqlOn } from './backfill/pg-testing';",
    "import type { PgSuperAccess } from '../../packages/db/src/pg-migrated-template';",
    "export { pgRoleUrl } from './pg-migrated-template';",
    "export * from '@omni/db/pg-testing';",
    "const harness = await import('@omni/db/pg-testing');",
    "const target = '@omni/db/pg-migrated-template'; const harness = await import(target);",
  ]) {
    expect(violations(new Map([[file, source]]), new Set())).toEqual([
      `${file}: PostgreSQL opt-in test must be named *-postgres.test.ts`,
    ]);
  }
  for (const source of [
    "import { thing } from './pg-testing-notes';",
    "import { thing } from '@omni/db';",
    "const name = 'pg-testing';",
  ]) {
    expect(violations(new Map([[file, source]]), new Set())).toEqual([]);
  }
  const suite = 'packages/foo-postgres.test.ts';
  const importing = "import { dropDatabaseOrThrow } from '@omni/db/pg-testing';";
  expect(violations(new Map([[suite, importing]]), new Set([suite]))).toEqual([]);
  const [acknowledged] = harnessUnitTests.keys();
  expect(violations(new Map([[acknowledged as string, importing]]), new Set())).toEqual([]);
  expect(harnessImporters(new Map([[file, importing]]))).toEqual([file]);
});

test('retired opt-in names cannot return in tracked files outside .genie', () => {
  expect(deadViolations(trackedFiles())).toEqual([]);
}, 30_000);

test('recognizes env aliases, destructuring, brackets and DB connection arguments', () => {
  for (const source of [
    'const u = process.env.OMNI_G4_POSTGRES_URL;',
    'const { OMNI_G4_POSTGRES_URL: u } = process.env;',
    "const env = process.env; const key = 'OMNI_G4_POSTGRES_URL'; const u = env[key];",
    'const { env } = process; const u = env.OMNI_G4_POSTGRES_URL;',
    'const url = process.env.DATABASE_URL; postgres(url);',
    'const { DATABASE_URL: url } = process.env; new Pool({ connectionString: url });',
    'const { env: e } = process; const { OMNI_G4_POSTGRES_URL: url } = e;',
    "const env = Bun.env; const u = env['OMNI_G4_POSTGRES_URL'];",
  ]) {
    expect(violations(new Map([['packages/foo.test.ts', source]]), new Set())).toHaveLength(1);
  }
  expect(
    violations(
      new Map([['packages/unit.test.ts', 'const saved = process.env.DATABASE_URL; process.env.DATABASE_URL = saved;']]),
      new Set(),
    ),
  ).toEqual([]);
});

test('aliases respect lexical shadowing and reads do not include writes', () => {
  for (const source of [
    "const process = { env: { OMNI_G4_POSTGRES_URL: '' } }; const u = process.env.OMNI_G4_POSTGRES_URL;",
    'const env = process.env; function unit(env: Record<string, string>) { return env.OMNI_G4_POSTGRES_URL; }',
    "process.env.OMNI_G4_POSTGRES_URL = 'fixture'; delete process.env.OMNI_G4_POSTGRES_URL;",
  ]) {
    expect(violations(new Map([['packages/unit.test.ts', source]]), new Set())).toEqual([]);
  }
});

test('unknown opt-ins cannot silently skip describe, skipIf, runIf or setup', () => {
  for (const source of [
    'const u = process.env.OMNI_G99_POSTGRES_URL; const pg = u ? describe : describe.skip;',
    "const { NOT_SUPPLIED: enabled } = process.env; describe.skipIf(!enabled)('db', () => {});",
    "const env = process.env; test.runIf(env['NOT_SUPPLIED'])('db', () => {});",
    'const enabled = process.env.NOT_SUPPLIED; beforeAll(() => { if (!enabled) return; });',
    "if (process.env.NOT_SUPPLIED) describe('db', () => {});",
    "process.env.NOT_SUPPLIED && test('db', () => {});",
  ]) {
    const file = 'packages/x-postgres.test.ts';
    expect(violations(new Map([[file, source]]), new Set([file]))).toHaveLength(1);
  }
  const file = 'packages/x-postgres.test.ts';
  expect(
    violations(
      new Map([[file, 'const u = process.env.OMNI_G4_POSTGRES_URL; const pg = u ? describe : describe.skip;']]),
      new Set([file]),
    ),
  ).toEqual([]);
});

test('suffix alone cannot put a suite outside the real discovery roots or inside an excluded directory', () => {
  for (const file of ['scripts/x-postgres.test.ts', 'packages/dist/x-postgres.test.ts']) {
    expect(violations(new Map([[file, '']]), new Set())).toEqual([`${file}: outside pg-gate discovery`]);
  }
});

test('postgres suites and test support drop databases only through dropDatabaseOrThrow or a checked exit', () => {
  const discovered = discoverSuites();
  const scope = dropScope(trackedFiles(), discovered);
  expect(scope.has(dropHelperModule)).toBe(true);
  expect(scope.has(templateModule)).toBe(true);
  const { found, exempt } = rawDrops(scope);
  expect(found.map(({ file }) => file)).toEqual(checkedExitDrops.map(([file]) => file).sort());
  expect(exempt.map(({ file }) => file)).toEqual(dropExemptions.map(({ file }) => file).sort());
}, 30_000);

test('a raw drop with an ignored result is found; the helper statement and comments are not', () => {
  const file = 'packages/x-postgres.test.ts';
  const files = (source: string, at = file) => rawDrops(new Map([[at, source]])).found.map((site) => site.file);
  const ignored = 'afterAll(() => { runSqlOn(superUrl, `DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE);`); });';
  expect(files(ignored)).toEqual([file]);
  expect(files(`${ignored}\nrunSqlOn(superUrl, 'drop database x');`)).toEqual([file, file]);
  const helper = 'function dropDatabaseOrThrow(a, d) { run(`DROP DATABASE IF EXISTS "${d}"`); }';
  expect(files(helper, dropHelperModule)).toEqual([]);
  const helperTwice = "function dropDatabaseOrThrow(a, d) { run('DROP DATABASE x'); run('DROP DATABASE y'); }";
  expect(files(helperTwice, dropHelperModule)).toEqual([dropHelperModule]);
  expect(files(helper)).toEqual([file]);
  expect(files('// DROP DATABASE is never written here\ndropDatabaseOrThrow(access, name);')).toEqual([]);
  const scoped = dropScope(
    new Map([
      [file, ''],
      ['packages/api/src/__tests__/fixtures/pg-clone.ts', ''],
      ['packages/db/src/tenancy-roles.test.ts', ''],
      [templateModule, ''],
    ]),
    new Set([file]),
  );
  expect([...scoped.keys()]).toEqual([file, 'packages/api/src/__tests__/fixtures/pg-clone.ts', templateModule]);
});

test('the harness is scanned: its catch exemption covers one literal in ensureSqlTemplate and nothing else', () => {
  const real = readFileSync(join(root, templateModule), 'utf8');
  const lines = real.split('\n');
  const catchLine = lines.findIndex((line) => /^\s*runSql\(access, access\.superUrl, `DROP DATABASE/.test(line)) + 1;
  expect(catchLine).toBeGreaterThan(0);
  const scan = (text: string, exemptions?: readonly DropExemption[]) =>
    rawDrops(new Map([[templateModule, text]]), exemptions);
  const baseline = scan(real);
  expect(baseline.exempt).toEqual([{ file: templateModule, line: catchLine }]);
  expect(baseline.found).toHaveLength(1);

  // (1) a second raw DROP elsewhere in the harness is found.
  const planted = `${real}\nexport function leak(access: PgSuperAccess): void {\n  runSql(access, access.superUrl, 'DROP DATABASE IF EXISTS "leak" WITH (FORCE);');\n}\n`;
  const leakLine = planted.split('\n').findIndex((line) => line.includes('"leak"')) + 1;
  expect(leakLine).toBeGreaterThan(lines.length);
  expect(scan(planted).found).toEqual([...baseline.found, { file: templateModule, line: leakLine }]);
  // ...and so is a second one inside the same catch: the exemption covers exactly one literal.
  const twice = [...lines.slice(0, catchLine), lines[catchLine - 1], ...lines.slice(catchLine)].join('\n');
  expect(scan(twice).found).toEqual([...baseline.found, { file: templateModule, line: catchLine + 1 }]);

  // (2) without the exemption, the real ensureSqlTemplate catch site is reported.
  const withoutCatch = dropExemptions.filter((exemption) => exemption.file !== templateModule);
  expect(scan(real, withoutCatch).found).toEqual([...baseline.found, { file: templateModule, line: catchLine }]);
});

test('dead-name scanning includes docs and config; only .genie is exempt', () => {
  for (const name of deadNames) {
    expect(
      deadViolations(
        new Map([
          ['docs/guide.md', name],
          ['turbo.json', name],
          ['.genie/old.md', name],
        ]),
      ),
    ).toEqual([`docs/guide.md: retired ${name}`, `turbo.json: retired ${name}`]);
  }
});

test('dead-name scanning ignores case', () => {
  for (const name of deadNames) {
    const lower = name.toLowerCase();
    const mixed = `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`;
    expect(
      deadViolations(
        new Map([
          ['docs/lower.md', `set ${lower}=1`],
          ['scripts/mixed.sh', mixed],
          ['.genie/old.md', lower],
        ]),
      ),
    ).toEqual([`docs/lower.md: retired ${name}`, `scripts/mixed.sh: retired ${name}`]);
  }
});
