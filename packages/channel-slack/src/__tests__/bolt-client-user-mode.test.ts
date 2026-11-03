/** User-mode self-filtering requires the acting-user id (#889). */

import { describe, expect, it } from 'bun:test';
import { shouldSkipMessage } from '../handlers/messages';

describe('user-mode self-filtering (#889)', () => {
  it('documents the downstream harm: without the acting-user id, self-filtering no-ops', () => {
    // If start were allowed with actingUserId undefined, this is what happens:
    // the human's own typing (no bot_id, their own user id) is NOT skipped.
    const HUMAN = 'U0HUMAN';
    expect(shouldSkipMessage({ user: HUMAN }, ['U0BOT', undefined])).toBe(false);
    // With the id present, it is correctly skipped.
    expect(shouldSkipMessage({ user: HUMAN }, ['U0BOT', HUMAN])).toBe(true);
  });
});
