/**
 * `omni instances create|update --history-identity/--sync-full-history` (#1211):
 * flags parse to the API body fields and --help states the defaults.
 */

import { describe, expect, test } from 'bun:test';
import { buildInstanceBody, createInstancesCommand } from '../instances';

function sub(name: string) {
  const cmd = createInstancesCommand().commands.find((c) => c.name() === name);
  if (!cmd) throw new Error(`missing ${name}`);
  return cmd;
}

function bodyFor(name: string, argv: string[]) {
  const cmd = sub(name);
  cmd.parseOptions(argv);
  return buildInstanceBody(cmd.opts());
}

describe('instances history identity flags (#1211)', () => {
  for (const name of ['create', 'update']) {
    test(`${name}: maps flags to historyIdentity/syncFullHistory`, () => {
      expect(bodyFor(name, ['--history-identity', 'web', '--sync-full-history'])).toMatchObject({
        historyIdentity: 'web',
        syncFullHistory: true,
      });
      expect(bodyFor(name, ['--no-sync-full-history'])).toMatchObject({ syncFullHistory: false });
    });

    test(`${name}: omitted flags send nothing`, () => {
      const body = bodyFor(name, []);
      expect(body).not.toHaveProperty('historyIdentity');
      expect(body).not.toHaveProperty('syncFullHistory');
    });

    test(`${name}: --help states defaults`, () => {
      const help = sub(name).helpInformation();
      expect(help).toContain('(default: desktop)');
      expect(help).toContain('(default: off)');
    });
  }

  test('rejects an invalid identity', () => {
    const cmd = sub('update')
      .exitOverride()
      .configureOutput({ writeErr: () => {} });
    expect(() => cmd.parseOptions(['--history-identity', 'linux'])).toThrow();
  });
});
