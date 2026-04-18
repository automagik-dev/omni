import { describe, expect, test } from 'bun:test';
import { DiscordPlugin } from '../plugin';

function createClient() {
  return {
    removeAllListeners: () => {},
    destroy: async () => {},
  };
}

function createLogger() {
  const logger = {
    child: () => logger,
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  return logger;
}

describe('DiscordPlugin voice lifecycle', () => {
  test('disconnect destroys the voice manager for the instance', async () => {
    const plugin = new DiscordPlugin() as any;
    let destroyed = 0;
    let cacheDisposed = 0;

    plugin.logger = createLogger();
    plugin.emitInstanceDisconnected = async () => {};
    plugin.clearTypingInterval = () => {};
    plugin.clients.set('inst-1', createClient() as never);
    plugin.voiceManagers.set('inst-1', {
      destroy: async () => {
        destroyed += 1;
      },
    } as never);
    plugin.instanceAuthConfigs.set('inst-1', {} as never);
    plugin.dedupeCaches.set('inst-1', {
      dispose: () => {
        cacheDisposed += 1;
      },
    } as never);

    await plugin.disconnect('inst-1');

    expect(destroyed).toBe(1);
    expect(plugin.voiceManagers.has('inst-1')).toBe(false);
    expect(cacheDisposed).toBe(1);
  });

  test('connect cleans up the stale voice manager before recreating the connection', async () => {
    const plugin = new DiscordPlugin() as any;
    let destroyed = 0;

    plugin.logger = createLogger();
    plugin.storage = {
      get: async () => null,
      set: async () => {},
      delete: async () => true,
    };
    plugin.createConnection = async () => {};
    plugin.clients.set('inst-1', {
      isReady: () => false,
      removeAllListeners: () => {},
      destroy: async () => {},
    } as never);
    plugin.voiceManagers.set('inst-1', {
      destroy: async () => {
        destroyed += 1;
      },
    } as never);

    await plugin.connect('inst-1', {
      instanceId: 'inst-1',
      credentials: {},
      options: { token: 'discord-token' },
    });

    expect(destroyed).toBe(1);
    expect(plugin.voiceManagers.has('inst-1')).toBe(false);
  });
});
