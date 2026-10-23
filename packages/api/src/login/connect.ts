/**
 * Connect links: the owner texts "connect" to themselves on WhatsApp and Omni answers in
 * that self chat with a link that connects one device, nothing typed, no address to know.
 *
 * A link carries a grant: 144 random bits, kept only as a SHA-256 hash in Better Auth's
 * verification table (login_verifications), next to its phone codes. A grant works once,
 * for ten minutes, and at most MAX_LIVE are live at a time (a new one retires the oldest).
 * Opening the link's page only looks the grant up; the app spends it on
 * POST /api/v2/login/connect, which mints the device key. WhatsApp's link preview fetches
 * the page too, so looking must never spend it.
 */

import { createHash, randomBytes } from 'node:crypto';
import { loginVerifications } from '@omni/db';
import { and, asc, eq, gt, inArray, like, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Login } from './index';

export const CONNECT_TTL_MS = 10 * 60 * 1000;
/** Live links at a time; asking for another retires the oldest. */
export const MAX_LIVE = 3;
/** Links one self chat may ask for in a window. */
export const LINKS_PER_WINDOW = 5;
export const LINK_WINDOW_MS = 10 * 60 * 1000;

const PREFIX = 'omni-connect:';
/** What a grant looks like: base64url, 24 characters for 18 random bytes. */
export const GrantSchema = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
const GrantRecordSchema = z.object({ userId: z.string().min(1), instanceId: z.string().min(1) });
export type GrantRecord = z.infer<typeof GrantRecordSchema>;

const identifierOf = (grant: string) => `${PREFIX}${createHash('sha256').update(grant).digest('hex')}`;

/** True when a message asks for a connect link: the whole message is "connect" (or "omni connect", "conectar"). */
export function isConnectRequest(text: string | undefined): boolean {
  return /^(?:omni\s+)?(?:connect|conectar)$/i.test(text?.trim() ?? '');
}

/**
 * Whether the self chat `key` may get another link now: 0 when it may (and the link is
 * counted), else the seconds to wait.
 */
export function allowConnectLink(login: Login, key: string, now = Date.now()): number {
  const issued = (login.connectLinks.get(key) ?? []).filter((at) => now - at < LINK_WINDOW_MS);
  if (issued.length >= LINKS_PER_WINDOW) return Math.ceil((LINK_WINDOW_MS - (now - (issued[0] ?? now))) / 1000);
  issued.push(now);
  login.connectLinks.set(key, issued);
  return 0;
}

/** A new grant for the owner, after sweeping expired ones and retiring the oldest live ones over MAX_LIVE - 1. */
export async function mintConnectGrant(
  login: Login,
  record: GrantRecord,
  now = new Date(),
): Promise<{ grant: string; expiresAt: Date }> {
  const connect = like(loginVerifications.identifier, `${PREFIX}%`);
  await login.db.delete(loginVerifications).where(and(connect, lt(loginVerifications.expiresAt, now)));
  const live = await login.db
    .select({ id: loginVerifications.id })
    .from(loginVerifications)
    .where(connect)
    .orderBy(asc(loginVerifications.createdAt));
  const retire = live.slice(0, Math.max(0, live.length - (MAX_LIVE - 1))).map((row) => row.id);
  if (retire.length) await login.db.delete(loginVerifications).where(inArray(loginVerifications.id, retire));

  const grant = randomBytes(18).toString('base64url');
  const expiresAt = new Date(now.getTime() + CONNECT_TTL_MS);
  await login.db.insert(loginVerifications).values({
    id: crypto.randomUUID(),
    identifier: identifierOf(grant),
    value: JSON.stringify(GrantRecordSchema.parse(record)),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return { grant, expiresAt };
}

/** Whether a grant is live, without spending it. */
export async function isLiveGrant(login: Login, grant: string): Promise<boolean> {
  if (!GrantSchema.safeParse(grant).success) return false;
  const [row] = await login.db
    .select({ id: loginVerifications.id })
    .from(loginVerifications)
    .where(and(eq(loginVerifications.identifier, identifierOf(grant)), gt(loginVerifications.expiresAt, new Date())))
    .limit(1);
  return row !== undefined;
}

/** Spend a grant: its record when it was live, else null. Under a race exactly one caller gets it. */
export async function consumeConnectGrant(login: Login, grant: string): Promise<GrantRecord | null> {
  const [row] = await login.db
    .delete(loginVerifications)
    .where(and(eq(loginVerifications.identifier, identifierOf(grant)), gt(loginVerifications.expiresAt, new Date())))
    .returning({ value: loginVerifications.value });
  if (!row) return null;
  try {
    const parsed = GrantRecordSchema.safeParse(JSON.parse(row.value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
