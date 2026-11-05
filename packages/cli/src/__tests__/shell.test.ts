import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { quoteShellArg } from '../utils/shell';

describe('quoteShellArg', () => {
  test.each(['prod', 'default', 'prod-west_2', 'lab.example:8882', 'a@b/c+d=e,%'])('%s needs no quoting', (name) => {
    expect(quoteShellArg(name)).toBe(name);
  });

  test.each([
    '',
    'prod team',
    "team's",
    '$HOME',
    '$(printf expanded)',
    '`printf expanded`',
    '; printf extra',
    '*',
    'a\nb',
    'a"b',
    'a\\b',
    '团队',
  ])('round-trips %j as exactly one literal POSIX shell argument', (name) => {
    const quoted = quoteShellArg(name);
    expect(quoted.startsWith("'")).toBe(true);
    expect(execFileSync('/bin/sh', ['-c', `set -- ${quoted}; printf '%s\\0' "$@"`])).toEqual(Buffer.from(`${name}\0`));
  });
});
