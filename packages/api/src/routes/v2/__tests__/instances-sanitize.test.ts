/**
 * Instance response redaction (#1413).
 *
 * `sanitizeInstance` is the single point that strips credential columns from
 * `GET /instances`, so it is exported for this probe. A ClickUp personal API
 * token must never reach a response, while the numeric team/list ids stay
 * readable (they are identifiers, not secrets).
 */

import { describe, expect, test } from 'bun:test';
import { sanitizeInstance } from '../instances';

describe('sanitizeInstance — ClickUp credentials', () => {
  test('drops clickupApiToken and every occurrence of the secret, keeping the ids', () => {
    const row = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'ClickUp tasks',
      channel: 'clickup',
      clickupApiToken: 'pk_secret',
      clickupTeamId: '901234',
      clickupListId: '567890',
    };

    const sanitized = sanitizeInstance(row) as Record<string, unknown>;

    expect(sanitized.clickupApiToken).toBeUndefined();
    expect(JSON.stringify(sanitized)).not.toContain('pk_secret');
    expect(sanitized.clickupTeamId).toBe('901234');
    expect(sanitized.clickupListId).toBe('567890');
  });
});
