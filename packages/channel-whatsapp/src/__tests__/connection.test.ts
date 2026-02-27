/**
 * Regression tests for connection handler reconnect logic
 *
 * These tests validate the fix for the infinite reconnect loop
 * caused by connectionReplaced (status 440) not being guarded,
 * fire-and-forget timers, and stale event listeners.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { DisconnectReason } from 'baileys';
import {
  cancelPendingReconnect,
  resetConnectionState,
  resetReconnectAttempts,
  seedAuthenticated,
  setupConnectionHandlers,
} from '../handlers/connection';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Listener = (update: Record<string, unknown>) => Promise<void> | void;

/** Minimal mock of a Baileys WASocket event emitter */
function createMockSocket() {
  const listeners = new Map<string, Listener[]>();
  return {
    ev: {
      on(event: string, handler: Listener) {
        const existing = listeners.get(event) || [];
        existing.push(handler);
        listeners.set(event, existing);
      },
      removeAllListeners(event?: string) {
        if (event) {
          listeners.delete(event);
        } else {
          listeners.clear();
        }
      },
    },
    /** Emit an event and await all handlers */
    async emit(event: string, data: Record<string, unknown>) {
      const handlers = listeners.get(event) || [];
      for (const handler of handlers) {
        await handler(data);
      }
    },
  };
}

/** Build a Boom-like error matching Baileys disconnect format */
function makeBoomError(statusCode: number, message = 'test error') {
  const err = new Error(message) as Error & {
    output: { statusCode: number; payload: { message: string } };
  };
  err.output = { statusCode, payload: { message } };
  return err;
}

