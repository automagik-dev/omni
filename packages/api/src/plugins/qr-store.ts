/**
 * QR Code storage and terminal display
 *
 * Stores QR codes for API retrieval and prints to terminal in dev mode.
 */

import type { EventBus } from '@omni/core';

interface StoredQrCode {
  code: string;
  expiresAt: Date;
  instanceId: string;
}

/**
 * In-memory QR code store
 */
const qrCodes = new Map<string, StoredQrCode>();

/**
 * Store a QR code for an instance
 */
export function storeQrCode(instanceId: string, qrCode: string, expiresAt: Date): void {
  qrCodes.set(instanceId, {
    code: qrCode,
    expiresAt,
    instanceId,
  });
}

/**
 * Get stored QR code for an instance
 */
export function getQrCode(instanceId: string): StoredQrCode | null {
  const stored = qrCodes.get(instanceId);
  if (!stored) return null;

  // Check if expired
  if (new Date() > stored.expiresAt) {
    qrCodes.delete(instanceId);
    return null;
  }

  return stored;
}

/**
 * Clear QR code for an instance (e.g., after connection)
 */
export function clearQrCode(instanceId: string): void {
  qrCodes.delete(instanceId);
}

/**
 * Print QR code to terminal (dev mode only)
 */
export async function printQrCodeToTerminal(qrCode: string, instanceId: string): Promise<void> {
  // Only print in development
  if (process.env.NODE_ENV === 'production') return;

  try {
    // Dynamic import qrcode-terminal
    // For CommonJS modules imported with dynamic import in Node.js,
    // the module object itself is what we need
    const qrTerminalModule = await import('qrcode-terminal');
    const qrTerminal = (qrTerminalModule as any).default || qrTerminalModule;

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log(`║  WhatsApp QR Code for instance: ${instanceId.padEnd(25)} ║`);
    console.log('║  Scan with your phone to connect                           ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');

    // qrcode-terminal exports a generate function
    qrTerminal.generate(qrCode, { small: true });

    console.log('\n╔════════════════════════════════════════════════════════════╗');
    console.log('║  QR code also available via GET /instances/:id/qr          ║');
    console.log('╚════════════════════════════════════════════════════════════╝\n');
  } catch (error) {
    // If qrcode-terminal isn't installed or import fails, just log the raw QR
    console.log(`\n[QR Code for ${instanceId}]: ${qrCode.substring(0, 50)}...`);
    if (error instanceof Error && process.env.DEBUG) {
      console.debug(`[QR Terminal Error]: ${error.message}`);
    }
  }
}

/**
 * Set up event listener for QR code events
 */
export async function setupQrCodeListener(eventBus: EventBus): Promise<void> {
  try {
    await eventBus.subscribe('instance.qr_code', async (event) => {
      const { instanceId, qrCode, expiresAt } = event.payload;

      console.log('\n╔════════════════════════════════════════════════════════════╗');
      console.log('║  WhatsApp QR Code Generated                                 ║');
      console.log(`║  Instance: ${instanceId.padEnd(49)} ║`);
      console.log(`║  Expires: ${new Date(expiresAt).toISOString().padEnd(50)} ║`);
      console.log('╚════════════════════════════════════════════════════════════╝\n');

      // Store the QR code
      storeQrCode(instanceId, qrCode, new Date(expiresAt));

      // Print to terminal in dev mode
      await printQrCodeToTerminal(qrCode, instanceId);
    });

    console.log('[QR Store] Listening for QR code events');
  } catch (error) {
    console.warn('[QR Store] Failed to set up QR code listener:', error);
  }
}

/**
 * Set up event listener for connection events to clear QR codes
 */
export async function setupConnectionListener(eventBus: EventBus): Promise<void> {
  try {
    await eventBus.subscribe('instance.connected', async (event) => {
      const { instanceId, profileName } = event.payload;
      clearQrCode(instanceId);
      console.log(`[QR Store] Cleared QR code for connected instance: ${instanceId}`);
      console.log(`[Instance] Connected: ${instanceId} (profile: ${profileName || 'unknown'})`);
    });
  } catch (error) {
    console.warn('[QR Store] Failed to set up connection listener:', error);
  }
}

/**
 * Set up event listener for message.received events (for logging)
 */
export async function setupMessageListener(eventBus: EventBus): Promise<void> {
  try {
    await eventBus.subscribe('message.received', async (event) => {
      const { externalId, chatId, from, content } = event.payload;
      const instanceId = event.metadata.instanceId;
      console.log(`[Message] Received from ${from} (chat: ${chatId})`);
      console.log(`  Type: ${content.type}, Text: ${content.text?.substring(0, 100) || '(no text)'}`);
      console.log(`  Instance: ${instanceId}, ExternalId: ${externalId}`);
    });
    console.log('[Message Store] Listening for message.received events');
  } catch (error) {
    console.warn('[Message Store] Failed to set up message listener:', error);
  }
}
