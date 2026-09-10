/**
 * `omni events types` table row rendering (#1075).
 */

import { describe, expect, test } from 'bun:test';
import { summarizeEventTypeRow } from '../commands/events.js';

const ROW = {
  eventType: 'message.received',
  count: 42,
  lastSeen: '2026-09-10T12:00:00.000Z',
  schemaVersion: 2,
  schemaEnabled: false,
  consumers: ['brain', 'audit'],
  automations: [],
};

describe('summarizeEventTypeRow', () => {
  test('renders schema version, disabled flag, and joined subscribers', () => {
    expect(summarizeEventTypeRow(ROW)).toEqual({
      type: 'message.received',
      count: 42,
      lastSeen: '2026-09-10T12:00:00.000Z',
      schema: 'v2 (disabled)',
      consumers: 'brain,audit',
      automations: '-',
    });
  });

  test('renders unregistered schema as none', () => {
    expect(summarizeEventTypeRow({ ...ROW, schemaVersion: null, schemaEnabled: null }).schema).toBe('none');
  });
});
