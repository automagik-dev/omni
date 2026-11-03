#!/usr/bin/env bun
/** Static documentation gate: construct CLI metadata, never parse argv or run actions. */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

interface CliOption {
  long?: string;
  short?: string;
  required: boolean;
  optional: boolean;
  preparsed?: boolean;
}
interface CommanderNode {
  name(): string;
  aliases(): string[];
  options: CliOption[];
  commands: CommanderNode[];
  registeredArguments: unknown[];
}
export interface CommandTree {
  name: string;
  aliases: string[];
  options: CliOption[];
  commands: CommandTree[];
  takesArguments: boolean;
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const help: CliOption = { long: '--help', short: '-h', required: false, optional: false };

/** Read the actual registered factories from index.ts, including hidden commands. */
export async function loadCommandTree(): Promise<CommandTree> {
  const entry = join(root, 'packages/cli/src/index.ts');
  const source = readFileSync(entry, 'utf8');
  const ast = ts.createSourceFile(entry, source, ts.ScriptTarget.Latest, true);
  const imports = new Map<string, { path: string; name: string }>();
  let registry: ts.ArrayLiteralExpression | undefined;
  for (const statement of ast.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        for (const binding of bindings.elements) {
          imports.set(binding.name.text, {
            path: statement.moduleSpecifier.text,
            name: binding.propertyName?.text ?? binding.name.text,
          });
        }
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          declaration.name.getText(ast) === 'COMMANDS' &&
          declaration.initializer &&
          ts.isArrayLiteralExpression(declaration.initializer)
        )
          registry = declaration.initializer;
      }
    }
  }
  if (!registry) throw new Error('Cannot find CLI COMMANDS registry; update the drift checker');
  const commands: CommandTree[] = [];
  for (const registration of registry.elements) {
    if (!ts.isObjectLiteralExpression(registration)) throw new Error('Unsupported CLI registration');
    const factory = registration.properties.find((p) => ts.isPropertyAssignment(p) && p.name.getText(ast) === 'create');
    if (!factory || !ts.isPropertyAssignment(factory) || !ts.isIdentifier(factory.initializer)) {
      throw new Error('Cannot resolve CLI command factory');
    }
    const imported = imports.get(factory.initializer.text);
    if (!imported) throw new Error(`Missing import for ${factory.initializer.text}`);
    const path = resolve(dirname(entry), imported.path.replace(/\.js$/, '.ts'));
    const module = await import(pathToFileURL(path).href);
    const create: () => CommanderNode = module[imported.name];
    commands.push(snapshot(create()));
  }
  const registryStart = registry.pos;
  const options: CliOption[] = [help];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['option', 'version'].includes(node.expression.name.text) &&
      node.expression.expression.getText(ast).startsWith('program')
    ) {
      const arg = node.arguments[node.expression.name.text === 'version' ? 1 : 0];
      if (arg && ts.isStringLiteral(arg)) {
        options.push({
          long: arg.text.match(/--[\w-]+/)?.[0],
          short: arg.text.match(/(?:^|[ ,])(-\w)\b/)?.[1],
          required: arg.text.includes('<'),
          optional: arg.text.includes('['),
        });
      }
    }
    // index.ts consumes JSON/server flags before Commander: read those declarations too.
    if (node.pos < registryStart && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteral(arg)) {
        if (
          node.expression.name.text === 'includes' &&
          node.expression.expression.getText(ast) === 'process.argv' &&
          /^--[\w-]+$/.test(arg.text)
        )
          options.push({ long: arg.text, required: false, optional: false, preparsed: true });
        if (node.expression.name.text === 'startsWith' && /^--[\w-]+=$/.test(arg.text)) {
          options.push({ long: arg.text.slice(0, -1), required: true, optional: false, preparsed: true });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { name: 'omni', aliases: [], commands, options, takesArguments: false };
}
function snapshot(command: CommanderNode): CommandTree {
  const options = [...command.options, help];
  // index.ts installs these hidden aliases after registering every factory.
  if (options.some((o) => o.long === '--instance' || o.long === '--instances')) {
    for (const long of ['--instance-ids', '--instances']) {
      if (!options.some((o) => o.long === long)) options.push({ long, required: true, optional: false });
    }
  }
  return {
    name: command.name(),
    aliases: command.aliases(),
    options,
    commands: command.commands.map(snapshot),
    takesArguments: command.registeredArguments.length > 0,
  };
}

interface Token {
  value: string;
  offset: number;
}
/** Shell words, preserving quoted JSON/strings, comments, redirects and continuations. No evaluation. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /\\\r?\n|#[^\n]*|<[^<>\s]+>|\d*[<>]{1,2}&?|(?:[^\s'";|&()<>\\]+|'[^']*'|"(?:\\.|[^"\\])*"|\\[^\n])+|[\n;|&()<>]/g;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    if (raw.startsWith('#') || raw.startsWith('\\\n') || raw.startsWith('\\\r\n')) continue;
    tokens.push({ value: raw.replace(/^(['"])([\s\S]*)\1$/, '$2'), offset: match.index });
  }
  return tokens;
}

/** Validate each command in an excerpt; flag values and positional arguments are not commands. */
export function checkExcerpt(text: string, tree: CommandTree): { offset: number; message: string }[] {
  const tokens = tokenize(text);
  const errors: { offset: number; message: string }[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i]?.value !== 'omni') continue;
    let command = tree;
    const ancestors = [tree];
    let positional = false;
    let seekingHelp = false;
    for (i++; i < tokens.length; i++) {
      const token = tokens[i];
      if (!token || /^[\n;|&()]$/.test(token.value)) break;
      if (/^\d*[<>]{1,2}&?$/.test(token.value)) {
        i++;
        continue;
      }
      const value = token.value;
      if (value.startsWith('-')) {
        const flag = value.split('=')[0];
        const option = ancestors
          .flatMap((c) => c.options.filter((o) => c !== tree || command === tree || o.preparsed))
          .find((o) => o.long === flag || o.short === flag);
        if (!option) errors.push({ offset: token.offset, message: `${command.name}: unknown flag ${flag}` });
        if (option && !value.includes('=') && (option.required || option.optional)) {
          const next = tokens[i + 1]?.value;
          if (next && !/^[\n;|&()<>]$/.test(next) && (!next.startsWith('-') || /^-\d/.test(next))) i++;
        }
      } else if (/^(<.*>|\[.*\]|\*|\.\.\.|\$[\w@]+)$/.test(value)) {
        positional = true;
      } else if (command === tree && value === 'help' && !positional && !seekingHelp) {
        // Commander adds root "help [command]" without registering it as a child.
        seekingHelp = true;
      } else {
        const child = command.commands.find((c) => c.name === value || c.aliases.includes(value));
        if (!positional && child) {
          command = child;
          ancestors.push(child);
        } else if (!positional && !command.takesArguments) {
          errors.push({ offset: token.offset, message: `${command.name}: unknown command ${value}` });
          break;
        } else positional = true;
      }
    }
  }
  return errors;
}

