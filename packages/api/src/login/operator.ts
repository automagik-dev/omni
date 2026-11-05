/**
 * The operator's way in (wish: omni-labs-distribution): whoever runs this server owns it.
 *
 * Proof of that is the claim token printed in the boot log, or an admin key (`auth:admin`,
 * which the primary key holds) used through /api/v2/owner (`omni claim`, `omni approve`,
 * `omni connect`). Either one claims an unclaimed Omni and makes its owner, with no
 * WhatsApp anywhere. A WhatsApp number stays optional: the owner can link one later, so
 * approvals can come from their phone (routes/v2/login.ts, claim/verify).
 *
 * Nothing here adds power: a key that may reach these routes can already do everything
 * the owner can. Device keys never carry `auth:*` (login/config.ts).
 */

import { loginUsers } from '@omni/db';
import { DEVICE_CLIENTS, isDeviceClient } from './config';
import { allowConnectLink, mintConnectGrant } from './connect';
import { type Login, deviceRequestOf, ownerAccount, ownerOf } from './index';
import { deviceApprovedMessage } from './messages';

export type OwnerProof = { via: 'claim-token' } | { via: 'operator'; apiKeyId: string };

type Owner = { id: string; phone: string | null };

/**
 * The owner, after claiming the Omni for the operator when nobody has yet. The one place
 * an owner without a phone is made; `claimed` says whether this call made it.
 */
export async function claimForOperator(login: Login, proof: OwnerProof): Promise<{ owner: Owner; claimed: boolean }> {
  const existing = await ownerOf(login);
  if (existing) return { owner: existing, claimed: false };
  const id = crypto.randomUUID();
  // login_users holds one row at most (login_users_one_owner): of two claims at once, one lands.
  await login.db
    .insert(loginUsers)
    .values({ id, name: 'Owner', email: `owner-${id}@operator.omni.invalid`, emailVerified: false })
    .onConflictDoNothing();
  const owner = await ownerOf(login);
  if (!owner) throw new Error('The Omni could not be claimed');
  const claimed = owner.id === id;
  if (claimed) {
    await login.eventBus?.publish('access.owner_claimed', {
      userId: owner.id,
      via: proof.via,
      ...(proof.via === 'operator' ? { apiKeyId: proof.apiKeyId } : {}),
    });
  }
  return { owner, claimed };
}

/** The user codes the device flow issues, as typed: case and dashes do not matter. */
const normalizeUserCode = (userCode: string) => userCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();

/** A pending, unexpired device-flow request for this user code, or null. */
export async function pendingDeviceCode(login: Login, userCode: string) {
  const { adapter } = await login.auth.$context;
  const row = await adapter.findOne<{ id: string; status: string; expiresAt: Date; clientId?: string | null }>({
    model: 'deviceCode',
    where: [{ field: 'userCode', value: normalizeUserCode(userCode) }],
  });
  return row && row.status === 'pending' && new Date(row.expiresAt).getTime() > Date.now() ? row : null;
}

export type OperatorApproval =
  | {
      ok: true;
      clientId: string | null;
      client: string;
      claimed: boolean;
      requestedFrom: { ip: string | null; at: number } | null;
    }
  | { ok: false; code: 'UNKNOWN_CODE'; message: string };

/**
 * Approve a waiting device as the owner (`omni approve <code>`). An unknown or expired code
 * approves nothing and claims nothing; a good one on an unclaimed Omni claims it first.
 */
export async function approveAsOperator(login: Login, userCode: string, apiKeyId: string): Promise<OperatorApproval> {
  const pending = await pendingDeviceCode(login, userCode);
  if (!pending) {
    return { ok: false, code: 'UNKNOWN_CODE', message: 'No device is waiting with that code. It may have expired.' };
  }
  const { owner, claimed } = await claimForOperator(login, { via: 'operator', apiKeyId });
  const { adapter } = await login.auth.$context;
  const approved = await adapter.update<{ id: string }>({
    model: 'deviceCode',
    where: [
      { field: 'id', value: pending.id },
      { field: 'status', value: 'pending' },
    ],
    update: { status: 'approved', userId: owner.id },
  });
  if (!approved) {
    return { ok: false, code: 'UNKNOWN_CODE', message: 'That device was answered meanwhile, or its code expired.' };
  }
  const clientId = pending.clientId ?? null;
  const client = clientId && isDeviceClient(clientId) ? DEVICE_CLIENTS[clientId] : 'a device';
  const requestedFrom = deviceRequestOf(login, normalizeUserCode(userCode));
  await login.eventBus?.publish('access.device_code_approved', {
    userId: owner.id,
    clientId,
    via: 'operator',
    apiKeyId,
  });
  // An owner with WhatsApp hears about it there too, as with every approval.
  const account = await ownerAccount(login);
  if (account) {
    await login.whatsapp
      .sendToSelf(account, `device-${pending.id}`, deviceApprovedMessage(client, requestedFrom ?? undefined))
      .catch(() => undefined);
  }
  return { ok: true, clientId, client, claimed, requestedFrom };
}

export type OperatorConnectLink =
  | { ok: true; url: string; appLink: string; expiresAt: Date; claimed: boolean }
  | { ok: false; code: 'TOO_SOON'; message: string; retryAfterSeconds: number };

/**
 * A one-time connect link for one device (`omni connect`): the same grant the WhatsApp
 * "connect" reply carries. `origin` is where devices reach this Omni: the configured public
 * URL wins, then what the operator passed, then the address the operator's own request used.
 */
export async function connectLinkForOperator(
  login: Login,
  origin: string,
  apiKeyId: string,
): Promise<OperatorConnectLink> {
  const wait = allowConnectLink(login, `operator:${apiKeyId}`);
  if (wait > 0) {
    return {
      ok: false,
      code: 'TOO_SOON',
      message: `Wait ${wait} s before asking for another link`,
      retryAfterSeconds: wait,
    };
  }
  const { owner, claimed } = await claimForOperator(login, { via: 'operator', apiKeyId });
  return { ok: true, ...(await operatorLink(login, owner.id, origin)), claimed };
}

/**
 * Claims an unclaimed Omni with the claim token, and hands the claimer the link that opens
 * Automagik connected to it (the claim page's last step), so the app needs no second sign-in:
 * the token already proved they run this server, as an admin key does for `omni connect`.
 * Null when someone owns the Omni already.
 */
export async function claimWithToken(
  login: Login,
  origin: string,
): Promise<{ url: string; appLink: string; expiresAt: Date } | null> {
  const { owner, claimed } = await claimForOperator(login, { via: 'claim-token' });
  return claimed ? operatorLink(login, owner.id, origin) : null;
}

/** A one-time connect link for the owner, asked for by the operator (an admin key or the claim token). */
async function operatorLink(login: Login, userId: string, origin: string) {
  const { grant, expiresAt } = await mintConnectGrant(login, { userId });
  await login.eventBus?.publish('access.connect_link_issued', {
    userId,
    expiresAt: expiresAt.toISOString(),
    via: 'operator',
  });
  const base = login.config.publicUrl ?? origin;
  return {
    url: `${base}/api/login/app?grant=${grant}`,
    appLink: `omni://connect?url=${encodeURIComponent(base)}&grant=${grant}`,
    expiresAt,
  };
}
