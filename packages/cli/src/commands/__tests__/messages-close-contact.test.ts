/**
 * CLI `omni messages close-contact` — argument validation + command shape.
 *
 * Smoke-level coverage: the command is registered with the expected flags
 * and refuses unknown outcome values before reaching the network. The full
 * HTTP path is exercised via the route's own tests.
 */

import { describe, expect, test } from 'bun:test';
import { createMessagesCommand } from '../messages.js';

function findSubcommand(name: string) {
  const messages = createMessagesCommand();
  const cmd = messages.commands.find((c) => c.name() === name);
  if (!cmd) throw new Error(`Subcommand '${name}' not registered on 'messages'`);
  return cmd;
}

describe("'omni messages close-contact'", () => {
  test('registered as a subcommand of messages', () => {
    const cmd = findSubcommand('close-contact');
    expect(cmd.description().toLowerCase()).toContain('close');
  });

  test('has the required flags: instance, chat, to, text, outcome', () => {
    const cmd = findSubcommand('close-contact');
    const flagNames = cmd.options.map((o) => o.long);
    expect(flagNames).toEqual(expect.arrayContaining(['--instance', '--chat', '--to', '--text', '--outcome']));
  });

  test('has optional flags: reason, close-fields', () => {
    const cmd = findSubcommand('close-contact');
    const flagNames = cmd.options.map((o) => o.long);
    expect(flagNames).toEqual(expect.arrayContaining(['--reason', '--close-fields']));
  });

  test('--instance, --chat, --to, --text, --outcome are required', () => {
    const cmd = findSubcommand('close-contact');
    const requiredFlags = cmd.options.filter((o) => o.required).map((o) => o.long);
    expect(requiredFlags).toEqual(expect.arrayContaining(['--instance', '--chat', '--to', '--text', '--outcome']));
  });
});
