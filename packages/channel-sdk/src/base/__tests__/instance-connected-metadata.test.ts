/**
 * `instance.connected` carries the platform workspace and acting user
 * (wish: slack-personal-oauth, Group 1).
 *
 * `emitInstanceConnected` builds its payload field by field rather than
 * spreading the metadata, so a field added to `InstanceConnectedMetadata` is
 * silently dropped unless the emitter forwards it. This file pins that
 * `teamId` and `actingUserId` survive the emit, and that a plugin which does
 * not send them publishes exactly the payload it published before.
 */

import { describe, expect, test } from 'bun:test';
import type { EventBus } from '@omni/core';
import type { InstanceConnectedMetadata } from '../../helpers/events';
import type { ChannelCapabilities } from '../../types/capabilities';
import type { PluginContext } from '../../types/context';
import type { SendResult } from '../../types/messaging';
import { BaseChannelPlugin } from '../BaseChannelPlugin';

class ProbePlugin extends BaseChannelPlugin {
  readonly id = 'slack' as const;
  readonly name = 'Probe';
  readonly version = '0.0.0';
  readonly capabilities = {} as ChannelCapabilities;

  connect(): Promise<void> {
    return Promise.resolve();
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  sendMessage(): Promise<SendResult> {
    return Promise.reject(new Error('not exercised'));
  }

  /** Public seam over the protected emitter. */
  connected(instanceId: string, metadata?: InstanceConnectedMetadata): Promise<void> {
    return this.emitInstanceConnected(instanceId, metadata);
  }
}

type Published = { type: string; payload: Record<string, unknown> };

type ProbeLogger = {
  debug: () => void;
  info: () => void;
  warn: () => void;
  error: () => void;
  child: () => ProbeLogger;
};

async function setup(): Promise<{ plugin: ProbePlugin; published: Published[] }> {
  const published: Published[] = [];
  const noop = () => {};
  const logger: ProbeLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };
  const plugin = new ProbePlugin();
  await plugin.initialize({
    eventBus: {
      publish: async (type: string, payload: Record<string, unknown>) => {
        published.push({ type, payload });
        return { success: true };
      },
    } as unknown as EventBus,
    storage: {},
    logger,
    config: {},
    db: {},
  } as unknown as PluginContext);
  return { plugin, published };
}

describe('emitInstanceConnected — teamId / actingUserId', () => {
  test('forwards teamId and actingUserId flat on the instance.connected payload', async () => {
    const { plugin, published } = await setup();

    await plugin.connected('inst-1', { profileName: 'Ana', teamId: 'T1', actingUserId: 'U1' });

    expect(published).toHaveLength(1);
    expect(published[0]?.type).toBe('instance.connected');
    expect(published[0]?.payload).toMatchObject({
      instanceId: 'inst-1',
      channelType: 'slack',
      profileName: 'Ana',
      teamId: 'T1',
      actingUserId: 'U1',
    });
  });

  test('a bot-mode connect carries the team without an acting user', async () => {
    const { plugin, published } = await setup();

    await plugin.connected('inst-2', { profileName: 'Bot', teamId: 'T1' });

    const payload = published[0]?.payload ?? {};
    expect(payload.teamId).toBe('T1');
    expect('actingUserId' in payload).toBe(false);
  });

  test('a plugin that sends neither publishes the pre-existing payload shape, byte for byte', async () => {
    const { plugin, published } = await setup();

    await plugin.connected('inst-3', { profileName: 'Legacy' });

    const payload = published[0]?.payload ?? {};
    expect(Object.keys(payload).sort()).toEqual([
      'channelType',
      'instanceId',
      'ownerIdentifier',
      'profileName',
      'profilePicUrl',
    ]);
    expect('teamId' in payload).toBe(false);
    expect('actingUserId' in payload).toBe(false);
  });
});
