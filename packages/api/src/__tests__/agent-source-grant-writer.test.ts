/** Paired-agents follow-up 1 guard: `insertAgentSourceGrant` in
 * packages/db/src/agent-source-grants.ts is the only sanctioned agent_source_grants
 * writer, because it is the one place that stamps a grant's tenant from its source.
 *
 * Non-test source under packages/ and apps/ fails when it:
 * - calls `.insert(agentSourceGrants)` anywhere except the helper (aliases and
 *   renamed imports resolve; upserts are inserts);
 * - calls `.update(agentSourceGrants).set(...)` with `tenantId` or a spread
 *   (revocation via `revokedAt` stays allowed);
 * - writes the table in SQL text: INSERT INTO / UPDATE agent_source_grants, in a
 *   string or an `sql` template whose interpolation is the table.
 * Test files are excluded: the G6 suites seed explicit-tenant grants on purpose.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const ROOT = resolve(import.meta.dir, '../../../..');
const HELPER = 'packages/db/src/agent-source-grants.ts';
const TABLE = 'agentSourceGrants';
const SQL_WRITE = /\b(insert\s+into|update)\s+(public\.)?"?agent_source_grants"?/i;
const SQL_WRITE_PREFIX = /\b(insert\s+into|update)\s*$/i;

function scannedFiles(): string[] {
  const files = new Set<string>();
  for (const pattern of ['packages/*/src/**/*.ts', 'packages/*/scripts/**/*.ts', 'apps/*/src/**/*.ts'])
    for (const file of new Bun.Glob(pattern).scanSync({ cwd: ROOT }))
      if (!/(^|\/)(node_modules|dist|__tests__)\//.test(file) && !/\.(test|spec)\.ts$/.test(file)) files.add(file);
  return [...files].sort();
}

/** Every grant write site in `source`, labelled; `sanctioned` marks inserts in the helper. */
function grantWrites(source: string, path: string): { site: string; sanctioned: boolean }[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
  const tableNames = new Set([TABLE]);
  // Renamed imports and `const g = agentSourceGrants` aliases name the same table.
  function collectAliases(node: ts.Node): void {
    if (ts.isImportSpecifier(node) && (node.propertyName ?? node.name).text === TABLE) tableNames.add(node.name.text);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isTable(node.initializer))
      tableNames.add(node.name.text);
    ts.forEachChild(node, collectAliases);
  }
  function isTable(node: ts.Expression): boolean {
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
      return isTable(node.expression);
    const expression = node;
    if (ts.isIdentifier(expression)) return tableNames.has(expression.text);
    return ts.isPropertyAccessExpression(expression) && expression.name.text === TABLE;
  }
  collectAliases(file);
  collectAliases(file);
  const found: { site: string; sanctioned: boolean }[] = [];
  const tableCall = (node: ts.Node, method: string): node is ts.CallExpression =>
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === method &&
    !!node.arguments[0] &&
    isTable(node.arguments[0]);
  function setsTenant(node: ts.CallExpression): boolean {
    const patch = node.arguments[0];
    if (!patch || !ts.isObjectLiteralExpression(patch)) return true;
    return patch.properties.some(
      (property) =>
        ts.isSpreadAssignment(property) ||
        (property.name && ts.isIdentifier(property.name) && property.name.text === 'tenantId') ||
        (property.name && ts.isStringLiteralLike(property.name) && /^tenant_?id$/i.test(property.name.text)),
    );
  }
  function tenantUpdate(node: ts.Node): boolean {
    return (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'set' &&
      tableCall(node.expression.expression, 'update') &&
      setsTenant(node)
    );
  }
  function sqlWrite(node: ts.Node): boolean {
    if (ts.isStringLiteralLike(node)) return SQL_WRITE.test(node.text);
    if (!ts.isTemplateExpression(node)) return false;
    let before = node.head.text;
    for (const span of node.templateSpans) {
      if ((isTable(span.expression) && SQL_WRITE_PREFIX.test(before)) || SQL_WRITE.test(before)) return true;
      before = span.literal.text;
    }
    return SQL_WRITE.test(before);
  }
  function visit(node: ts.Node): void {
    if (tableCall(node, 'insert')) found.push({ site: node.getText(file), sanctioned: path === HELPER });
    else if (tenantUpdate(node) || sqlWrite(node)) found.push({ site: node.getText(file), sanctioned: false });
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
];
const permitted = [
  'db.select().from(agentSourceGrants)',
  'db.update(agentSourceGrants).set({ revokedAt: new Date() }).where(eq(agentSourceGrants.id, id))',
  'db.insert(durableConsumers).values(row)',
  'db.delete(agentSourceGrants)',
  "const note = 'the agent_source_grants table'",
  'sql`select 1 from ${agentSourceGrants} where ${agentSourceGrants.revokedAt} is null`',
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
