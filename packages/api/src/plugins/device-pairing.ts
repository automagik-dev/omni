/**
 * Device pairing subscriber (wish: omni-labs-distribution, Group 2).
 *
 * Watches message.received on the pairing instance and approves the pending
 * pairing whose code a message carries, when the message comes from an
 * approver (see services/device-pairing.ts):
 *
 *   * owner — the instance's own account, in its own self chat, typed fresh:
 *     not quoted, not forwarded, not a protocol message, not history sync.
 *     Messages Omni itself sends (API sends, send-self) never reach here: the
 *     WhatsApp plugin drops its own echoes before publishing message.received.
 *   * allowlist — a number on OMNI_PAIRING_ALLOWED_NUMBERS, in a direct chat.
 *
 * After an owner approval it leaves a notice in the same self chat naming the
 * device, so a code someone talked the owner into sending does not pass
 * unnoticed. It never messages anyone else.
 */

import type { EventBus, TypedOmniEvent } from '@omni/core';
import { classifyEnvelope, createLogger } from '@omni/core';
import type { Services } from '../services';
import {
  type PairingApproval,
  type PairingConfig,
  type PairingMessage,
  codeInMessage,
  phoneDigits,
  readPairingConfig,
} from '../services/device-pairing';
import { type SelfIdentity, type SelfPlugin, platformTime, selfPlugin } from '../services/whatsapp-self';
import { getPlugin } from './loader';

const log = createLogger('device-pairing');

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined;

async function selfOf(instanceId: string): Promise<{ plugin: SelfPlugin; identity: SelfIdentity } | null> {
  try {
    const plugin = selfPlugin(await getPlugin('whatsapp-baileys'));
    return { plugin, identity: plugin.getSelfIdentity(instanceId) };
  } catch {
    return null;
  }
}

/** True when the message is the owner's own fresh text in the owner's own self chat. */
export function isOwnerSelfChatText(event: TypedOmniEvent<'message.received'>, selfJid: string | null): boolean {
  const { payload } = event;
  const raw = record(payload.rawPayload);
  const key = record(raw?.key);
  const message = record(raw?.message);
  const extended = record(message?.extendedTextMessage);
  const context = record(extended?.contextInfo);
  return (
    selfJid !== null &&
    payload.content.type === 'text' &&
    key?.fromMe === true &&
    raw?.isFromMe === true &&
    key.remoteJid === selfJid &&
    payload.chatId === selfJid &&
    raw.isHistorySync !== true &&
    !payload.replyToId &&
    !raw.quotedMessage &&
    !context?.quotedMessage &&
    !context?.isForwarded &&
    !context?.forwardingScore &&
    !message?.protocolMessage
  );
}

/** Sender phone digits for a direct message written by someone else; null for groups and own messages. */
export function directSenderPhone(event: TypedOmniEvent<'message.received'>): string | null {
  const { payload } = event;
  const raw = record(payload.rawPayload);
  const key = record(raw?.key);
  if (key?.fromMe === true || raw?.isFromMe === true) return null;
  if (!payload.chatId || payload.chatId.endsWith('@g.us') || key?.participant) return null;
  const resolved = typeof raw?.resolvedSenderPhone === 'string' ? raw.resolvedSenderPhone : null;
  return phoneDigits(resolved) ?? phoneDigits(payload.from);
}

function pairingMessageOf(
  event: TypedOmniEvent<'message.received'>,
  instanceId: string,
  selfJid: string | null,
): PairingMessage {
  const raw = record(event.payload.rawPayload);
  const at = platformTime(raw?.messageTimestamp);
  return {
    instanceId,
    channelType: event.metadata.channelType,
    text: event.payload.content.text,
    ownerSelfChat: isOwnerSelfChatText(event, selfJid),
    directSenderPhone: directSenderPhone(event),
    sender: event.payload.from,
    sentAt: at ? new Date(at) : new Date(event.timestamp),
  };
}

async function noticeOwner(self: { plugin: SelfPlugin; identity: SelfIdentity }, approval: PairingApproval) {
  const { pairing } = approval;
  const from = pairing.clientIp ? ` from ${pairing.clientIp}` : '';
  try {
    await self.plugin.sendSelf(pairing.instanceId, {
      expectedOwner: self.identity.ownerIdentifier,
      expectedGeneration: self.identity.generation,
      operationKey: `pairing-${pairing.id}`,
      text: `Omni: paired "${pairing.deviceName}"${from}. Not you? Revoke the key "paired: ${pairing.deviceName}" in Omni.`,
    });
  } catch (error) {
    log.warn('Could not leave the pairing notice in the self chat', { pairingId: pairing.id, error: String(error) });
  }
}

export async function handlePairingMessage(
  services: Services,
  config: PairingConfig,
  event: TypedOmniEvent<'message.received'>,
): Promise<PairingApproval | null> {
  const instanceId = event.metadata.instanceId;
  if (!instanceId || instanceId !== config.instanceId) return null;
  // Almost every message stops here, before any lookup.
  if (!codeInMessage(event.payload.content.text)) return null;
  // Paired keys are legacy keys; a tenant-stamped (or quarantined) envelope approves nothing.
  if (classifyEnvelope(event.metadata).world !== 'legacy') return null;

  const self = await selfOf(instanceId);
  const approval = await services.devicePairing.approveFromMessage(
    pairingMessageOf(event, instanceId, self?.identity.selfJid ?? null),
    config,
  );
  if (approval?.approver === 'owner' && self) await noticeOwner(self, approval);
  return approval;
}

export async function setupDevicePairing(eventBus: EventBus, services: Services): Promise<void> {
  const config = readPairingConfig();
  if (!config.enabled || !config.instanceId) {
    log.debug('Device pairing is off (OMNI_PAIRING_ENABLED / OMNI_PAIRING_INSTANCE_ID)');
    return;
  }
  await eventBus.subscribe(
    'message.received',
    async (event) => void (await handlePairingMessage(services, config, event)),
    {
      durable: 'device-pairing',
      queue: 'device-pairing',
      maxRetries: 2,
      retryDelayMs: 1000,
      // A code is only good for ten minutes: a recreated durable must not replay old messages.
      startFrom: 'new',
      concurrency: 1,
    },
  );
  log.info('Device pairing initialized', { instanceId: config.instanceId });
}
