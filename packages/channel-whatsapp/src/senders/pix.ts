/**
 * PIX payment message sender
 *
 * Sends native WhatsApp PIX "copia e cola" messages using
 * interactiveMessage with payment_info button.
 */

import type { AnyMessageContent, WASocket } from '@whiskeysockets/baileys';
import { generateMessageID } from '@whiskeysockets/baileys';

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

  // Simple structure matching received PIX messages
  // Cast through unknown because AnyMessageContent doesn't include interactiveMessage
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
 * Build raw PIX proto message for relayMessage
 *
 * This bypasses Baileys' content validation which doesn't support
 * interactive messages natively.
 *
 * Structure based on real received PIX messages from fixtures.
 */
export function buildPixProtoMessage(data: PixData) {
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

  // Simple structure matching received PIX messages
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
  };
}

/**
 * Send a PIX payment message using relayMessage
 *
 * Uses relayMessage to bypass Baileys' content type validation
 * which doesn't support interactive messages.
 */
export async function sendPixMessage(
  sock: WASocket,
  jid: string,
  data: PixData,
  _replyToId?: string,
): Promise<string | undefined> {
  const messageId = generateMessageID();
  const message = buildPixProtoMessage(data);

  await sock.relayMessage(jid, message, {
    messageId,
  });

  return messageId;
}
