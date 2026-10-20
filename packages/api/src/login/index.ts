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
  return { config, auth: createLoginAuth({ db, whatsapp, config }), db, services, eventBus, whatsapp };
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
