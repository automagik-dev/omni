/**
 * #1281 — the QR cycle must not invalidate a pending pairing code.
 *
 * Baileys keeps rotating QRs while an 8-digit code is pending (60 s, then
 * 20 s each). On the 3rd expired QR (~100 s) the handler cleared the
 * credentials and recreated the socket, so a code typed after that failed on
 * the phone with "couldn't link device".
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { DisconnectReason } from 'baileys';
import { resetConnectionState, setupConnectionHandlers } from '../handlers/connection';
import { WhatsAppPlugin } from '../plugin';

type Listener = (update: Record<string, unknown>) => Promise<void> | void;
type HandlerPlugin = Parameters<typeof setupConnectionHandlers>[1];

const instanceId = 'pairing-1281';

function createMockSocket() {
  const listeners = new Map<string, Listener[]>();
  return {
    ev: {
      on(event: string, handler: Listener) {
        listeners.set(event, [...(listeners.get(event) || []), handler]);
      },
      removeAllListeners(event?: string) {
        if (event) listeners.delete(event);
        else listeners.clear();
      },
    },
    requestPairingCode: mock(async (_phone: string) => 'ABCD1234'),
    async emit(event: string, data: Record<string, unknown>) {
      for (const handler of listeners.get(event) || []) {
        await handler(data);
      }
    },
  };
}

function makeBoomError(statusCode: number, message = 'test error') {
  const err = new Error(message) as Error & { output: { statusCode: number; payload: { message: string } } };
  err.output = { statusCode, payload: { message } };
  return err;
}

/** A real plugin (so `requestPairingCode` is the production path) with the handler callbacks spied. */
function createPlugin() {
  const plugin = new WhatsAppPlugin();
  const noop = () => {};
  const logger = { debug: noop, info: noop, warn: noop, error: noop };
  plugin.initialize({
    eventBus: { publish: mock(async () => 'id'), subscribe: mock(async () => ({})) } as never,
    logger: { ...logger, child: () => logger } as never,
    storage: {} as never,
    config: {} as never,
    db: {} as never,
  });
  const spies = {
    handleDisconnected: mock(async () => {}),
    handleReconnecting: mock(async () => {}),
    handleConnected: mock(async () => {}),
    handleConnectionError: mock(() => {}),
    handleQrCode: mock(async () => {}),
    handlePasskeyUpdate: mock(async () => {}),
  };
  Object.assign(plugin, spies);
  return { plugin, spies };
}

function connect() {
  const sock = createMockSocket();
  const { plugin, spies } = createPlugin();
  (plugin as unknown as { sockets: Map<string, unknown> }).sockets.set(instanceId, sock);
  const onReconnect = mock(async () => {});
  const clearAuthAndReconnect = mock(async () => {});
  setupConnectionHandlers(
    sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
    plugin as unknown as HandlerPlugin,
    instanceId,
    onReconnect,
    clearAuthAndReconnect,
  );
  return { sock, plugin, spies, onReconnect, clearAuthAndReconnect };
}

async function rotateQrs(sock: ReturnType<typeof createMockSocket>, count: number, from = 0) {
  for (let i = from; i < from + count; i++) {
    await sock.emit('connection.update', { qr: `qr-${i}` });
  }
}

describe('pending pairing code vs the QR cycle (#1281)', () => {
  beforeEach(() => resetConnectionState(instanceId));
  afterEach(() => resetConnectionState(instanceId));

  it('without a pairing code, the 3rd expired QR still clears auth (unchanged)', async () => {
    const { sock, clearAuthAndReconnect } = connect();
    await rotateQrs(sock, 4);
    expect(clearAuthAndReconnect).toHaveBeenCalledTimes(1);
  });

  it('with a pending code, rotating QRs never clears auth or gives up', async () => {
    const { sock, plugin, spies, clearAuthAndReconnect } = connect();
    await rotateQrs(sock, 1); // ~0 s: first QR, then the code is requested at ~90 s
    await rotateQrs(sock, 2, 1);
    await expect(plugin.requestPairingCode(instanceId, '+5511999999999')).resolves.toBe('ABCD1234');

    await rotateQrs(sock, 6, 3); // ~100 s onwards: used to clear auth, then give up at ~200 s

    expect(clearAuthAndReconnect).not.toHaveBeenCalled();
    expect(spies.handleDisconnected).not.toHaveBeenCalled();
    expect(spies.handleQrCode).toHaveBeenCalledTimes(9);
  });

  it('when the socket closes before the code is entered, starts fresh instead of logging in half-paired', async () => {
    const { sock, plugin, spies, onReconnect, clearAuthAndReconnect } = connect();
    await rotateQrs(sock, 1);
    await plugin.requestPairingCode(instanceId, '+5511999999999');

    // Baileys ends the socket once its QR refs run out.
    await sock.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: makeBoomError(DisconnectReason.timedOut, 'QR refs attempts ended') },
    });

    expect(clearAuthAndReconnect).toHaveBeenCalledTimes(1);
    expect(onReconnect).not.toHaveBeenCalled();
    expect(spies.handleDisconnected).not.toHaveBeenCalled();
  });

  it('when the code is accepted, the 515 restart keeps the new credentials', async () => {
    const { sock, plugin, clearAuthAndReconnect } = connect();
    await rotateQrs(sock, 1);
    await plugin.requestPairingCode(instanceId, '+5511999999999');

    await sock.emit('connection.update', { isNewLogin: true, qr: undefined });
    await sock.emit('connection.update', {
      connection: 'close',
      lastDisconnect: { error: makeBoomError(DisconnectReason.restartRequired, 'restart required') },
    });

    expect(clearAuthAndReconnect).not.toHaveBeenCalled();
  });

  it('the pending code ends with the connection state reset', async () => {
    const { sock, plugin, clearAuthAndReconnect } = connect();
    await rotateQrs(sock, 1);
    await plugin.requestPairingCode(instanceId, '+5511999999999');

    resetConnectionState(instanceId);
    await rotateQrs(sock, 4, 1);

    expect(clearAuthAndReconnect).toHaveBeenCalledTimes(1);
  });

  it('a failed code request does not pause the QR cycle', async () => {
    const { sock, plugin, clearAuthAndReconnect } = connect();
    sock.requestPairingCode.mockImplementation(async () => {
      throw new Error('rate-overlimit');
    });
    await rotateQrs(sock, 1);
    await expect(plugin.requestPairingCode(instanceId, '+5511999999999')).rejects.toThrow('rate-overlimit');

    await rotateQrs(sock, 3, 1);

    expect(clearAuthAndReconnect).toHaveBeenCalledTimes(1);
  });
});
