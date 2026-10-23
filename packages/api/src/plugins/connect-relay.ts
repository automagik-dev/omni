/**
 * Scan to connect (packages/connect-relay): a device shows a QR that opens WhatsApp with
 * `omni-connect:<slot>.<key>` typed. When the owner sends it to themselves, this subscriber
 * mints the device its key, seals this Omni's address and that key with the pairing key, and
 * leaves the box on the relay for the device to collect. The device never typed an address;
 * the relay never saw one.
 *
 * Only the owner's own fresh text in their own self chat counts, exactly as for device login
 * (plugins/device-login.ts): nobody else, not even a key that may send messages through this
 * Omni, can answer a pairing. The slot must still be waiting on the relay before a key is
 * minted, and a key the relay then refuses is revoked at once.
 */

import {
  type ConnectPayload,
  type Pairing,
  SLOT_TTL_MS,
  pairingInMessage,
  seal,
  writeTokenOf,
} from '@omni/connect-relay';
import type { EventBus, TypedOmniEvent } from '@omni/core';
import { classifyEnvelope, createLogger } from '@omni/core';
import { type Login, ownerOf } from '../login';
import { connectApprovedMessage } from '../login/messages';
import { platformTime } from '../services/whatsapp-self';
import { isOwnerSelfChatText } from './device-login';

const log = createLogger('connect-relay');

/** The device-flow client name the key and its event carry. */
export const SCAN_CLIENT = 'scan-to-connect';
const RELAY_TIMEOUT_MS = 10_000;
/** A pairing typed this long before now cannot belong to a slot that still lives. */
const CLOCK_SKEW_MS = 30 * 1000;

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined;

export type ConnectDeps = { fetch?: typeof fetch; now?: () => number; ownerOf?: typeof ownerOf };
export type ConnectResult = { slot: string; keyId: string } | null;

const slotUrl = (relayUrl: string, pairing: Pairing) => `${relayUrl}/v1/slots/${pairing.slot}`;

/** Answer the pairing the owner sent to themselves; null when the message answers nothing. */
export async function handleConnectMessage(
  login: Login,
  event: TypedOmniEvent<'message.received'>,
  deps: ConnectDeps = {},
): Promise<ConnectResult> {
  const relayUrl = login.config.connectRelayUrl;
  const pairing = pairingInMessage(event.payload.content.text);
  // Almost every message stops here, before any lookup.
  if (!pairing || !relayUrl || !event.metadata.instanceId) return null;
  if (classifyEnvelope(event.metadata).world !== 'legacy') return null;

  const owner = await (deps.ownerOf ?? ownerOf)(login);
  if (!owner?.phone) return null;
  const account = (await login.whatsapp.accounts()).find(
    (candidate) => candidate.instanceId === event.metadata.instanceId && candidate.phone === owner.phone,
  );
  if (!account || !isOwnerSelfChatText(event, account.selfJid)) return null;

  const now = deps.now?.() ?? Date.now();
  const at = platformTime(record(event.payload.rawPayload)?.messageTimestamp);
  const sentAt = at ? Date.parse(at) : event.timestamp;
  if (sentAt + SLOT_TTL_MS + CLOCK_SKEW_MS < now) return null;

  const fetchImpl = deps.fetch ?? fetch;
  const signal = () => AbortSignal.timeout(RELAY_TIMEOUT_MS);
  // The slot must be waiting: a stale or foreign pairing never costs a key.
  const waiting = await fetchImpl(slotUrl(relayUrl, pairing), { signal: signal() }).catch(() => null);
  if (waiting?.status !== 202) {
    log.info('Scan to connect: no waiting slot for this pairing', { status: waiting?.status ?? 'unreachable' });
    return null;
  }

  const keyExpiresAt = login.config.deviceKeyTtlDays
    ? new Date(now + login.config.deviceKeyTtlDays * 86_400_000)
    : undefined;
  const created = await login.services.apiKeys.create({
    name: 'device: scanned to connect',
    description: 'Authorized by the owner by sending a scan-to-connect code to themselves on WhatsApp',
    scopes: login.config.deviceKeyScopes,
    ...(keyExpiresAt ? { expiresAt: keyExpiresAt } : {}),
    createdBy: `login:${owner.id}`,
  });
  const payload: ConnectPayload = {
    url: login.config.publicUrl,
    apiKey: created.plainTextKey,
    keyId: created.key.id,
    scopes: created.key.scopes,
    keyExpiresAt: keyExpiresAt?.toISOString() ?? null,
  };
  const answered = await fetchImpl(slotUrl(relayUrl, pairing), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ writeToken: await writeTokenOf(pairing), box: await seal(pairing, payload) }),
    signal: signal(),
  }).catch(() => null);
  if (answered?.status !== 204) {
    // The device will never collect this key: it must not outlive the attempt.
    await login.services.apiKeys
      .revoke(created.key.id, 'scan to connect: the relay did not take the answer', 'connect-relay')
      .catch((error) => log.warn('Could not revoke an undelivered device key', { error: String(error) }));
    log.warn('Scan to connect: the relay refused the answer', { status: answered?.status ?? 'unreachable' });
    return null;
  }

  await login.eventBus?.publish('access.device_authorized', {
    userId: owner.id,
    clientId: SCAN_CLIENT,
    deviceName: 'scanned to connect',
    apiKeyId: created.key.id,
  });
  log.info('Scan to connect: device connected', { keyId: created.key.id });
  await login.whatsapp
    .sendToSelf(account, `connect-${pairing.slot}`, connectApprovedMessage())
    .catch((error) => log.warn('Could not confirm the connection in the self chat', { error: String(error) }));
  return { slot: pairing.slot, keyId: created.key.id };
}

export async function setupConnectRelay(eventBus: EventBus, login: Login | null): Promise<void> {
  if (!login?.config.connectRelayUrl) {
    log.debug('Scan to connect is off (human login off, or OMNI_CONNECT_RELAY_URL=off)');
    return;
  }
  await eventBus.subscribe('message.received', async (event) => void (await handleConnectMessage(login, event)), {
    durable: 'connect-relay',
    queue: 'connect-relay',
    maxRetries: 2,
    retryDelayMs: 1000,
    // A slot lives ten minutes: a recreated durable must not replay old messages.
    startFrom: 'new',
    concurrency: 1,
  });
  log.info('Scan to connect initialized', { relay: login.config.connectRelayUrl });
}
