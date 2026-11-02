import { describe, expect, test } from 'bun:test';
import { assertNoLeakedTestDaemons } from './pm2-leak-guard';

const OWN_HOME = '/tmp/.omni-test-own/.pm2';
const OTHER_HOME = '/tmp/.omni-test-other/.pm2';
const daemon = (pid: number, home: string) => `  ${pid} PM2 v6.0.14: God Daemon (${home})`;

describe('CLI fixture PM2 leak guard', () => {
  test('another concurrent run does not fail this run', () => {
    expect(() => assertNoLeakedTestDaemons(OWN_HOME, daemon(201, OTHER_HOME))).not.toThrow();
  });

  test('an owned leak still fails, naming only its PIDs and home', () => {
    const snapshot = [daemon(201, OTHER_HOME), daemon(101, OWN_HOME), daemon(102, OWN_HOME)].join('\n');
    expect(() => assertNoLeakedTestDaemons(OWN_HOME, snapshot)).toThrow('2 stale PM2 god daemon(s)');
    try {
      assertNoLeakedTestDaemons(OWN_HOME, snapshot);
    } catch (error) {
      expect(String(error)).toContain(OWN_HOME);
      expect(String(error)).toContain('kill 101 102');
      expect(String(error)).not.toContain(OTHER_HOME);
      expect(String(error)).not.toContain('201');
    }
  });

  test('does not depend on the fixture directory or pid file surviving teardown', () => {
    // Only the process table is consulted: a removed PM2_HOME cannot hide a leak.
    expect(() =>
      assertNoLeakedTestDaemons('/tmp/.omni-test-deleted/.pm2', daemon(101, '/tmp/.omni-test-deleted/.pm2')),
    ).toThrow('1 stale PM2 god daemon(s)');
  });

  test('neighboring directories and shared host daemons are not owned', () => {
    const snapshot = [daemon(201, `${OWN_HOME}-other`), daemon(202, '/home/user/.pm2')].join('\n');
    expect(() => assertNoLeakedTestDaemons(OWN_HOME, snapshot)).not.toThrow();
  });

  test('matches an exact home containing spaces and parentheses', () => {
    const home = '/tmp/.omni-test-own (fixture)/.pm2';
    expect(() => assertNoLeakedTestDaemons(home, daemon(101, home))).toThrow('kill 101');
  });

  test('ignores commands that merely mention a daemon title', () => {
    const snapshot = `101 bun -e console.log('PM2 v6.0.14: God Daemon (${OWN_HOME})')`;
    expect(() => assertNoLeakedTestDaemons(OWN_HOME, snapshot)).not.toThrow();
    expect(() => assertNoLeakedTestDaemons(OWN_HOME, 'PID ARGS\n')).not.toThrow();
  });
});
