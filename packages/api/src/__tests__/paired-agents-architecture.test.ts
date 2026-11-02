/** C12 covers whole slice-owned source files, without allowlists.
 * Inventory: git diff --name-only 25dbdcab3..HEAD, minus tests/non-TS,
 * intersected with the paths changed by G1-G4 implementation/repair commits
 * 564338b94, 909dbe94c, 192eb4761, e31dcba02, 4137ef3de, b343ae284,
 * d99dd3f1f, ea0c3ba41; plus G5 source paths below. Unrelated dev changes
 * are outside this wish. routes/v2/instances.ts is beyond the planned inventory:
 * G2 repair e31dcba02 added producer-scope exits there, so the whole file belongs.
 * includes/Set/map detection is NEW coverage, not parity with the original
 * equality/switch baseline. The literal-policy reference covers all forms;
 * only real channel/harness overlap on channel discriminants relaxes either policy.
 * Residuals: getProvider(agent) === 'claude' and agent.config.providerName === 'claude'
 * require semantic knowledge beyond this syntactic guard. Unresolvable channel-named
 * parameters, for-of and catch bindings retain the channel exception. A Hermes-keyed
 * Object.entries map dispatch has no literal at its use and remains unresolved.
 * Contrived template concatenation, spread collections/calls and obfuscated regexes
 * are outside this syntactic guard. Later slices extend the inventory.
 */
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { channelTypes } from '@omni/db';
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
const CHANNEL_HARNESS_OVERLAP = new Set(HARNESS_NAMES.filter((name) => channelTypes.some((type) => type === name)));
const EXTERNAL_PROVIDERS = ['claude', 'agno', 'openai', 'gemini', 'custom', 'omni-internal'];
const forbiddenNames = new Set([...HARNESS_NAMES, ...Object.keys(DEVICE_CLIENTS)]);
const isForbiddenName = (name: string) => forbiddenNames.has(name.toLowerCase());
const comparisons = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
]);
function baselineUnwrap(node: ts.Expression): ts.Expression {
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))
    return baselineUnwrap(node.expression);
  return node;
}
function baselineDiscriminantName(node: ts.Expression): string {
  const expression = baselineUnwrap(node);
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression) && ts.isStringLiteralLike(expression.argumentExpression))
    return expression.argumentExpression.text;
  return '';
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
    const value = baselineUnwrap(literal);
    return (
      ts.isStringLiteralLike(value) &&
      (forbiddenNames.has(value.text) ||
        (baselineDiscriminantName(against) === 'provider' && EXTERNAL_PROVIDERS.includes(value.text)))
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
function unwrap(node: ts.Expression): ts.Expression {
  if (ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node)) return unwrap(node.expression);
  const expression = baselineUnwrap(node);
  return expression === node ? node : unwrap(expression);
}
type Binding = ts.VariableDeclaration | ts.BindingElement | ts.ParameterDeclaration | ts.EnumDeclaration;
function isScope(node: ts.Node): boolean {
  return ts.isSourceFile(node) || ts.isBlock(node) || ts.isFunctionLike(node) || ts.isCaseBlock(node);
}
/** Lexical scopes prevent a same-named binding in another function changing the exception. */
function bindingResolver(file: ts.SourceFile) {
  const scopes = new Map<ts.Node, Map<string, Binding>>();
  function visit(node: ts.Node): void {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isParameter(node) ||
        ts.isEnumDeclaration(node)) &&
      ts.isIdentifier(node.name)
    ) {
      let scope: ts.Node = node.parent;
      while (scope.parent && !isScope(scope)) scope = scope.parent;
      const names = scopes.get(scope) ?? new Map<string, Binding>();
      names.set(node.name.text, node);
      scopes.set(scope, names);
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  const bindingFor = (identifier: ts.Identifier): Binding | undefined => {
    let scope: ts.Node | undefined = identifier.parent;
    while (scope) {
      const binding = scopes.get(scope)?.get(identifier.text);
      if (binding) return binding;
      scope = scope.parent;
    }
    return undefined;
  };
  const reassigned = new Set<Binding>();
  function writeTarget(node: ts.Expression): void {
    const target = unwrap(node);
    if (ts.isIdentifier(target)) {
      const binding = bindingFor(target);
      if (binding) reassigned.add(binding);
    }
  }
  function writes(node: ts.Node): void {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      writeTarget(node.left);
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)
    )
      writeTarget(node.operand);
    ts.forEachChild(node, writes);
  }
  writes(file);
  return { bindingFor, reassigned };
}
/** Reference literal-deny policy; the new policy differs only by its channel exception.
 * Both modes inspect every comparison form, including collections and object maps.
 */
