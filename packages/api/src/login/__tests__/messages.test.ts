import { describe, expect, test } from 'bun:test';
import { deviceApprovedMessage, loginCodeMessage } from '../messages';

describe('self-chat messages', () => {
  test('a login code sits alone on its line', () => {
    const lines = loginCodeMessage('482913', 5).split('\n');
    expect(lines).toContain('482913');
    expect(lines.join('\n')).toContain('5 minutes');
  });

  test('an approval names the device, where and when it asked, and how to revoke it', () => {
    const at = Date.UTC(2026, 9, 21, 2, 16);
    const text = deviceApprovedMessage('the Automagik app', { ip: '203.0.113.7', at });
    expect(text).toContain('The Automagik app is now connected to your Omni.');
    expect(text).toContain('_It asked from 203.0.113.7 at 02:16 UTC._');
    expect(text).toContain('*Keys*');
  });

  test('an approval without a recorded request leaves the where and when out', () => {
    expect(deviceApprovedMessage('A device')).not.toContain('It asked');
  });
});
