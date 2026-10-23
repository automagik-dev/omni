/**
 * Device approval over WhatsApp (wish: omni-labs-distribution).
 *
 * A device (desktop app, DSH plugin, CLI) shows a QR that opens the owner's
 * "Message yourself" chat with "Omni XXXX-XXXX" typed: its Better Auth device-flow
 * user code. When the owner sends it, this subscriber approves that device code
 * as the owner, exactly as the approval page would, and says so in the same chat.
 *
 * The other way round needs no address at all: the owner texts "connect" there and
 * gets back a one-time link that connects one device (login/connect.ts).
 *
 * The same chat carries the owner's yes for an update an app asked for: `update <CODE>`
 * (system/update.ts).
 *
 * It counts only the owner's own fresh text in their own self chat, typed on one
 * of their devices: Baileys delivered it as 'notify', never as 'append', which is
 * how Omni's own sends arrive. Not quoted, forwarded, a protocol message or history
 * sync, and not written before the device asked. So nobody but the owner, not even
 * a key that may send messages through this Omni, can approve a device this way.
 */

import type { EventBus, TypedOmniEvent } from '@omni/core';
import { classifyEnvelope, createLogger } from '@omni/core';
import { type Login, deviceRequestOf, ownerOf } from '../login';
import { DEVICE_CLIENTS, isDeviceClient } from '../login/config';
import { CONNECT_TTL_MS, allowConnectLink, isConnectRequest, mintConnectGrant } from '../login/connect';
import { connectLinkMessage, connectTooSoonMessage, deviceApprovedMessage } from '../login/messages';
import { updateCodeInMessage } from '../login/update-requests';
import type { OwnAccount } from '../login/whatsapp';
import { platformTime } from '../services/whatsapp-self';
import type { SystemUpdater } from '../system/update';

const log = createLogger('device-login');

/** How long a device code lives (login/auth.ts, deviceAuthorization expiresIn). */
const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
/** A code typed this long before its device asked is not taken as an answer to it. */
const CLOCK_SKEW_MS = 30 * 1000;
/** A "connect" older than this (a replayed or delayed event) gets no link. */
const CONNECT_FRESH_MS = 2 * 60 * 1000;
/** Better Auth's user-code alphabet. */
const USER_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : undefined;

/**
 * The device user code a message carries, normalized, or null. The whole message must
 * be the code, optionally after "Omni" (the text the QR prefills), so a code quoted
 * inside a longer message never counts.
 */
export function userCodeInMessage(text: string | undefined): string | null {
  const match = text?.trim().match(/^(?:omni[\s:]*)?([a-z0-9]{4})[\s-]?([a-z0-9]{4})$/i);
  if (!match) return null;
  const code = `${match[1]}${match[2]}`.toUpperCase();
  return [...code].every((char) => USER_CODE_CHARS.includes(char)) ? code : null;
}

/** True when the message is the account's own fresh text in its own self chat, typed on one of its devices. */
export function isOwnerSelfChatText(event: TypedOmniEvent<'message.received'>, selfJid: string | null): boolean {
  const { payload } = event;
  const raw = record(payload.rawPayload);
  const key = record(raw?.key);
  const message = record(raw?.message);
  const extended = record(message?.extendedTextMessage);
  const context = record(extended?.contextInfo);
  // The self chat may be addressed by the account's phone JID or, on LID-first accounts,
  // by its LID, with the phone JID beside it as remoteJidAlt.
  const selfChat =
    selfJid !== null &&
    (key?.remoteJid === selfJid || key?.remoteJidAlt === selfJid) &&
    (payload.chatId === selfJid || payload.chatId === key?.remoteJid);
  return (
    selfChat &&
    raw?.upsertType === 'notify' &&
    payload.content.type === 'text' &&
    key?.fromMe === true &&
    raw?.isFromMe === true &&
    raw.isHistorySync !== true &&
    !payload.replyToId &&
    !raw.quotedMessage &&
    !context?.quotedMessage &&
    !context?.isForwarded &&
    !context?.forwardingScore &&
    !message?.protocolMessage
  );
}

export type DeviceApproval = { userCode: string; clientId: string | null };

/** The owner and their account when the event is the owner's own fresh text in their own self chat, else null. */
async function ownerSelfChat(
  login: Login,
  event: TypedOmniEvent<'message.received'>,
): Promise<{ owner: { id: string; phone: string }; account: OwnAccount; sentAt: number } | null> {
  if (!event.metadata.instanceId) return null;
  // Device keys are legacy keys; a tenant-stamped (or quarantined) envelope approves nothing.
  if (classifyEnvelope(event.metadata).world !== 'legacy') return null;
  const owner = await ownerOf(login);
  if (!owner?.phone) return null;
  const account = (await login.whatsapp.accounts()).find(
    (candidate) => candidate.instanceId === event.metadata.instanceId && candidate.phone === owner.phone,
  );
  if (!account || !isOwnerSelfChatText(event, account.selfJid)) return null;
  const at = platformTime(record(event.payload.rawPayload)?.messageTimestamp);
  return { owner: { id: owner.id, phone: owner.phone }, account, sentAt: at ? Date.parse(at) : event.timestamp };
}

