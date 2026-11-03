/** Paired-agents follow-up 1 guard: `insertAgentSourceGrant` in
 * packages/db/src/agent-source-grants.ts is the only sanctioned agent_source_grants
 * writer, because it is the one place that stamps a grant's tenant from its source.
 *
 * Scope: non-test `.ts` and `.tsx` under packages/<pkg>/src, packages/<pkg>/scripts,
 * apps/<app>/src and the root scripts/ tree. Tests, `__tests__`, dist and
 * node_modules are excluded: the G6 suites seed explicit-tenant grants on purpose.
 *
 * A scanned file fails when it:
 * - calls `.insert(<table>)` anywhere except the helper (upserts are inserts);
 * - calls `.update(<table>).set(...)` with `tenantId`, `sourceId` or `sourceKind`
 *   (camelCase or snake_case keys), a spread, a computed key that is not a benign
 *   literal, or a non-literal patch. Moving a grant to another source would keep
 *   the old source's tenant stamp. Revocation via `revokedAt` stays allowed;
 * - writes the table in SQL text: INSERT INTO / UPDATE agent_source_grants, with an
 *   optional quoted or unquoted schema prefix (`"public".`), in a string or an `sql`
 *   template, or a template whose interpolation after INSERT INTO / UPDATE is
 *   <table> or `sql.identifier` / `sql.raw` naming agent_source_grants.
 *
 * <table> is `agentSourceGrants` reached by: the identifier; property access
 * (`schema.agentSourceGrants`); literal element access (`schema['agentSourceGrants']`);
 * a renamed import; a `const`/`let` alias or a plain reassignment of one; object
 * destructuring at any depth, including parameters (`{ agentSourceGrants: g }`); and
 * array destructuring of an array literal (`const [g] = [agentSourceGrants]`). Casts,
 * `satisfies`, non-null assertions and parentheses are unwrapped.
 *
 * Not detected (a syntactic guard cannot be complete): computed or runtime names
 * (`schema[key]`, `sql.raw(name)` from a variable, assembled SQL strings), aliases
 * passed through function calls, return values or other modules, and writes outside
 * the scanned trees. Also note that turbo keys this test on api inputs, so a plant
 * outside packages/api is caught by the uncached CI run or a direct `bun test`.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dir, '../../../..');
const HELPER = 'packages/db/src/agent-source-grants.ts';
const TABLE = 'agentSourceGrants';
const SCHEMA_PREFIX = String.raw`("?\w+"?\s*\.\s*)?`;
const SQL_WRITE = new RegExp(String.raw`\b(insert\s+into|update)\s+${SCHEMA_PREFIX}"?agent_source_grants"?`, 'i');
const SQL_WRITE_PREFIX = new RegExp(String.raw`\b(insert\s+into|update)\s*${SCHEMA_PREFIX}$`, 'i');
const SQL_TABLE_NAME = new RegExp(String.raw`^${SCHEMA_PREFIX}"?agent_source_grants"?$`, 'i');
/** `.set()` keys that carry the tenant stamp or the source it was derived from, normalized. */
const STAMP_COLUMNS = new Set(['tenantid', 'sourceid', 'sourcekind']);
const SCAN_GLOBS = [
  'packages/*/src/**/*.{ts,tsx}',
  'packages/*/scripts/**/*.{ts,tsx}',
  'apps/*/src/**/*.{ts,tsx}',
  'scripts/**/*.{ts,tsx}',
];

/** Whether the scan covers a repo-relative path: in a scan glob, and not a test or build output. */
function isScanned(path: string): boolean {
  return (
    SCAN_GLOBS.some((pattern) => new Bun.Glob(pattern).match(path)) &&
    !/(^|\/)(node_modules|dist|__tests__)\//.test(path) &&
    !/\.(test|spec)\.tsx?$/.test(path)
  );
}

function scannedFiles(): string[] {
  const files = new Set<string>();
  for (const pattern of SCAN_GLOBS)
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: ROOT })) if (isScanned(file)) files.add(file);
  return [...files].sort();
}

