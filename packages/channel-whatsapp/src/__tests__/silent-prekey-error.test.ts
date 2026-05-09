/**
 * Regression tests for the silent-PreKeyError outbound bug.
 *
 * Trace: omni `omni send` returns HTTP 201 status:sent and persists an
 * omni_events row with status='completed' as soon as Baileys server-ACKs.
 * If the recipient session is empty, Baileys silently fails ~6 min later
 * with a PreKeyError on the retry-receipt; without these wires the caller
 * never learns.
 *
 * The wires under test:
 *   1. plugin.handleMessageFailed emits a message.failed event with the
 *      original externalId so event-persistence can flip the row.
 *   2. setupMessageHandlers() routes a baileys `messages.update` with
 *      status === WAMessageStatus.ERROR (0) and key.fromMe through to
 *      plugin.handleMessageFailed (NOT through delivered/read).
 */

import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';
import { setupMessageHandlers } from '../handlers/messages';
import { WhatsAppPlugin } from '../plugin';

/** WAMessageStatus.ERROR — proto.WebMessageInfo.Status.ERROR */
const STATUS_ERROR = 0;
const STATUS_DELIVERY_ACK = 3;

function makeMockSock() {
  const ev = new EventEmitter();
  return {
    ev,
    presenceSubscribe: mock(async () => {}),
  } as unknown as Parameters<typeof setupMessageHandlers>[0];
}

describe('silent PreKeyError propagation', () => {
  it('plugin.handleMessageFailed emits message.failed with the original externalId', async () => {
    const plugin = new WhatsAppPlugin();
    const emitFailed = mock(async () => {});
    // emitMessageFailed is protected on BaseChannelPlugin — patch via index
    (plugin as unknown as { emitMessageFailed: typeof emitFailed }).emitMessageFailed = emitFailed;

    await plugin.handleMessageFailed('inst-1', 'EXT-MSG-ID', '5511999@s.whatsapp.net');

    expect(emitFailed).toHaveBeenCalledTimes(1);
    const calls = emitFailed.mock.calls as unknown as [
      {
        instanceId: string;
        externalId: string;
        chatId: string;
        retryable: boolean;
      },
    ][];
    const firstCall = calls[0];
    if (!firstCall) throw new Error('emitMessageFailed was not called');
    const arg = firstCall[0];
    expect(arg.instanceId).toBe('inst-1');
    expect(arg.externalId).toBe('EXT-MSG-ID');
    expect(arg.chatId).toBe('5511999@s.whatsapp.net');
    expect(arg.retryable).toBe(false);
  });

  it('messages.update with status=ERROR + fromMe routes to handleMessageFailed (not delivered/read)', async () => {
    const sock = makeMockSock();
    const plugin = new WhatsAppPlugin();
    const handleFailed = mock(async () => {});
    const handleDelivered = mock(async () => {});
    const handleRead = mock(async () => {});
    (plugin as unknown as { handleMessageFailed: typeof handleFailed }).handleMessageFailed = handleFailed;
    (plugin as unknown as { handleMessageDelivered: typeof handleDelivered }).handleMessageDelivered = handleDelivered;
    (plugin as unknown as { handleMessageRead: typeof handleRead }).handleMessageRead = handleRead;

    setupMessageHandlers(sock, plugin, 'inst-1');

    // Simulate Baileys' update emit when recipient retry-receipt fails
    sock.ev.emit('messages.update', [
      {
        key: { id: 'EXT-MSG-ID', remoteJid: '5511999@s.whatsapp.net', fromMe: true },
        update: { status: STATUS_ERROR },
      },
    ]);

    // ev.on subscribers are async — flush microtasks
    await new Promise((r) => setImmediate(r));

    expect(handleFailed).toHaveBeenCalledTimes(1);
    expect(handleFailed).toHaveBeenCalledWith('inst-1', 'EXT-MSG-ID', '5511999@s.whatsapp.net');
    expect(handleDelivered).not.toHaveBeenCalled();
    expect(handleRead).not.toHaveBeenCalled();
  });

  it('messages.update with status=ERROR but !fromMe is NOT treated as a self-send failure', async () => {
    const sock = makeMockSock();
    const plugin = new WhatsAppPlugin();
    const handleFailed = mock(async () => {});
    (plugin as unknown as { handleMessageFailed: typeof handleFailed }).handleMessageFailed = handleFailed;

    setupMessageHandlers(sock, plugin, 'inst-1');

    sock.ev.emit('messages.update', [
      {
        key: { id: 'INBOUND-ID', remoteJid: '5511999@s.whatsapp.net', fromMe: false },
        update: { status: STATUS_ERROR },
      },
    ]);
    await new Promise((r) => setImmediate(r));

    expect(handleFailed).not.toHaveBeenCalled();
  });

  it('messages.update with status=DELIVERY_ACK still routes to handleMessageDelivered (no regression)', async () => {
    const sock = makeMockSock();
    const plugin = new WhatsAppPlugin();
    const handleFailed = mock(async () => {});
    const handleDelivered = mock(async () => {});
    (plugin as unknown as { handleMessageFailed: typeof handleFailed }).handleMessageFailed = handleFailed;
    (plugin as unknown as { handleMessageDelivered: typeof handleDelivered }).handleMessageDelivered = handleDelivered;

    setupMessageHandlers(sock, plugin, 'inst-1');

    sock.ev.emit('messages.update', [
      {
        key: { id: 'EXT-MSG-ID', remoteJid: '5511999@s.whatsapp.net', fromMe: true },
        update: { status: STATUS_DELIVERY_ACK },
      },
    ]);
    await new Promise((r) => setImmediate(r));

    expect(handleDelivered).toHaveBeenCalledTimes(1);
    expect(handleFailed).not.toHaveBeenCalled();
  });
});
