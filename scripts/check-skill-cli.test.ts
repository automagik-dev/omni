import { beforeAll, describe, expect, it, spyOn } from 'bun:test';
import { type CommandTree, checkExcerpt, checkMarkdown, checkScript, loadCommandTree } from './check-skill-cli';

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
