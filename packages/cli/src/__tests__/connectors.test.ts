import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const CLI = join(import.meta.dir, '..', 'index.ts');

function help(args: string[]): string {
  const result = Bun.spawnSync({
    cmd: [process.execPath, CLI, ...args, '--help'],
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return `${result.stdout.toString()}\n${result.stderr.toString()}`;
}

describe('omni connectors --help', () => {
  test('lists the command group and its subcommands', () => {
    const output = help(['connectors']);
    for (const command of [
      'list',
      'get',
      'providers',
      'create',
      'update',
      'delete',
      'subscriptions',
      'test',
      'invoke',
    ]) {
      expect(output).toContain(command);
    }
  });

  test('subscriptions help lists add/pause/resume/rm', () => {
    const output = help(['connectors', 'subscriptions']);
    for (const command of ['list', 'add', 'pause', 'resume', 'rm']) expect(output).toContain(command);
  });

  test('create documents the provider/token/credential options', () => {
    const output = help(['connectors', 'create']);
    expect(output).toContain('--provider');
    expect(output).toContain('--credentials-json');
  });
});
