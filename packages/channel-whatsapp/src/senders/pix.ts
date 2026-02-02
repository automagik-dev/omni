/**
 * PIX payment message sender
 *
 * Sends native WhatsApp PIX "copia e cola" messages using
 * interactiveMessage with payment_info button.
 */

import type { AnyMessageContent, WASocket } from '@whiskeysockets/baileys';

/**
 * PIX key types supported by WhatsApp
 */
export type PixKeyType = 'PHONE' | 'EMAIL' | 'CPF' | 'EVP';

/**
 * PIX payment data
 */
export interface PixData {
  /** Merchant/receiver name displayed in the message */
  merchantName: string;
  /** PIX key value (phone, email, CPF, or random key) */
  key: string;
  /** Type of PIX key */
  keyType: PixKeyType;
}

/**
 * Validate PIX data
 */
export function isValidPixData(data: PixData): boolean {
  if (!data.merchantName || data.merchantName.trim() === '') {
    return false;
  }

  if (!data.key || data.key.trim() === '') {
    return false;
  }

  const validKeyTypes: PixKeyType[] = ['PHONE', 'EMAIL', 'CPF', 'EVP'];
  if (!validKeyTypes.includes(data.keyType)) {
    return false;
  }

  return true;
}

/**
 * Build PIX message content
 *
 * Creates an interactive message with native payment_info button
 * that displays the PIX "copia e cola" interface.
 */
export function buildPixContent(data: PixData): AnyMessageContent {
  const buttonParamsJson = JSON.stringify({
    payment_settings: [
      {
        type: 'pix_static_code',
        pix_static_code: {
          merchant_name: data.merchantName,
          key: data.key,
          key_type: data.keyType,
        },
      },
    ],
  });

  // Cast through unknown because AnyMessageContent doesn't include interactiveMessage
  // but Baileys accepts it at runtime for native flow messages
  return {
    interactiveMessage: {
      nativeFlowMessage: {
        buttons: [
          {
            name: 'payment_info',
            buttonParamsJson,
          },
        ],
      },
    },
  } as unknown as AnyMessageContent;
}

/**
 * Send a PIX payment message
 */
export async function sendPixMessage(
  sock: WASocket,
  jid: string,
  data: PixData,
  replyToId?: string,
): Promise<string | undefined> {
  const content = buildPixContent(data);

  const result = await sock.sendMessage(
    jid,
    content,
    replyToId ? { quoted: { key: { id: replyToId, remoteJid: jid } } as never } : undefined,
  );

  return result?.key?.id ?? undefined;
}
