import { describe, expect, test } from 'bun:test';
import {
  type GenieRunner,
  type NatsTarget,
  discoverGenieAgent,
  normalizeNatsUrl,
  resolveConnectNatsUrl,
} from '../connect-preflight.js';
import { VERSION } from '../version.js';

function genie(overrides: Record<string, string> = {}) {
  const calls: string[][] = [];
  const replies: Record<string, string> = {
    '--version': '4.260404.2',
    '--help': 'Commands:\n  dir [options]    Agent directory\n',
    'dir --help': 'Commands:\n  ls [name]    List agents\n',
    'dir ls --help': 'Options:\n  --json    JSON output\n',
    'dir ls sample --json': '{"name":"sample","dir":"/agents/sample"}',
    ...overrides,
  };
  const run: GenieRunner = (args) => {
    calls.push(args);
    const reply = replies[args.join(' ')];
    if (reply === undefined) throw new Error('Unexpected command');
    return reply;
  };
  return { calls, run };
}

const target: NatsTarget = {
  apiUrl: 'http://127.0.0.1:18882',
  localApiUrl: 'http://localhost:18882/',
  serverName: 'default',
  configDir: '/isolated/config',
  defaultSandboxHome: '/other',
};
const metadata = (api = 18882, nats = 14222) => ({ schemaVersion: 1, ports: { api, nats } });

