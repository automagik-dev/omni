/** C12 covers whole slice-owned source files, without allowlists.
 * Inventory: git diff --name-only 25dbdcab3..HEAD, minus tests/non-TS,
 * intersected with the paths changed by G1-G4 implementation/repair commits
 * 564338b94, 909dbe94c, 192eb4761, e31dcba02, 4137ef3de, b343ae284,
 * d99dd3f1f, ea0c3ba41; plus G5 source paths below. Unrelated dev changes
 * are outside this wish. routes/v2/instances.ts is beyond the planned inventory:
 * G2 repair e31dcba02 added producer-scope exits there, so the whole file belongs.
 * includes/Set/map detection is NEW coverage, not parity with the original
 * equality/switch baseline. The literal-policy reference covers all forms;
 * only channel discriminants relax either policy. Later slices extend this inventory.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { DEVICE_CLIENTS } from '../login/config';

const PAIRED_AGENT_SLICE_FILES = [
  'packages/api/src/constants/scopes.ts',
  'packages/api/src/index.ts',
  'packages/api/src/lib/key-agent.ts',
  'packages/api/src/lib/producer-scope.ts',
  'packages/api/src/middleware/auth.ts',
  'packages/api/src/plugins/event-persistence.ts',
  'packages/api/src/routes/v2/event-consumers.ts',
  'packages/api/src/routes/v2/instances.ts',
  'packages/api/src/routes/v2/system.ts',
  'packages/api/src/schemas/openapi/event-consumers.ts',
  'packages/api/src/schemas/openapi/system.ts',
  'packages/api/src/services/agents.ts',
  'packages/api/src/services/automations.ts',
  'packages/api/src/services/connectors.ts',
  'packages/api/src/services/event-consumers.ts',
  'packages/api/src/services/webhooks.ts',
  'packages/api/src/tenancy/feature-flag.ts',
  'packages/api/src/tenancy/route-ownership.ts',
  'packages/cli/src/commands/doctor.ts',
  'packages/core/src/events/envelope.ts',
  'packages/core/src/events/factory.ts',
  'packages/core/src/events/index.ts',
  'packages/core/src/events/types.ts',
  'packages/db/scripts/online-ddl.ts',
  'packages/db/src/online-ddl.ts',
  'packages/db/src/paired-agent-online-ddl.ts',
  'packages/db/src/pg-migrated-template.ts',
  'packages/db/src/schema.ts',
  'packages/db/src/tenancy-db-access-guard.ts',
  'packages/db/src/tenancy-rls.ts',
  'packages/sdk/src/types.generated.ts',
];
const HARNESS_NAMES = ['claude-code', 'codex', 'opencode', 'openclaw', 'hermes', 'herdr', 'brain'];
const EXTERNAL_PROVIDERS = ['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'];
const forbiddenNames = new Set([...HARNESS_NAMES, ...Object.keys(DEVICE_CLIENTS)]);
const comparisons = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);
function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
    return unwrap(node.expression);
  return node;
}
function discriminantName(node: ts.Expression): string {
  const expression = unwrap(node);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression))
    return expression.argumentExpression.text;
  return '';
}
function isChannel(node: ts.Expression): boolean {
  return ['channel', 'channelType'].includes(discriminantName(node));
}
function literalName(node: ts.Node): string | undefined {
  if (ts.isComputedPropertyName(node)) return literalName(unwrap(node.expression));
  return ts.isStringLiteralLike(node) || ts.isIdentifier(node) ? node.text : undefined;
}
/** Original equality/switch-only checker, retained independently as the baseline. */
function baselineViolations(source: string): string[] {
  const file = ts.createSourceFile('baseline.ts', source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  function denied(literal: ts.Expression, against: ts.Expression): boolean {
    const value = unwrap(literal);
    return (
      ts.isStringLiteralLike(value) &&
      (forbiddenNames.has(value.text) ||
        (discriminantName(against) === 'provider' && EXTERNAL_PROVIDERS.includes(value.text)))
    );
  }
  function visit(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      comparisons.has(node.operatorToken.kind) &&
      (denied(node.left, node.right) || denied(node.right, node.left))
    )
      found.push(node.getText(file));
    if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        if (ts.isCaseClause(clause) && denied(clause.expression, node.expression)) found.push(clause.getText(file));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
function stringLiteralName(expression: ts.Expression): string | undefined {
  const literal = unwrap(expression);
  return ts.isStringLiteralLike(literal) ? literal.text : undefined;
}
/** Reference literal-deny policy; the new policy differs only by its channel exception.
 * Both modes inspect every comparison form, including collections and object maps.
 */
function literalPolicy(source: string, channelException: boolean): string[] {
  const file = ts.createSourceFile('slice.ts', source, ts.ScriptTarget.Latest, true);
  const bindings = new Map<string, ts.Expression[]>();
  function bind(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializers = bindings.get(node.name.text) ?? [];
      initializers.push(node.initializer);
      bindings.set(node.name.text, initializers);
    }
    ts.forEachChild(node, bind);
  }
  bind(file);
  const found: string[] = [];
  function deny(name: string | undefined, against: ts.Expression): boolean {
    if (!name) return false;
    if (forbiddenNames.has(name)) {
      // Device-client names always fail. Only harness names gain the channel exception.
      return !(channelException && HARNESS_NAMES.includes(name) && isChannel(against));
    }
    return discriminantName(against) === 'provider' && EXTERNAL_PROVIDERS.includes(name);
  }
  function collectionNames(node: ts.Expression, seen = new Set<string>()): string[] {
    const expression = unwrap(node);
    if (ts.isArrayLiteralExpression(expression))
      return expression.elements.flatMap((element) => {
        const name = literalName(element);
        return name ? [name] : [];
      });
    if (
      ts.isNewExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      expression.expression.text === 'Set'
    ) {
      return expression.arguments?.flatMap((argument) => collectionNames(argument, seen)) ?? [];
    }
    if (ts.isObjectLiteralExpression(expression))
      return expression.properties.flatMap((property) => {
        const name = property.name && literalName(property.name);
        return name ? [name] : [];
      });
    if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
      const next = new Set(seen).add(expression.text);
      return (bindings.get(expression.text) ?? []).flatMap((value) => collectionNames(value, next));
    }
    return [];
  }
  function comparisonDenied(node: ts.Node): boolean {
    return (
      ts.isBinaryExpression(node) &&
      comparisons.has(node.operatorToken.kind) &&
      (deny(stringLiteralName(node.left), node.right) || deny(stringLiteralName(node.right), node.left))
    );
  }
  function switchDenied(node: ts.Node): boolean {
    return (
      ts.isSwitchStatement(node) &&
      node.caseBlock.clauses.some(
        (clause) => ts.isCaseClause(clause) && deny(stringLiteralName(clause.expression), node.expression),
      )
    );
  }
  function membershipDenied(node: ts.Node): boolean {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !['includes', 'has'].includes(node.expression.name.text)
    )
      return false;
    const argument = node.arguments[0];
    return !!argument && collectionNames(node.expression.expression).some((name) => deny(name, argument));
  }
  function lookupDenied(node: ts.Node): boolean {
    if (!ts.isElementAccessExpression(node)) return false;
    const key = node.argumentExpression;
    return (
      (ts.isStringLiteralLike(key) && deny(key.text, node.expression)) ||
      collectionNames(node.expression).some((name) => deny(name, key))
    );
  }
  function visit(node: ts.Node): void {
    if ([comparisonDenied, switchDenied, membershipDenied, lookupDenied].some((check) => check(node)))
      found.push(node.getText(file));
    ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}
