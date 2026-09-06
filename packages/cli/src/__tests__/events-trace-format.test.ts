/**
 * `omni events trace` line rendering (#957).
 */

import { describe, expect, test } from 'bun:test';
import { formatTraceLine } from '../commands/events.js';

const EVENT = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  eventType: 'custom.webhook.brain',
  receivedAt: '2026-09-06T12:34:56.000Z',
  causationId: null,
  metadata: { correlationId: 'cccccccc-0000-4000-8000-000000000009' },
  textContent: null,
};

describe('formatTraceLine', () => {
  test('renders type, short id, time, and short correlation', () => {
    const line = formatTraceLine(EVENT, '● ');
    expect(line).toBe('● custom.webhook.brain  aaaaaaaa  2026-09-06 12:34:56  corr=cccccccc');
  });

  test('appends truncated text content when present', () => {
    const line = formatTraceLine({ ...EVENT, textContent: 'hello world' }, '└─ ');
    expect(line).toContain('"hello world"');
    expect(line.startsWith('└─ ')).toBe(true);
  });

  test('renders a placeholder correlation when the row has none (pre-#957 rows)', () => {
    const line = formatTraceLine({ ...EVENT, metadata: null }, '● ');
    expect(line).toContain('corr=--------');
  });
});