/** Approve the device whose code the owner sent to themselves; null when the message approves nothing. */
export async function handleDeviceLoginMessage(
  login: Login,
  event: TypedOmniEvent<'message.received'>,
): Promise<DeviceApproval | null> {
  const userCode = userCodeInMessage(event.payload.content.text);
  // Almost every message stops here, before any lookup.
  if (!userCode) return null;
  const self = await ownerSelfChat(login, event);
  if (!self) return null;
  const { owner, account, sentAt } = self;

  const { adapter } = await login.auth.$context;
  const deviceCode = await adapter.findOne<{ id: string; status: string; expiresAt: Date; clientId?: string | null }>({
    model: 'deviceCode',
    where: [{ field: 'userCode', value: userCode }],
  });
  if (!deviceCode || deviceCode.status !== 'pending') return null;
  const expiresAt = new Date(deviceCode.expiresAt).getTime();
  if (expiresAt <= Date.now()) return null;
  // A code written before its device asked (history, a replayed event) answers nothing.
  if (sentAt + CLOCK_SKEW_MS < expiresAt - DEVICE_CODE_TTL_MS) return null;

  const approved = await adapter.update<{ id: string }>({
    model: 'deviceCode',
    where: [
      { field: 'id', value: deviceCode.id },
      { field: 'status', value: 'pending' },
    ],
    update: { status: 'approved', userId: owner.id },
  });
  if (!approved) return null;

  const clientId = deviceCode.clientId ?? null;
  const what = clientId && isDeviceClient(clientId) ? DEVICE_CLIENTS[clientId] : 'A device';
  // Say who asked, so a code someone talked the owner into sending does not pass unnoticed
  // (RFC 8628 section 5.4, remote phishing).
  const request = deviceRequestOf(login, userCode);
  log.info('Device approved over WhatsApp', { clientId });
  await login.whatsapp
    .sendToSelf(account, `device-${deviceCode.id}`, deviceApprovedMessage(what, request ?? undefined))
    .catch((error) => log.warn('Could not confirm the approval in the self chat', { error: String(error) }));
  return { userCode, clientId };
}

export type ConnectLink = { url: string; expiresAt: Date } | { retryAfterSeconds: number };

/**
 * Answer the owner's "connect" in their self chat with a one-time connect link; null when
 * the message is not that. Too many in a window get a "wait" instead of a link.
 */
export async function handleConnectMessage(
  login: Login,
  event: TypedOmniEvent<'message.received'>,
): Promise<ConnectLink | null> {
  if (!isConnectRequest(event.payload.content.text)) return null;
  const self = await ownerSelfChat(login, event);
  if (!self || self.sentAt < Date.now() - CONNECT_FRESH_MS) return null;
  const { owner, account } = self;

  const wait = allowConnectLink(login, account.instanceId);
  if (wait > 0) {
    await login.whatsapp
      .sendToSelf(account, `connect-wait-${Date.now()}`, connectTooSoonMessage(wait))
      .catch((error) => log.warn('Could not answer connect in the self chat', { error: String(error) }));
    return { retryAfterSeconds: wait };
  }
  const { grant, expiresAt } = await mintConnectGrant(login, { userId: owner.id, instanceId: account.instanceId });
  const url = `${login.config.publicUrl}/api/login/app?grant=${grant}`;
  await login.eventBus?.publish(
    'access.connect_link_issued',
    { userId: owner.id, instanceId: account.instanceId, expiresAt: expiresAt.toISOString() },
    { instanceId: account.instanceId, channelType: 'whatsapp-baileys' },
  );
  log.info('Connect link issued in the self chat', { instanceId: account.instanceId });
  await login.whatsapp
    .sendToSelf(account, `connect-${expiresAt.getTime()}`, connectLinkMessage(url, CONNECT_TTL_MS / 60_000))
    .catch((error) => log.warn('Could not send the connect link to the self chat', { error: String(error) }));
  return { url, expiresAt };
}

/**
 * Answer the owner's `update <CODE>` in their self chat: start the update it confirms. Null
 * when the message is not that, nothing was waiting, or it is not the owner's fresh text.
 */
export async function handleUpdateMessage(
  login: Login,
  updater: SystemUpdater,
  event: TypedOmniEvent<'message.received'>,
): Promise<Awaited<ReturnType<SystemUpdater['confirm']>>> {
  const code = updateCodeInMessage(event.payload.content.text);
  if (!code) return null;
  const self = await ownerSelfChat(login, event);
  if (!self || self.sentAt < Date.now() - CONNECT_FRESH_MS) return null;
  return updater.confirm(code, self.account);
}

export async function setupDeviceLogin(
  eventBus: EventBus,
  login: Login | null,
  updater: SystemUpdater | null = null,
): Promise<void> {
  if (!login) {
    log.debug('Human login is off (OMNI_LOGIN_ENABLED)');
    return;
  }
  const handle = async (event: TypedOmniEvent<'message.received'>) =>
    (await handleConnectMessage(login, event)) ??
    (updater ? await handleUpdateMessage(login, updater, event) : null) ??
    (await handleDeviceLoginMessage(login, event));
  await eventBus.subscribe('message.received', async (event) => void (await handle(event)), {
    durable: 'device-login',
    queue: 'device-login',
    maxRetries: 2,
    retryDelayMs: 1000,
    // A device code is only good for ten minutes: a recreated durable must not replay old messages.
    startFrom: 'new',
    concurrency: 1,
  });
  log.info('Device approval over WhatsApp initialized');
}
