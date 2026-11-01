import { describe, expect, test } from 'bun:test';
import { stripTerminalControls } from '../utils/terminal';

describe('stripTerminalControls', () => {
  test.each([
    ['8-bit OSC/ST', '\u009d0;title\u009cname', '0;titlename'],
    ['lone CSI', 'before\u009b', 'before'],
    ['NEL', 'before\u0085after', 'beforeafter'],
    ['RLO', 'before\u202eafter', 'beforeafter'],
    ['OSC terminated by ESC-backslash', '\u001b]0;title\u001b\\name', 'name'],
    ['all bidi controls', 'a\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069b', 'ab'],
    ['ordinary Unicode', 'café 日本 🚀', 'café 日本 🚀'],
  ])('%s', (_name, input, expected) => {
    expect(stripTerminalControls(input)).toBe(expected);
  });
});
