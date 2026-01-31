/**
 * QR Code Storage
 *
 * In-memory storage for QR codes with expiration.
 * Used by API to serve QR codes for WhatsApp authentication.
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
  if (process.env.NODE_ENV === 'production') return;

  try {
    const qrTerminalModule = await import('qrcode-terminal');
    const qrTerminal = (qrTerminalModule as any).default || qrTerminalModule;

    console.log(`\n[WhatsApp] QR Code for ${instanceId}:`);
    qrTerminal.generate(qrCode, { small: true });
  } catch (error) {
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

      // Store the QR code
      storeQrCode(instanceId, qrCode, new Date(expiresAt));

      // Print to terminal in dev mode
      await printQrCodeToTerminal(qrCode, instanceId);
    });
  } catch (error) {
    console.warn('[QR Store] Failed to set up QR code listener:', error);
  }
}