function literalPolicy(source: string, channelException: boolean): string[] {
  const file = ts.createSourceFile('slice.ts', source, ts.ScriptTarget.Latest, true);
  const { bindingFor, reassigned } = bindingResolver(file);
  function initializer(node: ts.Identifier, seen: Set<ts.Node>): ts.Expression | null | undefined {
    const binding = bindingFor(node);
    if (!binding) return undefined;
    if (seen.has(binding) || reassigned.has(binding)) return null;
    seen.add(binding);
    return ts.isEnumDeclaration(binding) ? undefined : binding.initializer;
  }
  function stringName(node: ts.Expression, seen = new Set<ts.Node>()): string | undefined {
    const expression = unwrap(node);
    if (ts.isStringLiteralLike(expression)) return expression.text;
    const value = ts.isIdentifier(expression) ? initializer(expression, seen) : memberValue(expression, seen);
    return value ? stringName(value, seen) : undefined;
  }
  function objectValue(node: ts.Expression, seen: Set<ts.Node>): ts.ObjectLiteralExpression | null | undefined {
    const expression = unwrap(node);
    if (ts.isObjectLiteralExpression(expression))
      return expression.properties.some(ts.isSpreadAssignment) ? null : expression;
    if (!ts.isIdentifier(expression)) return undefined;
    const value = initializer(expression, seen);
    if (value === null) return null;
    return value ? objectValue(value, seen) : undefined;
  }
  function enumMemberValue(binding: ts.EnumDeclaration, name: string | undefined, seen: Set<ts.Node>) {
    const member = binding.members.find((member) => literalName(member.name) === name);
    if (!member || seen.has(member)) return null;
    seen.add(member);
    return member.initializer;
  }
  function memberValue(node: ts.Expression, seen: Set<ts.Node>): ts.Expression | null | undefined {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return undefined;
    const name = ts.isPropertyAccessExpression(node) ? node.name.text : stringName(node.argumentExpression, seen);
    const binding = ts.isIdentifier(node.expression) && bindingFor(node.expression);
    if (binding && ts.isEnumDeclaration(binding)) return enumMemberValue(binding, name, seen);
    const object = objectValue(node.expression, seen);
    if (object === null) return null;
    const property = object?.properties.find((property) => property.name && literalName(property.name) === name);
    if (object && (!property || !ts.isPropertyAssignment(property))) return null;
    return property && ts.isPropertyAssignment(property) ? property.initializer : undefined;
  }
  function coercedValue(node: ts.Expression): ts.Expression | undefined {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'String')
      return node.arguments.length === 1 ? node.arguments[0] : undefined;
    if (ts.isTemplateExpression(node) && node.head.text === '' && node.templateSpans.length === 1) {
      const span = node.templateSpans[0];
      if (span && span.literal.text === '') return span.expression;
    }
    return undefined;
  }
  function unsafeChannelReceiver(node: ts.Expression): boolean {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return false;
    let unsafe = false;
    function visit(receiver: ts.Node): void {
      if (
        (ts.isIdentifier(receiver) || ts.isStringLiteralLike(receiver)) &&
        ['harness', 'provider', 'clientId'].includes(receiver.text)
      )
        unsafe = true;
      ts.forEachChild(receiver, visit);
    }
    visit(node.expression);
    return unsafe;
  }
  function bindingName(expression: ts.Identifier, seen: Set<ts.Node>, unwrapReceivers: boolean): string {
    const binding = bindingFor(expression);
    if (binding && reassigned.has(binding)) return '';
    if (binding && ts.isBindingElement(binding) && ts.isArrayBindingPattern(binding.parent)) return '';
    if (binding && ts.isBindingElement(binding)) return literalName(binding.propertyName ?? binding.name) ?? '';
    const value = initializer(expression, seen);
    if (value === null) return '';
    return value ? discriminantName(value, seen, unwrapReceivers) : expression.text;
  }
  function discriminantName(node: ts.Expression, seen = new Set<ts.Node>(), unwrapReceivers = true): string {
    const expression = unwrap(node);
    if (ts.isIdentifier(expression)) return bindingName(expression, seen, unwrapReceivers);
    const coerced = unwrapReceivers && coercedValue(expression);
    if (coerced) return discriminantName(coerced, seen, unwrapReceivers);
    if (unwrapReceivers && ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression))
      return discriminantName(expression.expression.expression, seen);
    const member = memberValue(expression, seen);
    if (member === null || (!unwrapReceivers && unsafeChannelReceiver(expression))) return '';
    if (member) return discriminantName(member, seen, unwrapReceivers);
    return baselineDiscriminantName(expression);
  }
  function isChannel(node: ts.Expression): boolean {
    return ['channel', 'channelType'].includes(discriminantName(node, new Set(), false));
  }
  function isProvider(node: ts.Expression): boolean {
    // Provider-keyed handler maps are also provider discriminants for `in`/call rules.
    return /^provider/i.test(discriminantName(node));
  }
  const found: string[] = [];
  function deny(name: string | undefined, against: ts.Expression): boolean {
    if (!name) return false;
    if (isForbiddenName(name)) {
      // Only actual channel types may gain the channel exception (currently Hermes).
      return !(channelException && CHANNEL_HARNESS_OVERLAP.has(name) && isChannel(against));
    }
    return discriminantName(against) === 'provider' && EXTERNAL_PROVIDERS.includes(name);
  }
  function mapKeys(node: ts.Expression): string[] {
    const expression = unwrap(node);
    if (!ts.isArrayLiteralExpression(expression)) return [];
    return expression.elements.flatMap((entry) => {
      if (!ts.isArrayLiteralExpression(entry) || !entry.elements[0]) return [];
      const name = stringName(entry.elements[0]);
      return name ? [name] : [];
    });
  }
  function collectionNames(node: ts.Expression, seen = new Set<ts.Node>()): string[] {
    const expression = unwrap(node);
    if (ts.isArrayLiteralExpression(expression))
      return expression.elements.flatMap((element) => {
        const name = stringName(element);
        return name ? [name] : [];
      });
    if (
      ts.isNewExpression(expression) &&
      ts.isIdentifier(expression.expression) &&
      ['Set', 'Map'].includes(expression.expression.text)
    ) {
      if (expression.expression.text === 'Map') return expression.arguments?.flatMap(mapKeys) ?? [];
      return expression.arguments?.flatMap((argument) => collectionNames(argument, seen)) ?? [];
    }
    if (ts.isObjectLiteralExpression(expression))
      return expression.properties.flatMap((property) => {
        const name = property.name && literalName(property.name);
        return name ? [name] : [];
      });
    if (ts.isIdentifier(expression)) {
      const value = initializer(expression, seen);
      return value ? collectionNames(value, seen) : [];
    }
    return [];
  }
  function comparisonDenied(node: ts.Node): boolean {
    return (
      ts.isBinaryExpression(node) &&
      comparisons.has(node.operatorToken.kind) &&
      (deny(stringName(node.left), node.right) || deny(stringName(node.right), node.left))
    );
  }
  function switchDenied(node: ts.Node): boolean {
    return (
      ts.isSwitchStatement(node) &&
      node.caseBlock.clauses.some(
        (clause) => ts.isCaseClause(clause) && deny(stringName(clause.expression), node.expression),
      )
    );
  }
  function membershipTargets(argument: ts.Expression): ts.Expression[] {
    const targets = [argument];
    if (!ts.isArrowFunction(argument) && !ts.isFunctionExpression(argument)) return targets;
    function visit(node: ts.Node): void {
      if (ts.isBinaryExpression(node) && comparisons.has(node.operatorToken.kind)) targets.push(node.left, node.right);
      ts.forEachChild(node, visit);
    }
    visit(argument.body);
    return targets;
  }
  function membershipDenied(node: ts.Node): boolean {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !['includes', 'has', 'get', 'indexOf', 'lastIndexOf', 'some', 'find'].includes(node.expression.name.text)
    )
      return false;
    const argument = node.arguments[0];
    if (!argument) return false;
    const targets = membershipTargets(argument);
    return collectionNames(node.expression.expression).some((name) => targets.some((target) => deny(name, target)));
  }
  function lookupDenied(node: ts.Node): boolean {
    if (!ts.isElementAccessExpression(node)) return false;
    const key = node.argumentExpression;
    const name = stringName(key);
    return (
      deny(name, node.expression) ||
      (!!name && isProvider(node.expression) && EXTERNAL_PROVIDERS.includes(name)) ||
      collectionNames(node.expression).some((name) => deny(name, key))
    );
  }
  function callDenied(node: ts.Node): boolean {
    if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
    const args = node.arguments ?? [];
    const receiver = ts.isPropertyAccessExpression(node.expression) ? node.expression.expression : undefined;
    const provider = args.some(isProvider) || (!!receiver && isProvider(receiver));
    return args.some((argument) => {
      const name = stringName(argument);
      return !!name && (isForbiddenName(name) || (provider && EXTERNAL_PROVIDERS.includes(name)));
    });
  }
  function inDenied(node: ts.Node): boolean {
    if (!ts.isBinaryExpression(node) || node.operatorToken.kind !== ts.SyntaxKind.InKeyword) return false;
    const name = stringName(node.left);
    return !!name && (isForbiddenName(name) || (isProvider(node.right) && EXTERNAL_PROVIDERS.includes(name)));
  }
  function definitionNameDenied(node: ts.Node): boolean {
    if (!ts.isObjectLiteralElementLike(node) || !ts.isObjectLiteralExpression(node.parent)) return false;
    const name = node.name && literalName(node.name);
    return !!name && isForbiddenName(name) && !CHANNEL_HARNESS_OVERLAP.has(name.toLowerCase());
  }
  function propertyDenied(node: ts.PropertyAccessExpression): boolean {
    // HERMES constants may hold a real channel literal; its dispatch is checked at use.
    const overlapConstant =
      CHANNEL_HARNESS_OVERLAP.has(node.name.text.toLowerCase()) && CHANNEL_HARNESS_OVERLAP.has(stringName(node) ?? '');
    return (
      (isForbiddenName(node.name.text) && !overlapConstant) ||
      (isProvider(node.expression) && EXTERNAL_PROVIDERS.includes(node.name.text))
    );
  }
  function syntaxDenied(node: ts.Node): boolean {
    if (ts.isRegularExpressionLiteral(node))
      return [...forbiddenNames].some((name) => node.text.toLowerCase().includes(name));
    if (ts.isPropertyAccessExpression(node)) return propertyDenied(node);
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const name = stringName(node.right);
      return !!name && isForbiddenName(name);
    }
    if (!(ts.isVariableDeclaration(node) || ts.isEnumMember(node) || ts.isPropertyAssignment(node))) return false;
    const name = node.initializer && stringName(node.initializer);
    // Overlap literals may define a channel constant; dispatch is checked at its use.
    return !!name && isForbiddenName(name) && !CHANNEL_HARNESS_OVERLAP.has(name);
  }
  function visit(node: ts.Node): void {
    if (
      [
        comparisonDenied,
        switchDenied,
        membershipDenied,
        lookupDenied,
        callDenied,
        inDenied,
        syntaxDenied,
        definitionNameDenied,
      ].some((check) => check(node))
    )
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
  // F1: a channel-shaped name cannot exempt a non-channel harness literal.
  "const channel = agent.harness; channel === 'codex'",
  "const { harness: channel } = agent; channel === 'codex'",
  "const channel = agent.harness; switch (channel) { case 'codex': break; }",
  "const x = { channel: agent.harness }; x.channel === 'codex'",
  "function f(channelType: string) { return channelType === 'codex'; } f(agent.harness)",
  "agent['channel'] === 'codex'",
  "['codex'].includes(instance.channel)",
  '({ codex: fn }[instance.channel])',
  // Hermes proves binding resolution independently of the overlap restriction.
  "const channel = agent.harness; channel === 'hermes'",
  "const { harness: channel } = agent; channel === 'hermes'",
  "const channelType = agent.harness; switch (channelType) { case 'hermes': break; }",
  "const x = { channel: agent.harness }; x.channel === 'hermes'",
  "const channel = agent['harness']; channel === 'hermes'",
  "const h = agent.harness; const channel = h; channel === 'hermes'",
  "instance.channel.toLowerCase() === 'hermes'",
  "const channel = instance.channel.toLowerCase(); channel === 'hermes'",
  "function a() { const channel = instance.channel; } function b() { const channel = agent.harness; return channel === 'hermes'; }",
  // F2: call/in/regex/property/initializer and expanded collection coverage is NEW,
  // not parity with the independent original equality/switch checker below.
  "Object.is(agent.harness, 'codex')",
  "Object.is('codex', h)",
  "Object.is(clientId, 'omni-cli')",
  "['codex'].indexOf(h) >= 0",
  "['codex'].lastIndexOf(h) !== -1",
  "['codex'].some((n) => n === h)",
  "['codex'].find((n) => n === h)",
  "handlers.get('codex')",
  "handlers.has('codex')",
  "new Map([['codex', fn]]).get(h)",
  "const M = new Map([['codex', fn]]); M.get(h)",
  "'codex' in handlers",
  "Object.hasOwn(handlers, 'codex')",
  'MAP.codex()',
  'const MAP = { codex: fn }; MAP.codex()',
  "h.startsWith('codex')",
  "h.endsWith('codex')",
  "h.localeCompare('codex') === 0",
  '/^codex$/.test(h)',
  'h.match(/codex/)',
  "new RegExp('codex').test(h)",
  "isHarness(h, 'codex')",
  "eq(agent.harness, 'codex')",
  "const CODEX = 'codex'; h === CODEX",
  "const HARNESS = { CODEX: 'codex' } as const; h === HARNESS.CODEX",
  "enum Harness { Codex = 'codex' } h === Harness.Codex",
  "const DSH = 'omni-dsh'; clientId === DSH",
  "const CODEX = 'codex'; switch (h) { case CODEX: break; }",
  // Every new default-deny syntax rule also covers device-client keys.
  "new Client('omni-cli')",
  "'omni-dsh' in handlers",
  '/omni-cli/.test(clientId)',
  'MAP.unfold()',
  "const client = { id: 'omni-cli' }",
  "enum Client { Dsh = 'omni-dsh' }",
  // F3: provider aliases, receiver normalization, literal constants and wrappers.
  "const p = agent.provider; p === 'openai'",
  "const { provider: p } = agent; p === 'claude'",
  "function f({ provider: kind }: A) { return kind === 'agno'; }",
  "const p = agent.provider; switch (p) { case 'agno': break; }",
  'const p = agent.provider; ({ claude: fn }[p])',
  "agent.provider.toLowerCase() === 'claude'",
  "agent.provider.startsWith('claude')",
  "Object.is(agent.provider, 'openai')",
  "['claude'].indexOf(agent.provider) !== -1",
  "'claude' in providerHandlers",
  "const CLAUDE = 'claude'; agent.provider === CLAUDE",
  "agent.provider === ('claude' satisfies string)",
  "agent.provider === <string>'claude'",
  "const p = agent.provider; const q = p; q === 'claude'",
  "Object.is('claude', agent.provider.toLowerCase())",
  "const p = agent.provider; p.startsWith('agno')",
  "const p = agent.provider; ['claude'].lastIndexOf(p) !== -1",
  "['claude'].some((n) => n === agent.provider)",
  "['claude'].find((n) => n === agent.provider)",
  "new Map([['claude', fn]]).get(agent.provider)",
  "const M = new Map([['openai', fn]]); M.get(agent.provider)",
  // Existing matrix controls: optional access, reversed comparisons and literal maps.
  "'codex' === agent.harness",
  "switch (true) { case h === 'codex': break; }",
  "agent?.harness === 'codex'",
  "agent?.['harness'] === 'codex'",
  "agent?.provider === 'claude'",
  'h === `codex`',
  'agent.provider === `claude`',
  "agent.provider === 'openai' ? a : b",
  "const S = new Set(['codex']); S.has(h)",
  "['claude', 'openai'].includes(agent.provider)",
  'const R: Record<string, F> = { codex: fn }; R[h]',
  "const MAP = { 'claude-code': fn }; MAP[h]",
  '({ claude: fn }[agent.provider])',
  "const { harness: h } = agent; h === 'codex'",
  "const { provider } = agent; provider === 'claude'",
  "const isCodex = (x: string) => x === 'codex'; isCodex(h)",
  "instance.channel === 'omni-dsh'",
  "instance.subchannel === 'codex'",
  "getChannel() === 'codex'",
  // G1: overlap constants must be resolved at the use, not exempt harness dispatch.
  "const HARNESS = { HERMES: 'hermes' } as const; agent.harness === HARNESS.HERMES",
  "const HARNESS = { HERMES: 'hermes' } as const; switch (agent.harness) { case HARNESS.HERMES: break; }",
  "enum Harness { Hermes = 'hermes' } switch (agent.harness) { case Harness.Hermes: break; }",
  "const config = { defaultChannel: 'hermes' }; agent.harness === config.defaultChannel",
  "enum C { H = 'hermes' } agent.harness === C.H",
  "let H = 'hermes'; agent.harness === H",
  "var H = 'hermes'; agent.harness === H",
  "const HARNESS = { HERMES: 'hermes' }; agent.harness === HARNESS['HERMES']",
  "enum Harness { Hermes = 'hermes' } agent.harness === Harness['Hermes']",
  // G2: map definitions deny names even when dispatch contains no literal.
  "const HANDLERS = { 'claude-code': run }; Object.keys(HANDLERS).includes(agent.harness)",
  'const HANDLERS = { codex: runCodex, hermes: runHermes }; Object.entries(HANDLERS).find(([name]) => name === agent.harness)',
  'const H = { codex: fn }; Reflect.get(H, h)',
  "const H = { ['codex']: fn }; Object.entries(H).find(([k]) => k === h)",
  'const H = { codex() {} }; for (const [k, v] of Object.entries(H)) if (k === h) v()',
  'const codex = run; const H = { codex }; Object.keys(H).includes(h)',
  'const H = { get codex() { return fn; } }; Object.keys(H).includes(h)',
  'const H = { set codex(fn) {} }; Object.keys(H).includes(h)',
  "const H = { 'omni-cli': fn }; Object.keys(H).includes(clientId)",
  "const H = { ['omni-dsh']() {} }; Object.entries(H)",
  // G3: writes, positional bindings and object spreads cannot certify a channel.
  "let channel = x.channel; channel = agent.harness; channel === 'hermes'",
  "let channel; channel = agent.harness; channel === 'hermes'",
  "let channel = x.channel; channel += agent.harness; channel === 'hermes'",
  "let channel = x.channel; ++channel; channel === 'hermes'",
  "let channel = x.channel; channel--; channel === 'hermes'",
  "const [channel] = [agent.harness]; channel === 'hermes'",
  "const x = { channel: i.channel, ...{ channel: agent.harness } }; x.channel === 'hermes'",
  "const x = { ...{ channel: agent.harness } }; x.channel === 'hermes'",
  // Optional G3.4: a channel member off a harness/provider/client is not channel dispatch.
  "agent.harness.channel === 'hermes'",
  "getChannel(agent.harness).channel === 'hermes'",
  "agent.provider.channel === 'hermes'",
  "clientId.channelType === 'hermes'",
  "agent['harness'].channel === 'hermes'",
  // G4: assignments, case-insensitive names/regexes and provider coercions.
  "let H; H = 'codex'; h === H",
  '/CODEX/i.test(h)',
  "clientId.toUpperCase() === 'OMNI-DSH'",
  "Object.is(h, 'CODEX')",
  'const H = { CODEX: fn }; Object.keys(H)',
  "String(agent.provider) === 'claude'",
  "`${agent.provider}` === 'claude'",
  // Optional G4: external-provider members are denied only on provider receivers.
  'providerHandlers.claude()',
  "PROVIDERS['claude']",
  'const p = agent.provider; p.claude()',
];
const channelFixtures = [
  "instance.channel === 'hermes'",
  "switch (instance.channel) { case 'hermes': break; }",
  "input.channelType !== 'hermes'",
  "const channel = instance.channel; channel === 'hermes'",
  "const { channel: ch } = instance; ch === 'hermes'",
  "const { channelType: ch } = input; switch (ch) { case 'hermes': break; }",
  "const ch = instance['channel']; ch === 'hermes'",
  "const c = instance.channel; const channelType = c; channelType === 'hermes'",
  "function a() { const channel = agent.harness; } function b() { const channel = instance.channel; return channel === 'hermes'; }",
  "const HARNESS = { HERMES: 'hermes' } as const; instance.channel === HARNESS.HERMES",
  '({ hermes: fn }[instance.channel])',
  "enum Channel { Hermes = 'hermes' } input.channelType === Channel.Hermes",
  "let H = 'hermes'; instance.channel === H",
  "var H = 'hermes'; instance.channel === H",
  "let channel = instance.channel; function f() { let channel = agent.harness; channel = agent.harness; } channel === 'hermes'",
];
const passingFixtures = [
  "agent.provider === 'paired'",
  'AgentSystemSchema.options.includes(p)',
  "const type = 'custom.agent.reply'",
  "switch (agent.provider) { case 'paired': break; }",
  "// agent.provider === 'claude'\nconst event = 'custom.agent.reply'",
  "const DEFAULT_CHANNEL = 'hermes'",
  "enum Channel { Default = 'hermes' }",
  "const config = { defaultChannel: 'hermes' }",
  "instance.channel === 'claude'",
  'HANDLERS.find((x) => x.name === h)',
  // Documented semantic residuals; the guard does not infer getter/field meaning.
  "getProvider(agent) === 'claude'",
  "agent.config.providerName === 'claude'",
  'config.custom',
  // The exempt Hermes definition has no literal at the Object.entries dispatch.
  'const H = { hermes: fn }; Object.entries(H).find(([name]) => name === agent.harness)',
];
test('C12 channel exception uses the actual channel/harness overlap', () => {
  expect([...CHANNEL_HARNESS_OVERLAP]).toEqual(['hermes']);
});
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
    expect(baselineRejected && !newRejected).toBe(baselineRejected && channelFixtures.includes(source));
  });
