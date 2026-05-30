import { describe, expect, it, mock } from 'bun:test';
import { WhatsAppPlugin, isTransientConnectionClosedError } from '../plugin';

type PrewarmSock = {
  getUSyncDevices: ReturnType<typeof mock>;
  assertSessions: ReturnType<typeof mock>;
};

function makeLogger() {
  return {
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

describe('group prewarm reconnect noise', () => {
  it('classifies Baileys connection-closed failures as transient reconnect noise', () => {
    expect(isTransientConnectionClosedError(new Error('Connection Closed'))).toBe(true);
    expect(isTransientConnectionClosedError('Error: Connection Closed')).toBe(true);
    expect(isTransientConnectionClosedError({ message: 'Connection Closed' })).toBe(true);
    expect(isTransientConnectionClosedError(new Error('Boom: Connection Closed'))).toBe(true);
    expect(isTransientConnectionClosedError(new Error('auth failure'))).toBe(false);
  });

  it('does not warn when bulk group prewarm loses a socket during reconnect', async () => {
    const plugin = new WhatsAppPlugin();
    const logger = makeLogger();
    (plugin as unknown as { logger: typeof logger }).logger = logger;

    const sock = {
      getUSyncDevices: mock(async () => {
        throw new Error('Connection Closed');
      }),
      assertSessions: mock(async () => {}),
    };

    await (
      plugin as unknown as {
        prewarmAllGroupCaches: (
          instanceId: string,
          socket: PrewarmSock,
          groups: Record<string, { participants: Array<{ id: string }> }>,
        ) => Promise<void>;
      }
    ).prewarmAllGroupCaches('inst-1', sock, {
      '123@g.us': { participants: [{ id: '5511999999999@s.whatsapp.net' }] },
    });

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith('Bulk group cache pre-warm skipped; socket closed during reconnect', {
      instanceId: 'inst-1',
      error: 'Error: Connection Closed',
    });
  });

  it('still warns for unexpected bulk prewarm failures', async () => {
    const plugin = new WhatsAppPlugin();
    const logger = makeLogger();
    (plugin as unknown as { logger: typeof logger }).logger = logger;

    const sock = {
      getUSyncDevices: mock(async () => {
        throw new Error('unexpected device query failure');
      }),
      assertSessions: mock(async () => {}),
    };

    await (
      plugin as unknown as {
        prewarmAllGroupCaches: (
          instanceId: string,
          socket: PrewarmSock,
          groups: Record<string, { participants: Array<{ id: string }> }>,
        ) => Promise<void>;
      }
    ).prewarmAllGroupCaches('inst-1', sock, {
      '123@g.us': { participants: [{ id: '5511999999999@s.whatsapp.net' }] },
    });

    expect(logger.warn).toHaveBeenCalledWith('Bulk group cache pre-warm failed (non-fatal)', {
      instanceId: 'inst-1',
      error: 'Error: unexpected device query failure',
    });
  });
});
