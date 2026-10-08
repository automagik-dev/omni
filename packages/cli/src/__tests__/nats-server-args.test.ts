/**
 * Managed nats-server argument tests
 *
 * The bind address reaches nats-server as a PM2 script argument and inside a
 * systemd `ExecStart=` line, so the schema is a security boundary: every
 * rejection below is load-bearing.
 */

import { describe, expect, test } from 'bun:test';
import { DEFAULT_NATS_HOST, NatsHostSchema, buildNatsServerArgs, resolveNatsHost } from '../nats-server-args.js';

describe('DEFAULT_NATS_HOST', () => {
  test('is loopback so a single-host install does not expose NATS', () => {
    expect(DEFAULT_NATS_HOST).toBe('127.0.0.1');
  });
});

describe('NatsHostSchema — accepted values', () => {
  const accepted = [
    '127.0.0.1',
    '0.0.0.0',
    '10.0.0.5',
    '::',
    '::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    'localhost',
    'nats.internal',
    'nats-1.example.com',
  ];
  for (const value of accepted) {
    test(`accepts ${value}`, () => {
      expect(NatsHostSchema.safeParse(value).success).toBe(true);
    });
  }
});

describe('NatsHostSchema — rejected values', () => {
  const rejected: Array<[string, string]> = [
    ['empty', ''],
    ['whitespace only', ' '],
    ['surrounding whitespace', ' 127.0.0.1 '],
    ['embedded space', '127.0.0.1 -p 1'],
    ['double quote', '"127.0.0.1"'],
    ['single quote', "'127.0.0.1'"],
    ['dollar (systemd/env expansion)', '$HOST'],
    ['percent (systemd specifier / IPv6 zone)', 'fe80::1%eth0'],
    ['backtick', '`id`'],
    ['semicolon', '127.0.0.1;id'],
    ['ampersand', '127.0.0.1&id'],
    ['pipe', '127.0.0.1|id'],
    ['newline', '127.0.0.1\nExecStartPre=/bin/id'],
    ['backslash', '127.0.0.1\\'],
    ['leading hyphen (argument injection)', '-js'],
    ['brackets', '[::1]'],
    ['host:port', '127.0.0.1:4222'],
    ['out-of-range IPv4', '999.1.1.1'],
    ['truncated IPv4', '10.0.0'],
    ['trailing dot', 'nats.internal.'],
    ['label with edge hyphen', 'nats-.internal'],
    ['label over 63 chars', `${'a'.repeat(64)}.internal`],
    ['over 253 chars', `${'a.'.repeat(127)}a`],
  ];
  for (const [label, value] of rejected) {
    test(`rejects ${label}`, () => {
      expect(NatsHostSchema.safeParse(value).success).toBe(false);
    });
  }

  test('rejects non-strings', () => {
    expect(NatsHostSchema.safeParse(4222).success).toBe(false);
    expect(NatsHostSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('resolveNatsHost', () => {
  test('falls back to the default when natsHost is absent (older configs)', () => {
    expect(resolveNatsHost({})).toBe(DEFAULT_NATS_HOST);
    expect(resolveNatsHost({ natsHost: undefined })).toBe(DEFAULT_NATS_HOST);
  });

  test('falls back to the default when config.json stores null', () => {
    expect(resolveNatsHost({ natsHost: null as unknown as string })).toBe(DEFAULT_NATS_HOST);
  });

  test('returns a configured IPv4, wildcard, IPv6 or hostname as-is', () => {
    expect(resolveNatsHost({ natsHost: '10.0.0.5' })).toBe('10.0.0.5');
    expect(resolveNatsHost({ natsHost: '0.0.0.0' })).toBe('0.0.0.0');
    expect(resolveNatsHost({ natsHost: '::' })).toBe('::');
    expect(resolveNatsHost({ natsHost: 'nats.internal' })).toBe('nats.internal');
  });

  test('throws an actionable error for an invalid stored value instead of falling back', () => {
    expect(() => resolveNatsHost({ natsHost: '0.0.0.0; rm -rf /' })).toThrow(/server\.natsHost/);
    expect(() => resolveNatsHost({ natsHost: '' })).toThrow('omni config set server.natsHost 127.0.0.1');
  });
});

describe('buildNatsServerArgs', () => {
  test('default host: exact JetStream + store dir + bind args', () => {
    expect(buildNatsServerArgs({ natsDataDir: '/data/nats', host: DEFAULT_NATS_HOST })).toEqual([
      '-js',
      '-sd',
      '/data/nats',
      '-a',
      '127.0.0.1',
    ]);
  });

  test('custom host is passed through after -a', () => {
    expect(buildNatsServerArgs({ natsDataDir: '/data/nats', host: '::' })).toEqual([
      '-js',
      '-sd',
      '/data/nats',
      '-a',
      '::',
    ]);
  });

  test('keeps the store dir as a single argument even when it contains spaces', () => {
    const args = buildNatsServerArgs({ natsDataDir: '/Users/a b/.omni/data/nats', host: '127.0.0.1' });
    expect(args.slice(0, 3)).toEqual(['-js', '-sd', '/Users/a b/.omni/data/nats']);
  });

  test('does not set a port: nats-server keeps its default 4222', () => {
    expect(buildNatsServerArgs({ natsDataDir: '/d', host: '127.0.0.1' })).not.toContain('-p');
  });

  test('re-validates the host so no caller can pass an unchecked value', () => {
    expect(() => buildNatsServerArgs({ natsDataDir: '/d', host: '127.0.0.1 -p 1' })).toThrow();
    expect(() => buildNatsServerArgs({ natsDataDir: '/d', host: '' })).toThrow();
  });
});
