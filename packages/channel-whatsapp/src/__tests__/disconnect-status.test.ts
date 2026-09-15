/**
 * #1169 — a user disconnect during a reconnect loop must clear cached status.
 * The loop deletes the socket between attempts, so disconnect() used to
 * early-return and leave "Reconnecting (attempt N/5)" cached forever.
 */

import { describe, expect, it } from 'bun:test';
import { WhatsAppPlugin } from '../plugin';

const ID = 'wa-1169';

describe('WhatsAppPlugin.disconnect (#1169)', () => {
  it('resets reconnecting status to disconnected when no socket is live', async () => {
    const plugin = new WhatsAppPlugin();
    const { instances } = plugin as unknown as {
      instances: { setInstance(id: string, config: unknown, status: unknown): void };
    };
    instances.setInstance(ID, { instanceId: ID } as never, {
      state: 'reconnecting',
      since: new Date(),
      message: 'Reconnecting (attempt 4/5)',
    });

    await plugin.disconnect(ID);

    const status = await plugin.getStatus(ID);
    expect(status.state).toBe('disconnected');
    expect(status.message).toBe('User requested disconnect');
  });
});
