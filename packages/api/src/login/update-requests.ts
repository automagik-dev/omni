/**
 * Update requests waiting for the owner's yes (system/update.ts).
 *
 * An app or key asks this Omni to update; the owner confirms by texting `update <CODE>` to
 * themselves on WhatsApp. The code is six characters from Better Auth's user-code alphabet,
 * kept only as a SHA-256 hash in Better Auth's verification table (login_verifications), next
 * to the connect grants and phone codes. A code works once, for ten minutes, and only one
 * request waits at a time.
 */

import { createHash, randomInt } from 'node:crypto';
import { loginVerifications } from '@omni/db';
import { and, eq, gt, like, lt } from 'drizzle-orm';
import { z } from 'zod';
import type { Login } from './index';

export const UPDATE_CONFIRM_TTL_MS = 10 * 60 * 1000;

const PREFIX = 'omni-update:';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

const UpdateRequestSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  requestedBy: z.string().min(1),
});
export type UpdateRequest = z.infer<typeof UpdateRequestSchema>;

const identifierOf = (code: string) => `${PREFIX}${createHash('sha256').update(code).digest('hex')}`;
const pending = like(loginVerifications.identifier, `${PREFIX}%`);

/** The confirmation code a message carries ("update K7QM2X"), normalized, or null. The whole message must be that. */
export function updateCodeInMessage(text: string | undefined): string | null {
  const match = text?.trim().match(/^(?:omni\s+)?update\s+([a-z0-9]{6})$/i);
  const code = match?.[1]?.toUpperCase();
  return code && [...code].every((char) => CODE_CHARS.includes(char)) ? code : null;
}

/** The request waiting for the owner's yes, if any (without its code). */
async function pendingUpdate(
  login: Login,
  now = new Date(),
): Promise<{ request: UpdateRequest; expiresAt: Date } | null> {
  const [row] = await login.db
    .select({ value: loginVerifications.value, expiresAt: loginVerifications.expiresAt })
    .from(loginVerifications)
    .where(and(pending, gt(loginVerifications.expiresAt, now)))
    .limit(1);
  const request = row ? parseRequest(row.value) : null;
  return row && request ? { request, expiresAt: new Date(row.expiresAt) } : null;
}

/** A new request and its code, after sweeping expired ones. The caller has checked none is waiting. */
async function createUpdateRequest(
  login: Login,
  request: UpdateRequest,
  now = new Date(),
): Promise<{ code: string; expiresAt: Date }> {
  await login.db.delete(loginVerifications).where(and(pending, lt(loginVerifications.expiresAt, now)));
  const code = Array.from({ length: CODE_LENGTH }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('');
  const expiresAt = new Date(now.getTime() + UPDATE_CONFIRM_TTL_MS);
  await login.db.insert(loginVerifications).values({
    id: crypto.randomUUID(),
    identifier: identifierOf(code),
    value: JSON.stringify(UpdateRequestSchema.parse(request)),
    expiresAt,
    createdAt: now,
    updatedAt: now,
  });
  return { code, expiresAt };
}

/** Spend a code: its request when it was live, else null. Under a race exactly one caller gets it. */
async function consumeUpdateRequest(login: Login, code: string): Promise<UpdateRequest | null> {
  const [row] = await login.db
    .delete(loginVerifications)
    .where(and(eq(loginVerifications.identifier, identifierOf(code)), gt(loginVerifications.expiresAt, new Date())))
    .returning({ value: loginVerifications.value });
  return row ? parseRequest(row.value) : null;
}

/** Drop every waiting request (too many wrong codes). */
async function cancelUpdateRequests(login: Login): Promise<void> {
  await login.db.delete(loginVerifications).where(pending);
}

/** Where update requests wait for the owner's yes. */
export interface UpdateRequestStore {
  pending(): Promise<{ request: UpdateRequest; expiresAt: Date } | null>;
  create(request: UpdateRequest): Promise<{ code: string; expiresAt: Date }>;
  consume(code: string): Promise<UpdateRequest | null>;
  cancel(): Promise<void>;
}

/** The store in this Omni's database. */
export function updateRequestStore(login: Login): UpdateRequestStore {
  return {
    pending: () => pendingUpdate(login),
    create: (request) => createUpdateRequest(login, request),
    consume: (code) => consumeUpdateRequest(login, code),
    cancel: () => cancelUpdateRequests(login),
  };
}

function parseRequest(value: string): UpdateRequest | null {
  try {
    const parsed = UpdateRequestSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
