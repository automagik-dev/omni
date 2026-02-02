/**
 * PIX payment message sender
 *
 * Sends native WhatsApp PIX "copia e cola" messages using
 * interactiveMessage with payment_info button.
 *
 * Uses baileys_helpers getButtonArgs for proper additionalNodes (biz, native_flow).
 */

import type { WASocket } from '@whiskeysockets/baileys';
import { generateMessageID, generateWAMessageFromContent, isJidGroup } from '@whiskeysockets/baileys';
import { getButtonArgs } from 'baileys_helpers';

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
 * Build PIX button params JSON
 *
 * Creates the payment_settings structure for PIX "copia e cola".
 */
export function buildPixButtonParams(data: PixData): string {
  return JSON.stringify({
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
}

/**
 * Send a PIX payment message using relayMessage with additionalNodes
 *
 * Uses baileys_helpers getButtonArgs to build proper additionalNodes (biz, native_flow).
 * Bypasses validation that would reject payment_info button.
 */
export async function sendPixMessage(
  sock: WASocket,
  jid: string,
  data: PixData,
  _replyToId?: string,
): Promise<string | undefined> {
  const buttonParamsJson = buildPixButtonParams(data);

  // Build the interactive message content
  const content = {
    interactiveMessage: {
      body: { text: `PIX: ${data.merchantName}` },
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

  // Get user JID for message generation
  const userJid = sock.authState?.creds?.me?.id || sock.user?.id || '';
  const messageId = generateMessageID();

  // Generate the full message using Baileys
  const fullMsg = generateWAMessageFromContent(jid, content, {
    userJid,
    messageId,
    timestamp: new Date(),
  });

  // Get the additionalNodes for payment_info button
  // This adds: { tag: 'biz', attrs: { native_flow_name: 'payment_info' } }
  const buttonsNode = getButtonArgs(fullMsg.message!);
  const additionalNodes: unknown[] = [buttonsNode];

  // For private chats, add the bot node
  if (!isJidGroup(jid)) {
    additionalNodes.push({ tag: 'bot', attrs: { biz_bot: '1' } });
  }

  // Relay the message with the additional nodes
  await sock.relayMessage(jid, fullMsg.message!, {
    messageId: fullMsg.key.id!,
    additionalNodes: additionalNodes as Parameters<typeof sock.relayMessage>[2]['additionalNodes'],
  });

  return fullMsg.key.id ?? undefined;
}
