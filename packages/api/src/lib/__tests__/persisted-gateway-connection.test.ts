import { describe, expect, mock, test } from 'bun:test';
import type { ChannelPlugin } from '@omni/channel-sdk';
import { connectAndPersist } from '../persisted-gateway-connection';

describe('durable gateway activation', () => {
  test('a persistence failure cannot activate new credentials', async () => {
    const connect = mock(async () => {});
    const plugin = { connect, disconnect: mock(async () => {}) } as unknown as ChannelPlugin;
    await expect(
      connectAndPersist(
        plugin,
        'write-failure',
        {},
        async () => {
          throw new Error('write failed');
        },
        true,
      ),
    ).rejects.toThrow('write failed');
    expect(connect).not.toHaveBeenCalled();
  });
  test('activation failure detaches locally after persisting recovery credentials', async () => {
    const order: string[] = [];
    const plugin = {
      connect: async () => {
        order.push('connect');
        throw new Error('provider failed');
      },
      disconnect: async () => {
        order.push('detach');
      },
    } as unknown as ChannelPlugin;
    const result = await connectAndPersist(
      plugin,
      'activation-failure',
      {},
      async () => {
        order.push('persist');
        return 'saved';
      },
      true,
    );
    expect(order).toEqual(['persist', 'connect', 'detach']);
    expect(result).toEqual({ errorMessage: 'provider failed' });
  });
  test('concurrent rotations cannot activate in a different order from persistence', async () => {
    const order: string[] = [];
    let release = () => {};
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const plugin = {
      connect: async (_id: string, config: { options: { revision: string } }) => {
        order.push(`connect-${config.options.revision}`);
        if (config.options.revision === 'a') await barrier;
      },
      disconnect: async () => {},
    } as unknown as ChannelPlugin;
    const a = connectAndPersist(
      plugin,
      'rotation',
      { revision: 'a' },
      async () => {
        order.push('persist-a');
        return 'a';
      },
      true,
    );
    const b = connectAndPersist(
      plugin,
      'rotation',
      { revision: 'b' },
      async () => {
        order.push('persist-b');
        return 'b';
      },
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(order).toEqual(['persist-a', 'connect-a']);
    release();
    await Promise.all([a, b]);
    expect(order).toEqual(['persist-a', 'connect-a', 'persist-b', 'connect-b']);
  });
});
