/**
 * Observer-independent authorship (#1148).
 *
 * One group, two instances of the same tenant: a bot and the owner's personal
 * number. `key.fromMe` disagrees between the two journal rows for the bot's
 * message; `senderInstanceId` must not.
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import { setEnvelopeInstanceTenantResolver } from '@omni/core';
import type { WAMessage } from 'baileys';
import { WhatsAppPlugin } from '../plugin';

const GROUP = '120363@g.us';
const BOT = { id: '5511000000001:7@s.whatsapp.net', lid: '900000001:7@lid' };
const PERSONAL = { id: '5511000000002:3@s.whatsapp.net', lid: '900000002:3@lid' };

function setup() {
  const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const noop = () => {};
  const log = { debug: noop, info: noop, warn: noop, error: noop };
  const plugin = new WhatsAppPlugin();
  plugin.initialize({
    eventBus: {
      publish: mock(async (type: string, payload: Record<string, unknown>) => {
        published.push({ type, payload });
      }),
      subscribe: mock(async () => ({ unsubscribe: async () => {} })),
    } as never,
    logger: { ...log, child: () => log } as never,
    storage: {} as never,
    config: {} as never,
    db: {} as never,
  });
  const sockets = (plugin as unknown as { sockets: Map<string, unknown> }).sockets;
  sockets.set('bot', { user: BOT });
  sockets.set('personal', { user: PERSONAL });

  const receive = async (observer: string, from: string, fromMe: boolean) => {
    const raw = { key: { id: `m-${published.length}`, remoteJid: GROUP, fromMe, participant: from } } as WAMessage;
    await plugin.handleMessageReceived(
      observer,
      raw.key.id as string,
      GROUP,
      from,
      { type: 'text', text: 'hi' },
      undefined,
      raw,
      fromMe,
    );
    const last = published.at(-1);
    return { fromMe, senderInstanceId: last?.payload.senderInstanceId };
  };
  return { receive };
}

describe('senderInstanceId (#1148)', () => {
  afterEach(() => setEnvelopeInstanceTenantResolver(null));

  it('agrees across both observers of a two-instance group', async () => {
    const { receive } = setup();

    // The bot's message: fromMe differs per observer, senderInstanceId does not.
    expect(await receive('bot', '5511000000001', true)).toEqual({ fromMe: true, senderInstanceId: 'bot' });
    expect(await receive('personal', '5511000000001', false)).toEqual({ fromMe: false, senderInstanceId: 'bot' });
    // Addressed by LID in the group.
    expect(await receive('personal', '900000001@lid', false)).toEqual({ fromMe: false, senderInstanceId: 'bot' });

    // A human: fromMe false everywhere, and no sender instance.
    expect(await receive('bot', '5511999999999', false)).toEqual({ fromMe: false, senderInstanceId: undefined });
    expect(await receive('personal', '5511999999999', false)).toEqual({ fromMe: false, senderInstanceId: undefined });
  });

  it('ignores an instance that belongs to another tenant', async () => {
    const tenants: Record<string, string> = {
      bot: '11111111-1111-4111-8111-111111111111',
      personal: '22222222-2222-4222-8222-222222222222',
    };
    setEnvelopeInstanceTenantResolver((id) => tenants[id]);
    const { receive } = setup();
    expect(await receive('personal', '5511000000001', false)).toEqual({ fromMe: false, senderInstanceId: undefined });
  });
});
