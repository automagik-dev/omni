/** Legacy DB harness ratchet: migrate consumers to isolated *-postgres suites; this set may only shrink. */
import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dir, '../../../..');
const helper = 'packages/api/src/__tests__/db-helper.ts';
const LEGACY_DB_HELPER_CEILING = 7;
const LEGACY_DB_HELPER_ACKNOWLEDGED = [
  'packages/api/src/__tests__/api-key-enforcement.test.ts',
  'packages/api/src/__tests__/connector-liveness.test.ts',
  'packages/api/src/__tests__/event-persistence.test.ts',
  'packages/api/src/__tests__/follow-up-e2e.test.ts',
  'packages/api/src/__tests__/follow-up-lifecycle.test.ts',
  'packages/api/src/__tests__/follow-up-sweeper.test.ts',
  'packages/api/src/__tests__/pairing.test.ts',
];

function sourceFiles(directory: string): Map<string, string> {
  const files = new Map<string, string>();
  for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    // Dirents do not follow dependency symlinks. No source files are excluded.
    if (entry.isDirectory()) {
      for (const [path, source] of sourceFiles(file)) files.set(path, source);
    } else if (entry.isFile() && /\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.set(file, readFileSync(resolve(root, file), 'utf8'));
    }
  }
  return files;
}

function moduleTarget(file: string, specifier: string, files: Map<string, string>): string | undefined {
  if (!specifier.startsWith('.')) return undefined;
  const target = posix.normalize(posix.join(posix.dirname(file), specifier));
  return [target, ...['.ts', '.tsx', '.js', '.mjs', '.cjs', '/index.ts', '/index.js'].map((ext) => target + ext)].find(
    (path) => files.has(path),
  );
}

function moduleSpecifier(node: ts.Node): string | undefined {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return ts.isStringLiteralLike(node.moduleSpecifier) ? node.moduleSpecifier.text : undefined;
  }
  if (ts.isCallExpression(node)) {
    const isModule =
      node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require');
    const first = node.arguments[0];
    return isModule && first && ts.isStringLiteralLike(first) ? first.text : undefined;
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    const expression = node.moduleReference.expression;
    return expression && ts.isStringLiteralLike(expression) ? expression.text : undefined;
  }
  return undefined;
}

function environmentNames(node: ts.Node, ast: ts.SourceFile): string[] {
  if (!node.parent) return [];
  const write =
    (ts.isBinaryExpression(node.parent) &&
      node.parent.left === node &&
      node.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) ||
    ts.isDeleteExpression(node.parent);
  if (write) return [];
  if (ts.isPropertyAccessExpression(node) && node.expression.getText(ast) === 'process.env') return [node.name.text];
  if (ts.isElementAccessExpression(node) && node.expression.getText(ast) === 'process.env') {
    const name = node.argumentExpression;
    return name && ts.isStringLiteralLike(name) ? [name.text] : [];
  }
  if (
    ts.isVariableDeclaration(node) &&
    node.initializer?.getText(ast) === 'process.env' &&
    ts.isObjectBindingPattern(node.name)
  ) {
    return node.name.elements.flatMap((element) => {
      const name = element.propertyName ?? element.name;
      return ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? [name.text] : [];
    });
  }
  return [];
}

function sourceFacts(file: string, source: string) {
  const imports: string[] = [];
  const envReads: string[] = [];
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node) {
    const specifier = moduleSpecifier(node);
    if (specifier !== undefined) imports.push(specifier);
    for (const name of environmentNames(node, ast)) {
      // Legacy opt-ins anywhere; ambient DATABASE_URL also in test sources.
      // Production's ordinary configuration and fixture writes are not test gates.
      if (
        name === 'ENABLE_DB_TESTS' ||
        name === 'TEST_DATABASE_URL' ||
        (name === 'DATABASE_URL' && /(?:\/__tests__\/|\.test\.)/.test(file))
      )
        envReads.push(name);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { imports, envReads };
}

function inventory(files: Map<string, string>) {
  const facts = new Map([...files].map(([file, source]) => [file, sourceFacts(file, source)]));
  const consumers = new Set([helper]);
  // Include wrappers and re-exports transitively, irrespective of their exported names.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [file, fact] of facts) {
      if (
        !consumers.has(file) &&
        fact.imports.some((specifier) => {
          const target = moduleTarget(file, specifier, files);
          return target !== undefined && consumers.has(target);
        })
      ) {
        consumers.add(file);
        changed = true;
      }
    }
  }
  consumers.delete(helper);
  return {
    consumers: [...consumers].sort(),
    envGates: [...facts]
      .filter(([, fact]) => fact.envReads.length > 0)
      .map(([file]) => file)
      .sort(),
  };
}

test('legacy DB consumers equal the shrinking acknowledged set and never enter pg-gate', () => {
  const files = sourceFiles('packages');
  expect([...files.keys()].filter((file) => file.endsWith('.test.ts')).length).toBeGreaterThan(60);
  expect(files.has(helper)).toBe(true);
  for (const file of LEGACY_DB_HELPER_ACKNOWLEDGED) {
    expect(files.has(file)).toBe(true);
    expect(file.endsWith('-postgres.test.ts')).toBe(false);
  }
  const actual = inventory(files);
  expect(actual.consumers).toEqual(LEGACY_DB_HELPER_ACKNOWLEDGED);
  expect(LEGACY_DB_HELPER_ACKNOWLEDGED.length).toBeLessThanOrEqual(LEGACY_DB_HELPER_CEILING);
  // Independent of helper imports: copying/renaming the legacy opt-in gate fails here.
  expect(actual.envGates).toEqual([helper]);
});

test.each([
  "import { getTestDb as renamed } from './db-helper';",
  "export { getTestDb as renamed } from './db-helper';",
  "const legacy = await import('./db-helper');",
  "const legacy = require('./db-helper');",
  "import legacy = require('./db-helper');",
])('scanner catches a direct helper consumer: %s', (source) => {
  const file = 'packages/api/src/__tests__/planted.test.ts';
  expect(
    inventory(
      new Map([
        [helper, ''],
        [file, source],
      ]),
    ).consumers,
  ).toEqual([file]);
});

test('scanner follows a wrapper and does not interpret comments or fixture strings as imports', () => {
  const wrapper = 'packages/api/src/__tests__/wrapper.ts';
  const file = 'packages/api/src/__tests__/planted.test.ts';
  expect(
    inventory(
      new Map([
        [helper, ''],
        [wrapper, "export * from './db-helper';"],
        [file, "import * as renamed from './wrapper';"],
      ]),
    ).consumers,
  ).toEqual([file, wrapper]);
  expect(
    inventory(
      new Map([
        [helper, ''],
        [
          file,
          `// import './db-helper';
    const fixture = "require('./db-helper')";`,
        ],
      ]),
    ).consumers,
  ).toEqual([]);
});

test.each([
  "const enabled = process.env.ENABLE_DB_TESTS === 'true';",
  "const url = process.env['TEST_DATABASE_URL'];",
  'const { TEST_DATABASE_URL: url } = process.env;',
  'const suite = process.env.DATABASE_URL ? describe : describe.skip;',
])('independent environment scan catches an unimported gate: %s', (source) => {
  const file = 'packages/api/src/__tests__/renamed-gate.test.ts';
  const actual = inventory(
    new Map([
      [helper, ''],
      [file, source],
    ]),
  );
  expect(actual.consumers).toEqual([]);
  expect(actual.envGates).toEqual([file]);
});