function unwrap(node: ts.Expression): ts.Expression {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  )
    return unwrap(node.expression);
  return node;
}

/** `agentSourceGrants`, an alias of it, `x.agentSourceGrants` or `x['agentSourceGrants']`. */
function isTable(node: ts.Expression, tableNames: Set<string>): boolean {
  const expression = unwrap(node);
  if (ts.isIdentifier(expression)) return tableNames.has(expression.text);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text === TABLE;
  return (
    ts.isElementAccessExpression(expression) &&
    ts.isStringLiteralLike(expression.argumentExpression) &&
    expression.argumentExpression.text === TABLE
  );
}

/** `sql.identifier('agent_source_grants')` or `sql.raw('"public"."agent_source_grants"')`. */
function isSqlTableName(node: ts.Expression): boolean {
  const expression = unwrap(node);
  return (
    ts.isCallExpression(expression) &&
    ts.isPropertyAccessExpression(expression.expression) &&
    ['identifier', 'raw'].includes(expression.expression.name.text) &&
    expression.arguments.some((argument) => ts.isStringLiteralLike(argument) && SQL_TABLE_NAME.test(argument.text))
  );
}

/** Names bound to the table by a destructuring pattern; object patterns recurse into nested patterns. */
function bindingAliases(pattern: ts.BindingName, initializer: ts.Expression | undefined, names: Set<string>): string[] {
  if (ts.isObjectBindingPattern(pattern))
    return pattern.elements.flatMap((element) => {
      const key = element.propertyName ?? element.name;
      const keyText = ts.isIdentifier(key) || ts.isStringLiteralLike(key) ? key.text : undefined;
      if (!ts.isIdentifier(element.name)) return bindingAliases(element.name, undefined, names);
      return keyText === TABLE ? [element.name.text] : [];
    });
  if (!ts.isArrayBindingPattern(pattern) || !initializer) return [];
  const values = unwrap(initializer);
  if (!ts.isArrayLiteralExpression(values)) return [];
  return pattern.elements.flatMap((element, index) => {
    const value = values.elements[index];
    return ts.isBindingElement(element) && ts.isIdentifier(element.name) && value && isTable(value, names)
      ? [element.name.text]
      : [];
  });
}

/** Aliases a node introduces: renamed imports, declarations, reassignments and destructuring. */
function aliasesAt(node: ts.Node, names: Set<string>): string[] {
  if (ts.isImportSpecifier(node)) return (node.propertyName ?? node.name).text === TABLE ? [node.name.text] : [];
  if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
    if (ts.isIdentifier(node.name)) return node.initializer && isTable(node.initializer, names) ? [node.name.text] : [];
    return ts.isBindingElement(node) ? [] : bindingAliases(node.name, node.initializer, names);
  }
  const reassigned =
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    ts.isIdentifier(node.left) &&
    isTable(node.right, names);
  return reassigned ? [node.left.text] : [];
}

/** Whether an `.update(<table>).set(patch)` patch may touch the tenant stamp or its source. */
function setsStamp(node: ts.CallExpression): boolean {
  const patch = node.arguments[0];
  if (!patch || !ts.isObjectLiteralExpression(patch)) return true;
  const stampKey = (text: string) => STAMP_COLUMNS.has(text.replaceAll('_', '').toLowerCase());
  return patch.properties.some((property) => {
    if (ts.isSpreadAssignment(property)) return true;
    const name = property.name;
    if (!name) return true;
    if (ts.isComputedPropertyName(name))
      return !ts.isStringLiteralLike(name.expression) || stampKey(name.expression.text);
    return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && stampKey(name.text);
  });
}

/** SQL text that writes the table, including a template whose write target is interpolated. */
function sqlWrite(node: ts.Node, tableNames: Set<string>): boolean {
  if (ts.isStringLiteralLike(node)) return SQL_WRITE.test(node.text);
  if (!ts.isTemplateExpression(node)) return false;
  let before = node.head.text;
  for (const span of node.templateSpans) {
    const target = isTable(span.expression, tableNames) || isSqlTableName(span.expression);
    if ((target && SQL_WRITE_PREFIX.test(before)) || SQL_WRITE.test(before)) return true;
    before = span.literal.text;
  }
  return SQL_WRITE.test(before);
}

