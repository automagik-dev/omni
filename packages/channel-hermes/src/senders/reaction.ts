/**
 * Hermes — emoji reaction sender.
 *
 * `messageId` is an incoming OR outgoing message id per the Hermes spec.
 * Pass an empty string for `emoji` to remove the reaction (same semantics
 * as Meta).
 */

import type { HermesClient } from '../client';
import type { HermesOutboundMessage, HermesSendResponse } from '../types';
import { HermesApiError, HermesErrorCode } from '../utils/errors';
import { toHermesPhone } from '../utils/identity';

export async function sendReaction(
  client: HermesClient,
  to: string,
  messageId: string,
  emoji: string,
): Promise<HermesSendResponse> {
  if (!messageId) {
    throw new HermesApiError(HermesErrorCode.INVALID_REQUEST, 'sendReaction requires a target messageId', {
      operation: 'sendReaction',
    });
  }
  const payload: HermesOutboundMessage = {
    to: toHermesPhone(to),
    recipient_type: 'individual',
    type: 'reaction',
    reaction: { message_id: messageId, emoji },
  };
  return client.sendMessage(payload);
}