const oldLiteralChecker = (source: string) => literalPolicy(source, false);
const violations = (source: string) => literalPolicy(source, true);
for (const path of PAIRED_AGENT_SLICE_FILES) {
  test(`C12: ${path} has no provider, device or harness special case`, () => {
    expect(violations(readFileSync(resolve(import.meta.dir, '../../../..', path), 'utf8'))).toEqual([]);
  });
}
const failingFixtures = [
  "agent.provider === 'claude'",
  'provider !== "openai"',
  "switch (agent.provider) { case 'agno': break; }",
  "harness === 'hermes'",
  "harness !== 'codex'",
  "harness == 'codex'",
  "harness != 'codex'",
  "switch (agent.harness) { case 'hermes': break; }",
  "switch (clientId) { case 'codex': break; }",
  "clientId === 'codex'",
  "clientId === 'omni-dsh'",
  "deviceClient === 'omni-cli'",
  "'brain' !== harness",
  "agent['provider'] == 'gemini'",
  "['codex', 'hermes'].includes(harness)",
  "new Set(['hermes']).has(x)",
  "(harness) === ('codex')",
  "({ ['codex']: fn }[h])",
  '({ codex: fn }[h])',
  "MAP['codex']",
  "const { harness } = agent; harness === 'codex'",
  "const h = agent.harness; h === 'hermes'",
  "x === 'codex' ? a : b",
  "const names = ['codex']; names.includes(h)",
  'const MAP = { codex: fn }; MAP[h]',
];
const channelFixtures = [
  "instance.channel === 'hermes'",
  "switch (instance.channel) { case 'hermes': break; }",
  "input.channelType !== 'hermes'",
];
const passingFixtures = [
  "agent.provider === 'paired'",
  'AgentSystemSchema.options.includes(p)',
  "const type = 'custom.agent.reply'",
  "switch (agent.provider) { case 'paired': break; }",
  "// agent.provider === 'claude'\nconst event = 'custom.agent.reply'",
];
for (const source of failingFixtures)
  test(`C12 rejects ${source}`, () => {
    expect(violations(source).length).toBeGreaterThan(0);
    expect(oldLiteralChecker(source).length).toBeGreaterThan(0);
  });
for (const source of [...passingFixtures, ...channelFixtures])
  test(`C12 permits ${source}`, () => expect(violations(source)).toEqual([]));
for (const source of [...failingFixtures, ...passingFixtures, ...channelFixtures])
  test(`C12 old/new parity except channel: ${source}`, () => {
    const oldRejected = oldLiteralChecker(source).length > 0;
    const newRejected = violations(source).length > 0;
    expect(oldRejected !== newRejected).toBe(channelFixtures.includes(source));
  });

for (const source of [...failingFixtures, ...passingFixtures, ...channelFixtures])
  test(`C12 baseline superset except channel: ${source}`, () => {
    const baselineRejected = baselineViolations(source).length > 0;
    const newRejected = violations(source).length > 0;
    expect(baselineRejected && !newRejected).toBe(channelFixtures.includes(source));
  });