/** Every grant write site in `source`, labelled; `sanctioned` marks inserts in the helper. */
function grantWrites(source: string, path: string): { site: string; sanctioned: boolean }[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const tableNames = new Set([TABLE]);
  function collectAliases(node: ts.Node): void {
    for (const alias of aliasesAt(node, tableNames)) tableNames.add(alias);
    ts.forEachChild(node, collectAliases);
  }
  // Two passes, so an alias of an alias declared later in the file still resolves.
  collectAliases(file);
  collectAliases(file);
  const found: { site: string; sanctioned: boolean }[] = [];
  const tableCall = (node: ts.Node, method: string): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === method &&
    !!node.arguments[0] &&
    isTable(node.arguments[0], tableNames);
  const stampUpdate = (node: ts.Node): boolean =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'set' &&
    tableCall(node.expression.expression, 'update') &&
    setsStamp(node);
  function visit(node: ts.Node): void {
    if (tableCall(node, 'insert')) found.push({ site: node.getText(file), sanctioned: path === HELPER });
    else if (stampUpdate(node) || sqlWrite(node, tableNames))
      found.push({ site: node.getText(file), sanctioned: false });
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

test('the helper is the only agent_source_grants writer in non-test source', () => {
  const files = scannedFiles();
  expect(files).toContain(HELPER);
  const writes = files.flatMap((path) =>
    grantWrites(readFileSync(resolve(ROOT, path), 'utf8'), path).map((write) => ({ path, ...write })),
  );
  expect(writes.filter((write) => !write.sanctioned)).toEqual([]);
  // Fail-closed: a scan that cannot see the helper's own insert proves nothing.
  expect(writes.filter((write) => write.sanctioned).map((write) => write.path)).toEqual([HELPER]);
});

const rejected = [
  'db.insert(agentSourceGrants).values(row)',
  'tx.insert(schema.agentSourceGrants).values(row).onConflictDoNothing()',
  'db.insert(agentSourceGrants).values(row).onConflictDoUpdate({ target: agentSourceGrants.id, set: row })',
  'const g = agentSourceGrants; db.insert(g).values(row)',
  "import { agentSourceGrants as g } from '@omni/db'; db.insert(g).values(row)",
  'db.insert((agentSourceGrants as typeof agentSourceGrants)).values(row)',
  'db.update(agentSourceGrants).set({ tenantId: null })',
  "db.update(agentSourceGrants).set({ 'tenant_id': null })",
  'db.update(agentSourceGrants).set({ ...patch })',
  'db.update(agentSourceGrants).set(patch)',
  'sql`INSERT INTO ${agentSourceGrants} (agent_id) VALUES (${id})`',
  'sql`update ${agentSourceGrants} set tenant_id = null`',
  "db.execute(sql.raw('insert into agent_source_grants (agent_id) values (1)'))",
  'db.execute(sql.raw(`UPDATE public."agent_source_grants" SET tenant_id = NULL`))',
  'sql`with x as (select 1) insert into agent_source_grants select ${id}`',
  // Review of #1556, gap 1: element access.
  "db.insert(schema['agentSourceGrants']).values(row)",
  "const g = schema['agentSourceGrants']; db.insert(g).values(row)",
  // Gap 2: destructured aliases.
  'const { agentSourceGrants: g } = schema; db.insert(g).values(row)',
  'const { agentSourceGrants } = schema; db.insert(agentSourceGrants).values(row)',
  'const [g] = [agentSourceGrants]; db.insert(g).values(row)',
  'const { schema: { agentSourceGrants: g } } = db; db.insert(g).values(row)',
  'function write({ agentSourceGrants: g }: typeof schema) { return db.insert(g).values(row) }',
  'let g; g = agentSourceGrants; db.insert(g!).values(row)',
  // Gap 3: the table named through sql.identifier.
  "sql`insert into ${sql.identifier('agent_source_grants')} (agent_id) values (${id})`",
  "sql`UPDATE ${sql.identifier('agent_source_grants')} SET revoked_at = null`",
  'sql`insert into ${sql.raw(\'"public"."agent_source_grants"\')} (agent_id) values (${id})`',
  // Gap 4: a quoted or unquoted schema prefix.
  'sql`insert into "public"."agent_source_grants" (agent_id) values (${id})`',
  'db.execute(sql.raw(\'UPDATE "public".agent_source_grants SET tenant_id = NULL\'))',
  "db.execute(sql.raw('insert into omni.agent_source_grants (agent_id) values (1)'))",
  // Gap 5: an update that moves a grant to another source keeps the old tenant stamp.
  'db.update(agentSourceGrants).set({ sourceId, revokedAt: null })',
  'db.update(agentSourceGrants).set({ sourceKind: kind })',
  "db.update(agentSourceGrants).set({ 'source_id': id })",
  "db.update(agentSourceGrants).set({ ['sourceId']: id })",
  'db.update(agentSourceGrants).set({ [column]: id })',
];
const permitted = [
  'db.select().from(agentSourceGrants)',
  'db.update(agentSourceGrants).set({ revokedAt: new Date() }).where(eq(agentSourceGrants.id, id))',
  'db.insert(durableConsumers).values(row)',
  'db.delete(agentSourceGrants)',
  "const note = 'the agent_source_grants table'",
  'sql`select 1 from ${agentSourceGrants} where ${agentSourceGrants.revokedAt} is null`',
  "sql`select 1 from ${sql.identifier('agent_source_grants')}`",
  "db.insert(schema['durableConsumers']).values(row)",
  'const { agentSourceGrants: g } = schema; db.select().from(g)',
  'db.update(agentSourceGrants).set({ revokedAt: new Date(), agentId })',
  "db.update(agentSourceGrants).set({ ['revokedAt']: new Date() })",
  'const { agentSourceGrantsArchive: g } = schema; db.insert(g).values(row)',
];
for (const source of rejected)
  test(`grant writer guard rejects ${source}`, () => {
    expect(grantWrites(source, 'packages/api/src/planted.ts').length).toBeGreaterThan(0);
  });
for (const source of permitted)
  test(`grant writer guard permits ${source}`, () => {
    expect(grantWrites(source, 'packages/api/src/planted.ts')).toEqual([]);
  });
test('only the helper path sanctions an insert', () => {
  const insert = 'db.insert(agentSourceGrants).values(row)';
  expect(grantWrites(insert, HELPER)).toEqual([{ site: insert.replace('.values(row)', ''), sanctioned: true }]);
  expect(grantWrites(insert, 'packages/cli/src/commands/grant.ts')[0]?.sanctioned).toBe(false);
});

// Gaps 6 and 7: root scripts and .tsx files are scanned; tests and build output stay out.
const scanned = [
  'scripts/backfill-agents.ts',
  'scripts/lib/grant.ts',
  'packages/api/src/ui/grant-button.tsx',
  'apps/omni-canvas-dsh/src/panel.tsx',
  HELPER,
];
const unscanned = [
  'scripts/marketplace.test.ts',
  'packages/api/src/__tests__/grant.ts',
  'packages/api/src/ui/grant-button.test.tsx',
  'packages/api/dist/index.ts',
  'packages/api/node_modules/x/index.ts',
];
for (const path of scanned)
  test(`grant writer scan covers ${path}`, () => {
    expect(isScanned(path)).toBe(true);
  });
for (const path of unscanned)
  test(`grant writer scan skips ${path}`, () => {
    expect(isScanned(path)).toBe(false);
  });
test('a .tsx write parses as TSX and is rejected', () => {
  const source = 'export const Grant = () => <button onClick={() => db.insert(agentSourceGrants).values(row)} />;';
  expect(grantWrites(source, 'packages/api/src/ui/grant-button.tsx').length).toBeGreaterThan(0);
});
