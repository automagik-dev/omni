/**
 * WhatsApp message-secret decryption (`secretEncryptedMessage`).
 *
 * WhatsApp moved message edits to the msgSecret envelope: instead of a plaintext
 * `protocolMessage` type 14, the edit arrives as
 *
 *   secretEncryptedMessage { encIv, encPayload, secretEncType: MESSAGE_EDIT, targetMessageKey }
 *
 * with the new content encrypted under the ORIGINAL message's
 * `messageContextInfo.messageSecret`. Baileys carries the protobuf for it
 * (`SecretEncType.MESSAGE_EDIT = 2`) but ships no decryptor, so the envelope
 * reaches us opaque and the edit is lost (#1061).
 *
 * Scheme (matches whatsmeow's `generateMsgSecretKey`, msgsecret.go):
 *
 *   useCase   = origMsgId ‖ origSenderJid ‖ modificationSenderJid ‖ "Message Edit"
 *   key       = HKDF-SHA256(ikm = origMessageSecret, salt = ∅, info = useCase, len = 32)
 *   plaintext = AES-256-GCM(key, encIv, encPayload)      // no AAD for edits —
 *               only Poll Vote / Event Response use `${origMsgId}\0${sender}`
 *
 * Both JIDs are the non-AD form (`user@server`, device suffix stripped). Verified
 * against a real captured edit: the LID form of the sender decrypts on both sides,
 * so callers should try the addressing form the event carries first and fall back.
 */

import { createDecipheriv, hkdfSync } from 'node:crypto';
import { createLogger } from '@omni/core';

const log = createLogger('whatsapp:msg-secret');

/** `EncSecretMessageEdit` in whatsmeow's MsgSecretType table. */
export const MSG_SECRET_MESSAGE_EDIT = 'Message Edit';

/**
 * Secrets of recently seen messages, so an edit arriving minutes later can be read.
 *
 * WhatsApp does not repeat the original `messageSecret` in the edit envelope, so it
 * has to come from the message being edited. whatsmeow keeps a durable
 * `MsgSecrets` store; this is the in-process equivalent — bounded and insertion-ordered,
 * which covers the common case (edit shortly after the message) without a schema change.
 * A miss degrades exactly to today's behaviour: the edit stays unreadable, nothing throws.
 */
const SECRETS = new Map<string, { secret: Uint8Array; senderJid: string }>();
const SECRETS_MAX = 2000;

/** Remember an inbound message's secret, keyed by its external id. */
export function rememberMessageSecret(externalId: string, secret: Uint8Array, senderJid: string): void {
  if (!externalId || !secret?.length) return;
  if (SECRETS.has(externalId)) SECRETS.delete(externalId);
  else if (SECRETS.size >= SECRETS_MAX) SECRETS.delete(SECRETS.keys().next().value as string);
  SECRETS.set(externalId, { secret, senderJid });
}

export function getMessageSecret(externalId: string): { secret: Uint8Array; senderJid: string } | undefined {
  return SECRETS.get(externalId);
}

/** Strip the device suffix: `5511999@s.whatsapp.net:12` → `5511999@s.whatsapp.net`. */
export function toNonAdJid(jid: string): string {
  const [user, server] = jid.split('@');
  return `${(user ?? '').split(':')[0]}@${server ?? 's.whatsapp.net'}`;
}

export interface MsgSecretInput {
  encIv: Uint8Array;
  encPayload: Uint8Array;
  /** `messageContextInfo.messageSecret` of the ORIGINAL (target) message. */
  originalMessageSecret: Uint8Array;
  originalMessageId: string;
  /** Sender of the original message (non-AD form). */
  originalSenderJid: string;
  /** Sender of the modification — same person for a self-edit (non-AD form). */
  modificationSenderJid: string;
  useCase?: string;
}

/**
 * Decrypt a msgSecret-encrypted payload. Returns the plaintext protobuf bytes, or
 * null when authentication fails (wrong secret, wrong sender form, unknown scheme) —
 * callers treat null as "cannot read this edit" and fall back to today's behaviour.
 */
export function decryptMsgSecret(input: MsgSecretInput): Buffer | null {
  const useCase = input.useCase ?? MSG_SECRET_MESSAGE_EDIT;
  const info = Buffer.concat([
    Buffer.from(input.originalMessageId),
    Buffer.from(toNonAdJid(input.originalSenderJid)),
    Buffer.from(toNonAdJid(input.modificationSenderJid)),
    Buffer.from(useCase),
  ]);
  try {
    const key = Buffer.from(hkdfSync('sha256', input.originalMessageSecret, Buffer.alloc(0), info, 32));
    const payload = Buffer.from(input.encPayload);
    const tag = payload.subarray(payload.length - 16);
    const ciphertext = payload.subarray(0, payload.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(input.encIv));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (error) {
    log.debug('msgSecret decryption failed', {
      useCase,
      originalMessageId: input.originalMessageId,
      error: String(error),
    });
    return null;
  }
}
