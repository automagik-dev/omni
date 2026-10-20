/**
 * Device pairing by code (wish: omni-labs-distribution, Group 2).
 *
 * A device with no credential gets one by proving that someone who controls
 * the server's pairing WhatsApp account wants it to:
 *
 *   1. The device calls POST /pair/start and shows the returned code.
 *   2. Its owner sends that code to the pairing instance over WhatsApp: from
 *      the instance's own account in its "Message yourself" chat, or from a
 *      number on OMNI_PAIRING_ALLOWED_NUMBERS in a direct chat.
 *   3. The `device-pairing` subscriber sees the message and approves the row.
 *   4. The device's next poll (GET /pair/:id with its poll token) mints the
 *      key and receives it, once.
 *
 * Omni never sends a message to a number someone typed: the only message it
 * sends is a notice in the owner's own self chat after an owner approval.
 *
 * What is secret, and how it is kept:
 *   * The poll token (32 random bytes) is what the key is released to. Only its
 *     SHA-256 is stored, and it is compared in constant time.
 *   * The code is a rendezvous, not a credential: knowing one lets you do
 *     nothing unless an approver sends it. It is stored as SHA-256 too, so the
 *     table holds no usable value, but its strength is not what protects keys.
 *   * The key is minted at the consuming poll, never stored in this table.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { ChannelType, EventBus } from '@omni/core';
import { createLogger } from '@omni/core';
import type { Database, DevicePairing } from '@omni/db';
import { devicePairings } from '@omni/db';
import { and, count, eq, gt, lte } from 'drizzle-orm';
import { z } from 'zod';
import type { ApiKeyService } from './api-keys';

const log = createLogger('device-pairing');

/** Codes and pairings live this long. */
const PAIRING_TTL_MS = 10 * 60 * 1000;
/** Unexpired pending pairings one instance holds at most; starts beyond it are refused. */
export const MAX_PENDING_PER_INSTANCE = 20;
/** Unexpired pending pairings one client IP holds at most, so a few addresses cannot fill the instance's cap. */
export const MAX_PENDING_PER_IP = 3;
/** A code typed this long before the pairing was created is not taken as an answer to it. */
const CLOCK_SKEW_MS = 30 * 1000;

/** No 0/O, 1/I/L or U: the code is read off a screen and typed on a phone. */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 8;
const POLL_TOKEN_PREFIX = 'omni_pt_';

/** Scopes a paired key may never carry: everything, and the ability to mint or edit keys. */
const FORBIDDEN_SCOPE = /^(\*|keys:.*|platform:.*)$/;
const DEFAULT_SCOPES = ['instances:read', 'chats:read', 'messages:read', 'events:read'];

const csv = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

/** Server configuration, read from the environment and nowhere else. */
export const PairingConfigSchema = z.object({
  enabled: z.boolean(),
  instanceId: z.string().uuid().nullable(),
  allowedNumbers: z.array(z.string().regex(/^\d{8,15}$/, 'allowed numbers are digits only, with country code')),
  scopes: z
    .array(z.string().regex(/^[a-z][a-z0-9-]*:(\*|[a-z][a-z0-9-]*)$/, 'scopes look like resource:action'))
    .min(1)
    .refine((scopes) => !scopes.some((scope) => FORBIDDEN_SCOPE.test(scope)), {
      message: 'pairing keys may not carry *, keys:* or platform:* scopes',
    }),
  keyTtlDays: z.number().int().min(1).max(365),
  keyRateLimit: z.number().int().min(1).max(10000).nullable(),
  /** Base URL a paired device should use; when unset the device keeps the URL it paired against. */
  publicUrl: z.string().url().nullable(),
});
export type PairingConfig = z.infer<typeof PairingConfigSchema>;

