/**
 * #1120: `authMode: 'user'` without a userToken must refuse to connect rather
 * than degrade to the bot identity.
 */
import { describe, expect, it } from 'bun:test';
import type { PluginContext } from '@omni/channel-sdk';
import { SlackPlugin } from '../plugin';
import { SlackError } from '../types';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

describe('SlackPlugin.connect — authMode user (#1120)', () => {
  it('rejects user mode without a userToken and reports error status', async () => {
    const plugin = new SlackPlugin();
    await plugin.initialize({
      eventBus: { publish: async () => {}, subscribe: () => {} },
      storage: {},
      logger: noopLogger,
      config: {},
      db: {},
    } as unknown as PluginContext);

    const err = await plugin
      .connect('inst-1120', {
        instanceId: 'inst-1120',
        credentials: {},
        options: { botToken: 'xoxb-fake', appToken: 'xapp-fake', authMode: 'user' },
      })
      .then(
        () => null,
        (e: unknown) => e,
      );

    expect(err).toBeInstanceOf(SlackError);
    expect((err as Error).message).toContain('userToken');
    expect((await plugin.getStatus('inst-1120')).state).toBe('error');
  });
});
