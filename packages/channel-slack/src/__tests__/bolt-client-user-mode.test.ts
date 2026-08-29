/**
 * User-mode startup safety (#889).
 *
 * In user mode the acting-user id MUST be resolved before the app starts.
 * Self-filtering (shouldSkipMessage) compares the human's own typing against
 * the acting-user id; if that id is undefined the check silently no-ops and the
 * agent answers the operator's OWN messages — the exact failure the resolve was
 * added to prevent. So an unresolved acting-user id in user mode must FAIL FAST
 * rather than start the app in that broken state.
 */

import { describe, expect, it } from 'bun:test';
import type { BoltConnection } from '../connection/bolt-client';
import { startBoltConnection } from '../connection/bolt-client';
import { shouldSkipMessage } from '../handlers/messages';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop };

/** Build a minimal fake connection whose app.start() is observable. */
function makeConnection(overrides: Partial<BoltConnection> = {}): {
  conn: BoltConnection;
  started: () => number;
} {
  let startCount = 0;
  const conn = {
    app: {
      client: {
        auth: {
          test: async () => ({ user_id: 'U0BOT', user: 'bot', team_id: 'T1', team: 'team' }),
        },
      },
      start: async () => {
        startCount++;
      },
    },
    client: {},
    actingClient: {},
    botToken: 'xoxb-fake',
    mode: 'socket',
    ...overrides,
  } as unknown as BoltConnection;
  return { conn, started: () => startCount };
}

describe('startBoltConnection — user mode acting-user invariant', () => {
  it('throws (does not start) when the user token resolve fails', async () => {
    const { conn, started } = makeConnection({
      userClient: {
        auth: {
          test: async () => {
            throw new Error('invalid_auth');
          },
        },
      } as unknown as BoltConnection['userClient'],
    });

    await expect(startBoltConnection(conn, noopLogger as never)).rejects.toThrow();
    expect(started()).toBe(0);
  });

  it('throws (does not start) when the user token resolves without a user_id', async () => {
    const { conn, started } = makeConnection({
      userClient: {
        auth: { test: async () => ({ ok: true }) },
      } as unknown as BoltConnection['userClient'],
    });

    await expect(startBoltConnection(conn, noopLogger as never)).rejects.toThrow();
    expect(started()).toBe(0);
  });

  it('starts normally in user mode once the acting-user id resolves', async () => {
    const { conn, started } = makeConnection({
      userClient: {
        auth: { test: async () => ({ user_id: 'U0HUMAN', user: 'human' }) },
      } as unknown as BoltConnection['userClient'],
    });

    await startBoltConnection(conn, noopLogger as never);
    expect(conn.actingUserId).toBe('U0HUMAN');
    expect(started()).toBe(1);
  });

  it('starts normally in bot mode (no userClient)', async () => {
    const { conn, started } = makeConnection();
    await startBoltConnection(conn, noopLogger as never);
    expect(started()).toBe(1);
  });

  it('documents the downstream harm: without the acting-user id, self-filtering no-ops', () => {
    // If start were allowed with actingUserId undefined, this is what happens:
    // the human's own typing (no bot_id, their own user id) is NOT skipped.
    const HUMAN = 'U0HUMAN';
    expect(shouldSkipMessage({ user: HUMAN }, ['U0BOT', undefined])).toBe(false);
    // With the id present, it is correctly skipped.
    expect(shouldSkipMessage({ user: HUMAN }, ['U0BOT', HUMAN])).toBe(true);
  });
});
