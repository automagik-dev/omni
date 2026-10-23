/**
 * Omni's human login, assembled once per app (wish: omni-labs-distribution).
 * See auth.ts for the Better Auth setup and routes/v2/login.ts for the surface.
 */

import type { EventBus } from '@omni/core';
import { createLogger } from '@omni/core';
import type { Database } from '@omni/db';
import { loginUsers } from '@omni/db';
import { asc } from 'drizzle-orm';
import { phoneDigits } from '../lib/phone';
import type { Services } from '../services';
import { type LoginAuth, createLoginAuth } from './auth';
import { type LoginConfig, claimTokenOf, readLoginConfig } from './config';
import { type OwnAccount, type WhatsAppAccess, accountByPhone, whatsappAccess } from './whatsapp';

const log = createLogger('login');

export interface Login {
  config: LoginConfig;
  auth: LoginAuth;
  db: Database;
  services: Services;
  eventBus: EventBus | null;
  whatsapp: WhatsAppAccess;
  /** Where each device-flow request came from, by user code, for the owner's WhatsApp confirmation. */
  deviceRequests: Map<string, { ip: string | null; at: number }>;
  /** When codes were last sent to each number (for the per-number cooldown). */
  codeSends: Map<string, number[]>;
  /** When connect links were last issued in each self chat (login/connect.ts). */
  connectLinks: Map<string, number[]>;
}

/** Login for this app, or null when it is off (OMNI_LOGIN_ENABLED unset, multitenancy on, or misconfigured). */
export function createLogin(
  db: Database,
  services: Services,
  eventBus: EventBus | null,
  whatsapp: WhatsAppAccess = whatsappAccess(services),
): Login | null {
  let config: LoginConfig | null;
  try {
    config = readLoginConfig();
  } catch (error) {
    log.error('Human login is misconfigured and stays off', { error: String(error) });
    return null;
  }
  if (!config) return null;
  return {
    config,
    auth: createLoginAuth({ db, whatsapp, config }),
    db,
    services,
    eventBus,
    whatsapp,
    deviceRequests: new Map(),
    codeSends: new Map(),
    connectLinks: new Map(),
  };
}

/** The owner, or null while the Omni is unclaimed. */
export async function ownerOf(login: Login): Promise<{ id: string; phone: string | null } | null> {
  const [owner] = await login.db
    .select({ id: loginUsers.id, phoneNumber: loginUsers.phoneNumber })
    .from(loginUsers)
    .orderBy(asc(loginUsers.createdAt))
    .limit(1);
  return owner ? { id: owner.id, phone: phoneDigits(owner.phoneNumber) } : null;
}

/** The owner's connected WhatsApp account, or null (unclaimed, or that account is not connected now). */
export async function ownerAccount(login: Login): Promise<OwnAccount | null> {
  const owner = await ownerOf(login);
  return owner?.phone ? accountByPhone(login.whatsapp, owner.phone) : null;
}

/** Say once at boot how to claim an unclaimed Omni. */
export async function announceClaim(login: Login): Promise<void> {
  if (await ownerOf(login)) return;
  log.info(
    `This Omni has no owner yet. Claim it: ${login.config.publicUrl}/api/login/claim?token=${claimTokenOf(login.config)}`,
  );
}

const CODE_COOLDOWN_MS = 60_000;
const CODES_PER_DAY = 10;
const DAY_MS = 86_400_000;

/**
 * Whether a login code may go to `phone` now: 0 when it may (and the send is counted),
 * else the seconds to wait. One code a minute and ten a day per number, whatever address
 * asks, so nobody can flood the owner's self chat by asking from many addresses.
 */
export function allowCodeSend(login: Login, phone: string, now = Date.now()): number {
  const sends = (login.codeSends.get(phone) ?? []).filter((at) => now - at < DAY_MS);
  const last = sends.at(-1);
  if (last !== undefined && now - last < CODE_COOLDOWN_MS) return Math.ceil((CODE_COOLDOWN_MS - (now - last)) / 1000);
  if (sends.length >= CODES_PER_DAY) return Math.ceil((DAY_MS - (now - (sends[0] ?? now))) / 1000);
  sends.push(now);
  login.codeSends.set(phone, sends);
  return 0;
}

/** Where a device request came from, kept ten minutes (a device code's life). */
export function deviceRequestOf(login: Login, userCode: string): { ip: string | null; at: number } | null {
  const now = Date.now();
  for (const [code, request] of login.deviceRequests) if (now - request.at > 600_000) login.deviceRequests.delete(code);
  return login.deviceRequests.get(userCode) ?? null;
}