describe('Genie compatibility preflight', () => {
  test('Genie 6 fails with both versions and supported guidance, before removed commands', () => {
    const fixture = genie({
      '--version': '6.261015.3',
      '--help': 'Commands:\n  board    Board\n  config    Configuration\n  task    Tasks\n',
    });
    let message = '';
    try {
      discoverGenieAgent('sample', fixture.run);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(VERSION);
    expect(message).toContain('6.261015.3');
    expect(message).toContain('genie --help');
    expect(message).not.toMatch(/genie (dir add|serve|omni start)/);
    expect(fixture.calls).toEqual([['--version'], ['--help']]);
  });
  test.each(['4.260404.2', 'genie v4.260404.2-rc.1', 'Genie CLI 4.260404.2+build.1'])(
    'accepts a positively advertised JSON interface with version %s',
    (version) => {
      const fixture = genie({ '--version': version });
      expect(discoverGenieAgent('sample', fixture.run)).toEqual({ name: 'sample', dir: '/agents/sample' });
      expect(fixture.calls.at(-1)).toEqual(['dir', 'ls', 'sample', '--json']);
    },
  );
  test.each([
    { '--version': 'not a version' },
    { '--help': 'The old dir command was removed.' },
    { 'dir --help': 'Commands:\n  add    Add\n' },
    { 'dir ls --help': 'Options:\n  --verbose    Log\n' },
    { 'dir ls sample --json': '[]' },
    { 'dir ls sample --json': '{"name":"sample","dir":""}' },
    { 'dir ls sample --json': '{"name":"other","dir":"/agents/other"}' },
    { 'dir ls sample --json': 'invalid json' },
  ])('rejects unverified interfaces or malformed/mismatched external JSON %j', (replies) => {
    expect(() => discoverGenieAgent('sample', genie(replies).run)).toThrow();
  });
  test.each(['ENOENT', 'ETIMEDOUT', 'ENOBUFS'])('handles probe failure %s actionably', (failure) => {
    expect(() =>
      discoverGenieAgent('sample', () => {
        throw new Error(failure);
      }),
    ).toThrow('genie --version');
  });
  test('does not interpret a requested agent name as directory options', () => {
    const fixture = genie();
    expect(() => discoverGenieAgent('--help', fixture.run)).toThrow('could not resolve');
    expect(fixture.calls.at(-1)).toEqual(['dir', 'ls', '--help']);
  });
});

describe('target-bound NATS defaults', () => {
  test.each([14222, 14223])('uses recorded sandbox port %i rather than a preferred constant', (port) => {
    const paths: string[] = [];
    expect(
      resolveConnectNatsUrl(undefined, target, (path) => {
        paths.push(path);
        return metadata(18882, port);
      }),
    ).toBe(`nats://127.0.0.1:${port}`);
    expect(paths).toContain('/isolated/sandbox.json');
  });
  test.each(['broker:14222', 'nats://broker:14222'])('override %s bypasses remote/local metadata', (url) => {
    expect(
      resolveConnectNatsUrl(url, { ...target, serverName: 'remote' }, () => {
        throw new Error('Must not read');
      }),
    ).toBe('nats://broker:14222');
  });
  test.each([
    { serverName: 'remote' },
    { apiUrl: 'http://remote.example:18882', localApiUrl: 'http://remote.example:18882' },
    { localApiUrl: 'http://localhost:8882' },
    { apiUrl: 'http://localhost:18882/prefix' },
    { apiUrl: 'https://localhost:18882', localApiUrl: 'https://localhost:18882' },
  ])('does not read local metadata for an unbound target %j', (changes) => {
    let reads = 0;
    expect(() =>
      resolveConnectNatsUrl(undefined, { ...target, ...changes }, () => {
        reads++;
        return metadata();
      }),
    ).toThrow('--nats-url');
    expect(reads).toBe(0);
  });
  test.each([metadata(18883), metadata(18882, 0), { ports: { api: 18882, nats: 14222 } }, null])(
    'rejects mismatched/invalid/versionless sandbox metadata %j',
    (value) => {
      expect(() => resolveConnectNatsUrl(undefined, target, () => value)).toThrow('--nats-url');
    },
  );
  test('missing/corrupt state fails for sandbox, but retains the standard local/dev default', () => {
    const missing = () => {
      throw new Error('ENOENT or invalid JSON');
    };
    expect(() => resolveConnectNatsUrl(undefined, target, missing)).toThrow('--nats-url');
    expect(
      resolveConnectNatsUrl(
        undefined,
        {
          ...target,
          configDir: '/isolated/.omni',
          apiUrl: 'http://localhost:8882',
          localApiUrl: 'http://127.0.0.1:8882',
        },
        missing,
      ),
    ).toBe('nats://localhost:4222');
    expect(() =>
      resolveConnectNatsUrl(
        undefined,
        { ...target, apiUrl: 'http://localhost:8882', localApiUrl: 'http://localhost:8882' },
        missing,
      ),
    ).toThrow('--nats-url');
  });
  test('explicit sandbox home and OMNI_HOME-derived home are both discovered', () => {
    for (const change of [{ sandboxHome: '/custom' }, { defaultSandboxHome: '/custom' }]) {
      expect(
        resolveConnectNatsUrl(undefined, { ...target, configDir: '/isolated/.omni', ...change }, (path) => {
          if (path !== '/custom/sandbox.json') throw new Error('Missing');
          return metadata();
        }),
      ).toBe('nats://127.0.0.1:14222');
    }
  });
  test('conflicting target-associated state requires an override', () => {
    expect(() =>
      resolveConnectNatsUrl(undefined, target, (path) => metadata(18882, path.startsWith('/isolated') ? 14222 : 14223)),
    ).toThrow('Conflicting');
  });
});

describe('NATS URL compatibility', () => {
  test.each([
    ['broker', 'nats://broker:4222'],
    ['nats://broker', 'nats://broker:4222'],
    ['broker:14222', 'nats://broker:14222'],
    ['nats://broker:14222', 'nats://broker:14222'],
    ['nats://[::1]:14222', 'nats://[::1]:14222'],
    ['tls://user:secret@broker', 'tls://user:secret@broker:4222'],
    ['nats://token@broker:4222', 'nats://token@broker:4222'],
    ['wss://broker/nats', 'wss://broker:443/nats'],
  ])('normalizes %s without losing transport/authentication', (input, expected) => {
    expect(normalizeNatsUrl(input)).toBe(expected);
  });
  test.each(['', 'https://broker:4222', 'nats://nats://broker:4222', 'broker:0', 'broker:65536', 'broker:4222/path'])(
    'rejects malformed or unsupported broker URL %s',
    (url) => {
      expect(() => normalizeNatsUrl(url)).toThrow();
    },
  );
});