/** Check executable examples in fenced blocks and inline code; retain source offsets for errors. */
export function checkMarkdown(text: string, tree: CommandTree): { line: number; message: string }[] {
  const errors: { line: number; message: string }[] = [];
  const code = /^[ \t]*(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)^[ \t]*\1[ \t]*$|`([^`\n]+)`/gm;
  let uncovered = text;
  for (const match of text.matchAll(code)) {
    const excerpt = match[3] ?? match[4] ?? '';
    const start = match.index + match[0].indexOf(excerpt);
    uncovered =
      uncovered.slice(0, match.index) +
      match[0].replace(/[^\n]/g, ' ') +
      uncovered.slice(match.index + match[0].length);
    const language = match[2]?.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (match[1] && !['', 'sh', 'bash', 'shell', 'zsh', 'console'].includes(language)) continue;
    for (const error of checkExcerpt(excerpt, tree)) {
      errors.push({ line: text.slice(0, start + error.offset).split('\n').length, message: error.message });
    }
  }
  for (const match of uncovered.matchAll(/^[ \t]*(?:\$ )?omni(?:[ \t]+[^\n]*)?$/gm)) {
    for (const error of checkExcerpt(match[0], tree)) {
      errors.push({ line: text.slice(0, match.index + error.offset).split('\n').length, message: error.message });
    }
  }
  return errors;
}
/** Check literal shell commands and argv arrays in plugin hooks/scripts, not log messages. */
export function checkScript(file: string, text: string, tree: CommandTree): { line: number; message: string }[] {
  const errors: { line: number; message: string }[] = [];
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      const args = node.arguments[1];
      let excerpt: string | undefined;
      if (/^(exec|execSync|execFileSync|spawn|spawnSync)$/.test(node.expression.getText(ast))) {
        if (first && ts.isStringLiteralLike(first) && first.text.startsWith('omni ')) excerpt = first.text;
        if (
          first &&
          ['omniPath', "'omni'", '"omni"'].includes(first.getText(ast)) &&
          args &&
          ts.isArrayLiteralExpression(args) &&
          args.elements.every(ts.isStringLiteralLike)
        ) {
          excerpt = `omni ${args.elements.map((element) => JSON.stringify((element as ts.StringLiteral).text)).join(' ')}`;
        }
      }
      if (excerpt) {
        const line = ast.getLineAndCharacterOfPosition(node.getStart()).line + 1;
        errors.push(...checkExcerpt(excerpt, tree).map((error) => ({ line, message: error.message })));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (file.endsWith('.json')) {
    const visitJson = (value: unknown): void => {
      if (typeof value === 'string') {
        errors.push(...checkExcerpt(value, tree).map((error) => ({ line: 1, message: error.message })));
      } else if (value && typeof value === 'object') Object.values(value).forEach(visitJson);
    };
    visitJson(JSON.parse(text));
  }
  return errors;
}
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
export function scanPluginFiles(dir: string, tree: CommandTree): { count: number; errors: string[] } {
  let count = 0;
  const errors: string[] = [];
  for (const file of files(dir)) {
    const text = readFileSync(file, 'utf8');
    const problems = file.endsWith('.md')
      ? checkMarkdown(text, tree)
      : file.endsWith('.sh')
        ? checkExcerpt(text, tree).map((error) => ({
            line: text.slice(0, error.offset).split('\n').length,
            message: error.message,
          }))
        : checkScript(file, text, tree);
    count++;
    errors.push(...problems.map((p) => `${relative(root, file)}:${p.line}: ${p.message}`));
  }
  if (count === 0) errors.push('No plugin files scanned');
  if (tree.commands.length === 0) errors.push('No CLI commands scanned');
  return { count, errors };
}
async function main(): Promise<void> {
  const tree = await loadCommandTree();
  const { count, errors } = scanPluginFiles(join(root, 'plugins/omni'), tree);
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log(`Skill CLI drift check: ${count} files match ${tree.commands.length} registered command groups`);
}
if (import.meta.main) await main();