export function readPairingConfig(env: NodeJS.ProcessEnv = process.env): PairingConfig {
  const scopes = csv(env.OMNI_PAIRING_KEY_SCOPES);
  return PairingConfigSchema.parse({
    enabled: env.OMNI_PAIRING_ENABLED === 'true',
    instanceId: env.OMNI_PAIRING_INSTANCE_ID?.trim() || null,
    allowedNumbers: csv(env.OMNI_PAIRING_ALLOWED_NUMBERS).map((number) => number.replace(/[^\d]/g, '')),
    scopes: scopes.length ? scopes : DEFAULT_SCOPES,
    keyTtlDays: Number(env.OMNI_PAIRING_KEY_TTL_DAYS || 90),
    keyRateLimit: env.OMNI_PAIRING_KEY_RATE_LIMIT ? Number(env.OMNI_PAIRING_KEY_RATE_LIMIT) : null,
    publicUrl: env.OMNI_PAIRING_PUBLIC_URL?.trim() || null,
  });
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export function generateCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * The code a message carries, or null. The whole message must be the code,
 * optionally after the word "Omni" (the text the wa.me link prefills), so a
 * code quoted inside a longer message never counts.
 */
export function codeInMessage(text: string | undefined): string | null {
  const match = text?.trim().match(/^(?:omni[\s:]*)?([a-z0-9]{4})[\s-]?([a-z0-9]{4})$/i);
  if (!match) return null;
  const code = `${match[1]}${match[2]}`.toUpperCase();
  if ([...code].some((char) => !CODE_ALPHABET.includes(char))) return null;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** Digits of a WhatsApp phone address ("5511…", "5511…:12", "5511…@s.whatsapp.net"); null for LIDs and groups. */
export function phoneDigits(address: string | undefined | null): string | null {
  if (!address) return null;
  const [user, server] = address.split('@');
  if (server && server !== 's.whatsapp.net') return null;
  const digits = (user ?? '').split(':')[0] ?? '';
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export type PairingStatus = 'pending' | 'approved' | 'consumed' | 'cancelled' | 'expired';

export interface PairingStarted {
  pairingId: string;
  code: string;
  pollToken: string;
  expiresAt: Date;
}

export interface PairingPoll {
  status: PairingStatus;
  /** Present exactly once: on the poll that consumed an approved pairing. */
  apiKey?: string;
  keyId?: string;
  scopes?: string[];
  keyExpiresAt?: Date;
}

export interface PairingApproval {
  pairing: DevicePairing;
  approver: 'owner' | 'allowlist';
}

/** The facts of a received message the approval rule reads, already extracted from the event. */
export interface PairingMessage {
  instanceId: string;
  channelType?: ChannelType;
  text: string | undefined;
  /** True only when the instance's own account wrote it in its own self chat (and it is fresh, not quoted). */
  ownerSelfChat: boolean;
  /** Sender phone digits for a direct message from someone else; null otherwise. */
  directSenderPhone: string | null;
  /** Platform id recorded as the approver. */
  sender: string;
  /** When the message was written, by the platform's clock. */
  sentAt: Date;
}

export class DevicePairingService {
  constructor(
    private db: Database,
    private apiKeys: ApiKeyService,
    private eventBus: EventBus | null,
  ) {}

  /** Start a pairing on `instanceId`. Returns null when the instance, or this client IP, already holds too many pending ones. */
  async start(input: {
    deviceName: string;
    instanceId: string;
    channelType: ChannelType;
    clientIp?: string | null;
  }): Promise<PairingStarted | null> {
    const now = new Date();
    const [pending] = await this.db
      .select({ value: count() })
      .from(devicePairings)
      .where(
        and(
          eq(devicePairings.instanceId, input.instanceId),
          eq(devicePairings.status, 'pending'),
          gt(devicePairings.expiresAt, now),
        ),
      );
    if ((pending?.value ?? 0) >= MAX_PENDING_PER_INSTANCE) return null;
    if (input.clientIp) {
      const [mine] = await this.db
        .select({ value: count() })
        .from(devicePairings)
        .where(
          and(
            eq(devicePairings.clientIp, input.clientIp),
            eq(devicePairings.status, 'pending'),
            gt(devicePairings.expiresAt, now),
          ),
        );
      if ((mine?.value ?? 0) >= MAX_PENDING_PER_IP) return null;
    }

    const code = generateCode();
    const pollToken = `${POLL_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    const [row] = await this.db
      .insert(devicePairings)
      .values({
        deviceName: input.deviceName,
        codeHash: sha256(code),
        pollTokenHash: sha256(pollToken),
        instanceId: input.instanceId,
        clientIp: input.clientIp ?? null,
        expiresAt,
      })
      .returning({ id: devicePairings.id });
    if (!row) throw new Error('Failed to create device pairing');

    await this.eventBus?.publish(
      'access.device_pairing_started',
      { pairingId: row.id, instanceId: input.instanceId, deviceName: input.deviceName, expiresAt: expiresAt.getTime() },
      { instanceId: input.instanceId, channelType: input.channelType },
    );
    log.info('Device pairing started', { pairingId: row.id, instanceId: input.instanceId });
    return { pairingId: row.id, code, pollToken, expiresAt };
  }

  /** The pairing `id` if `pollToken` is its token; null for an unknown id or a wrong token alike. */
  private async owned(id: string, pollToken: string): Promise<DevicePairing | null> {
    const [row] = await this.db.select().from(devicePairings).where(eq(devicePairings.id, id)).limit(1);
    if (!row || !sameHash(row.pollTokenHash, sha256(pollToken))) return null;
    return row;
  }

  /**
   * Read a pairing as its device. An approved pairing is consumed by this read
   * and its key minted and returned; every later read reports `consumed`.
   */
  async poll(id: string, pollToken: string, config: PairingConfig): Promise<PairingPoll | null> {
    const row = await this.owned(id, pollToken);
    if (!row) return null;
    const now = new Date();
    if ((row.status === 'pending' || row.status === 'approved') && row.expiresAt <= now) return { status: 'expired' };
    if (row.status !== 'approved') return { status: row.status };

    // Exactly one poll wins the approved -> consumed transition.
    const [claimed] = await this.db
      .update(devicePairings)
      .set({ status: 'consumed', consumedAt: now })
      .where(and(eq(devicePairings.id, id), eq(devicePairings.status, 'approved'), gt(devicePairings.expiresAt, now)))
      .returning();
    if (!claimed) return { status: 'consumed' };

    const keyExpiresAt = new Date(now.getTime() + config.keyTtlDays * 86_400_000);
    let created: Awaited<ReturnType<ApiKeyService['create']>>;
    try {
      created = await this.apiKeys.create({
        name: `paired: ${claimed.deviceName}`,
        description: `Minted by device pairing ${claimed.id}, approved by ${claimed.approvedBy ?? 'unknown'}`,
        scopes: config.scopes,
        expiresAt: keyExpiresAt,
        ...(config.keyRateLimit ? { rateLimit: config.keyRateLimit } : {}),
        createdBy: `pairing:${claimed.id}`,
      });
    } catch (error) {
      // Put it back so the device's next poll can try again.
      await this.db
        .update(devicePairings)
        .set({ status: 'approved', consumedAt: null })
        .where(and(eq(devicePairings.id, id), eq(devicePairings.status, 'consumed')));
      throw error;
    }
    await this.db.update(devicePairings).set({ apiKeyId: created.key.id }).where(eq(devicePairings.id, id));
    log.info('Device pairing consumed', { pairingId: id, keyId: created.key.id });
    return {
      status: 'approved',
      apiKey: created.plainTextKey,
      keyId: created.key.id,
      scopes: created.key.scopes,
      keyExpiresAt,
    };
  }

  /**
   * Cancel a pending pairing as its device: true when it was pending, false when
   * it no longer is, null for an unknown id or a wrong token.
   */
  async cancel(id: string, pollToken: string): Promise<boolean | null> {
    const row = await this.owned(id, pollToken);
    if (!row) return null;
    const [cancelled] = await this.db
      .update(devicePairings)
      .set({ status: 'cancelled' })
      .where(and(eq(devicePairings.id, id), eq(devicePairings.status, 'pending')))
      .returning({ id: devicePairings.id });
    return Boolean(cancelled);
  }

  /**
   * Approve the pending pairing a message's code names, when the message comes
   * from an approver on the pairing instance. Null when it approves nothing.
   */
  async approveFromMessage(message: PairingMessage, config: PairingConfig): Promise<PairingApproval | null> {
    if (!config.enabled || !config.instanceId || message.instanceId !== config.instanceId) return null;
    const code = codeInMessage(message.text);
    if (!code) return null;
    const approver = message.ownerSelfChat
      ? 'owner'
      : message.directSenderPhone && config.allowedNumbers.includes(message.directSenderPhone)
        ? 'allowlist'
        : null;
    if (!approver) return null;

    const now = new Date();
    const [approved] = await this.db
      .update(devicePairings)
      .set({ status: 'approved', approvedBy: message.sender, approvedAt: now })
      .where(
        and(
          eq(devicePairings.codeHash, sha256(code)),
          eq(devicePairings.instanceId, message.instanceId),
          eq(devicePairings.status, 'pending'),
          gt(devicePairings.expiresAt, now),
          // A code written before its pairing existed (history sync, a replayed event) answers nothing.
          lte(devicePairings.createdAt, new Date(message.sentAt.getTime() + CLOCK_SKEW_MS)),
        ),
      )
      .returning();
    if (!approved) return null;

    await this.eventBus?.publish(
      'access.device_paired',
      {
        pairingId: approved.id,
        instanceId: approved.instanceId,
        deviceName: approved.deviceName,
        approvedBy: message.sender,
        approver,
      },
      { instanceId: approved.instanceId, channelType: message.channelType },
    );
    log.info('Device pairing approved', { pairingId: approved.id, approver });
    return { pairing: approved, approver };
  }
}
