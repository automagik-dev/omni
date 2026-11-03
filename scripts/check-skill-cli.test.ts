import { beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CommandTree,
  checkExcerpt,
  checkMarkdown,
  checkScript,
  loadCommandTree,
  scanPluginFiles,
} from './check-skill-cli';

let tree: CommandTree;
beforeAll(async () => {
  const network = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Static check must not use the network'));
  try {
    tree = await loadCommandTree();
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});

describe('plugin commands against the registered CLI', () => {
  it.each([
    'omni events consumers inspect audit-log --json',
    'omni server rm old --help',
    'omni --server prod instances list --status connected --json',
    'omni events list --instance-ids abc --json',
    'omni send --text "omni fictional --stale" --to <chat>',
    String.raw`omni automations create --name "Bot" \
      --action-config '{"text":"--stale"}' --disabled`,
    'omni send --to <chat> --lat -23.55 # --stale is a comment',
    "omni events list --json | jq '--stale'; omni status --help",
    'omni <group> --help',
    'omni chats $ARGUMENTS',
    'omni auth login < /secure/key --api-key-stdin 2> /tmp/errors --json',
  ])('accepts %s', (command) => {
    expect(checkExcerpt(command, tree)).toEqual([]);
  });

  it.each([
    ['omni fictional --help', 'unknown command fictional'],
    ['omni events consumers fictional --json', 'unknown command fictional'],
    ['omni send --stale-1461=yes', 'unknown flag --stale-1461'],
    ['omni status --timeout 5', 'unknown flag --timeout'],
    ['omni auth login < /secure/key --stale-after-redirect', 'unknown flag --stale-after-redirect'],
    ['omni events list --json; omni auth login --stale-1461', 'unknown flag --stale-1461'],
  ])('rejects %s', (command, message) => {
    expect(
      checkExcerpt(command, tree)
        .map((error) => error.message)
        .join(),
    ).toContain(message);
  });

  it('reports source lines for inline, fenced, continued and plain commands', () => {
    const doc = [
      '# Commands',
      '`omni status --stale-one`',
      '```sh',
      'omni send --to <chat> \\',
      '  --stale-two',
      '```',
      'omni fictional',
      '',
    ].join('\n');
    expect(checkMarkdown(doc, tree).map((error) => error.line)).toEqual([2, 5, 7]);
  });

  it('checks hook commands and script argv arrays without treating logs as commands', () => {
    expect(checkScript('hook.json', '{"command":"omni status --stale"}', tree)).toHaveLength(1);
    const js = 'log("omni not found"); exec(omniPath, ["status", "--stale"]);';
    expect(checkScript('runner.js', js, tree).map((error) => error.message)).toEqual(['status: unknown flag --stale']);
  });
});

describe('skill gate edge cases (#1461)', () => {
  it('fails when zero plugin files are scanned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-skill-empty-'));
    try {
      expect(scanPluginFiles(dir, tree).errors).toContain('No plugin files scanned');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('fails when files exist but zero omni invocations resolve', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-skill-no-invocations-'));
    try {
      writeFileSync(join(dir, 'SKILL.md'), ['# Omni guide', '```bash', 'echo hello', '```'].join('\n'));
      writeFileSync(join(dir, 'hooks.json'), '{"hooks":{}}');
      expect(scanPluginFiles(dir, tree).errors).toContain('No omni commands checked');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('counts invocations once, excluding flag payloads and subcommand levels', () => {
    const counts = { invocations: 0 };
    checkExcerpt('omni send --text "omni fictional --stale"; omni events consumers inspect audit-log', tree, counts);
    expect(counts.invocations).toBe(2);
  });

  it.each([
    ['SKILL.md', '`omni status`\n```bash\nomni server list\n```', 2],
    ['SKILL.md', 'omni status', 1],
    ['SKILL.md', '```text\nomni status\n```', 0],
    ['hook.json', '{"command":"omni status"}', 1],
    ['runner.js', 'exec(omniPath, ["status"]);', 1],
    ['runner.sh', 'omni status; omni server list', 2],
  ])('sums resolved invocations from %s: %s', (name, content, expected) => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-skill-counts-'));
    try {
      writeFileSync(join(dir, name), content);
      expect(scanPluginFiles(dir, tree).invocations).toBe(expected);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it('fails when zero CLI commands are scanned', () => {
    const dir = mkdtempSync(join(tmpdir(), 'omni-skill-no-commands-'));
    try {
      writeFileSync(join(dir, 'SKILL.md'), '# Empty command tree');
      expect(scanPluginFiles(dir, { ...tree, commands: [] }).errors).toContain('No CLI commands scanned');
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it.each(['--no-color', '--all', '-V', '--version'])('rejects root-only %s after a subcommand', (flag) => {
    expect(checkExcerpt(`omni server list ${flag}`, tree).map((error) => error.message)).toContain(
      `list: unknown flag ${flag}`,
    );
    expect(checkExcerpt(`omni ${flag} server list`, tree)).toEqual([]);
  });

  it('keeps pre-parsed globals valid after a subcommand', () => {
    expect(checkExcerpt('omni server list --json --server prod', tree)).toEqual([]);
    expect(checkExcerpt('omni server list --server=prod --json', tree)).toEqual([]);
  });

  it('accepts 2>&1 without losing subsequent stale flags', () => {
    expect(checkExcerpt('omni instances list --json > out.json 2>&1', tree)).toEqual([]);
    expect(checkExcerpt('omni instances list 2>&1 --stale-1461', tree).map((error) => error.message)).toEqual([
      'list: unknown flag --stale-1461',
    ]);
  });

  it('accepts implicit omni help commands while checking the target', () => {
    expect(checkExcerpt('omni help film', tree)).toEqual([]);
    expect(checkExcerpt('omni help <cmd>', tree)).toEqual([]);
    expect(checkExcerpt('omni help fictional', tree).map((error) => error.message)).toEqual([
      'omni: unknown command fictional',
    ]);
  });

  it.each(['```', '~~~'])('ignores prose inside %stext fences, including inline code', (fence) => {
    const doc = [`${fence}text`, 'omni is the CLI used below', '`omni fictional`', fence].join('\n');
    expect(checkMarkdown(doc, tree)).toEqual([]);
  });

  it.each(['', 'sh', 'bash', 'shell', 'zsh', 'console'])('still checks %s shell fences', (language) => {
    const doc = [`\`\`\`${language}`, 'omni status --stale-1461', '```'].join('\n');
    expect(checkMarkdown(doc, tree)).toEqual([{ line: 2, message: 'status: unknown flag --stale-1461' }]);
  });
});