function createMockPlugin() {
  return {
    handleDisconnected: mock(async () => {}),
    handleReconnecting: mock(async () => {}),
    handleConnected: mock(async () => {}),
    handleConnectionError: mock(() => {}),
    handleQrCode: mock(async () => {}),
  } as unknown as Parameters<typeof setupConnectionHandlers>[1];
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('connection handler – reconnect regression', () => {
  const instanceId = 'test-instance-001';

  beforeEach(() => {
    // Clean state between tests
    resetConnectionState(instanceId);
  });

  afterEach(() => {
    resetConnectionState(instanceId);
  });

  // -------------------------------------------------------------------------
  // 1. connectionReplaced (440) must NOT reconnect
  // -------------------------------------------------------------------------
  describe('connectionReplaced (status 440)', () => {
    it('does NOT call onReconnect', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();
      const onReconnect = mock(async () => {});

      // Mark as authenticated so the "not authenticated" path doesn't interfere
      seedAuthenticated(instanceId);

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        onReconnect,
        async () => {},
      );

      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.connectionReplaced, 'Connection replaced'),
        },
      });

      expect(onReconnect).not.toHaveBeenCalled();
    });

    it('does NOT call handleReconnecting', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();

      seedAuthenticated(instanceId);

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        async () => {},
        async () => {},
      );

      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.connectionReplaced),
        },
      });

      expect(plugin.handleReconnecting).not.toHaveBeenCalled();
    });

    it('does NOT call handleDisconnected (silent drop)', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();

      seedAuthenticated(instanceId);

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        async () => {},
        async () => {},
      );

      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.connectionReplaced),
        },
      });

      expect(plugin.handleDisconnected).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 2. loggedOut must NOT reconnect
  // -------------------------------------------------------------------------
  describe('loggedOut', () => {
    it('does NOT call onReconnect', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();
      const onReconnect = mock(async () => {});

      seedAuthenticated(instanceId);

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        onReconnect,
        async () => {},
      );

      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.loggedOut, 'Logged out'),
        },
      });

      expect(onReconnect).not.toHaveBeenCalled();
    });

    it('calls handleDisconnected with shouldReconnect=false', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();

      seedAuthenticated(instanceId);

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        async () => {},
        async () => {},
      );

      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.loggedOut, 'Logged out'),
        },
      });

      expect(plugin.handleDisconnected).toHaveBeenCalledTimes(1);
      expect(plugin.handleDisconnected).toHaveBeenCalledWith(instanceId, 'Logged out from WhatsApp', false);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Generic error for authenticated instance DOES trigger reconnect
  // -------------------------------------------------------------------------
  describe('generic error (authenticated instance)', () => {
    it('calls handleReconnecting', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();
      const onReconnect = mock(async () => {});

      seedAuthenticated(instanceId);

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        onReconnect,
        async () => {},
      );

      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.connectionClosed, 'Connection lost'),
        },
      });

      expect(plugin.handleReconnecting).toHaveBeenCalledTimes(1);
      expect(plugin.handleReconnecting).toHaveBeenCalledWith(instanceId, 1, 5);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Connection open clears tracking state
  // -------------------------------------------------------------------------
  describe('connection open', () => {
    it('calls handleConnected', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        async () => {},
        async () => {},
      );

      await sock.emit('connection.update', { connection: 'open' });

      expect(plugin.handleConnected).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // 5. cancelPendingReconnect – timer tracking
  // -------------------------------------------------------------------------
  describe('cancelPendingReconnect', () => {
    it('is safe to call on instance with no pending timer', () => {
      // Should not throw
      cancelPendingReconnect('no-such-instance');
    });

    it('prevents scheduled reconnect from firing', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();
      const onReconnect = mock(async () => {});

      seedAuthenticated(instanceId);

      // Use short baseDelay so the timer would fire quickly
      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        onReconnect,
        async () => {},
        { maxRetries: 5, baseDelay: 50, maxDelay: 100 },
      );

      // Trigger a reconnectable disconnect
      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.connectionClosed, 'Connection lost'),
        },
      });

      // Cancel before the timer fires
      cancelPendingReconnect(instanceId);

      // Wait longer than the timer would take
      await new Promise((resolve) => setTimeout(resolve, 200));

      // onReconnect was NOT called because we cancelled the timer
      expect(onReconnect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 6. resetReconnectAttempts also cancels pending timers
  // -------------------------------------------------------------------------
  describe('resetReconnectAttempts', () => {
    it('cancels pending reconnect timers', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();
      const onReconnect = mock(async () => {});

      seedAuthenticated(instanceId);

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        onReconnect,
        async () => {},
        { maxRetries: 5, baseDelay: 50, maxDelay: 100 },
      );

      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.connectionClosed),
        },
      });

      resetReconnectAttempts(instanceId);

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(onReconnect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 7. resetConnectionState also cancels pending timers
  // -------------------------------------------------------------------------
  describe('resetConnectionState', () => {
    it('cancels pending reconnect timers', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();
      const onReconnect = mock(async () => {});

      seedAuthenticated(instanceId);

      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        onReconnect,
        async () => {},
        { maxRetries: 5, baseDelay: 50, maxDelay: 100 },
      );

      await sock.emit('connection.update', {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.connectionClosed),
        },
      });

      resetConnectionState(instanceId);

      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(onReconnect).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // 8. Max retries exhausted → handleDisconnected, no further reconnect
  // -------------------------------------------------------------------------
  describe('max retries exceeded', () => {
    it('calls handleDisconnected and stops', async () => {
      const sock = createMockSocket();
      const plugin = createMockPlugin();
      const onReconnect = mock(async () => {});

      seedAuthenticated(instanceId);

      const maxRetries = 2;
      setupConnectionHandlers(
        sock as unknown as Parameters<typeof setupConnectionHandlers>[0],
        plugin,
        instanceId,
        onReconnect,
        async () => {},
        { maxRetries, baseDelay: 10, maxDelay: 20 },
      );

      const disconnectEvent = {
        connection: 'close',
        lastDisconnect: {
          error: makeBoomError(DisconnectReason.connectionClosed, 'Connection lost'),
        },
      };

      // Exhaust retries
      for (let i = 0; i < maxRetries; i++) {
        await sock.emit('connection.update', disconnectEvent);
      }

      // One more disconnect — should hit max
      await sock.emit('connection.update', disconnectEvent);

      expect(plugin.handleDisconnected).toHaveBeenCalledTimes(1);
      // handleReconnecting was called for the first two attempts
      expect(plugin.handleReconnecting).toHaveBeenCalledTimes(maxRetries);
    });
  });
});
