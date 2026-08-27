/**
 * Channel-handle canonicalization for identity keying.
 *
 * The identity natural key is `(channel, instance_id, platform_user_id)`
 * (see `packages/db/src/schema.ts`, `platform_identities_channel_user_idx`).
 * Channels historically emit the SAME human under several handle spellings, so
 * the same person forks into multiple identities/persons:
 *
 *   - WhatsApp (Baileys) sends a phone as bare digits `5511...`, as the full JID
 *     `5511...@s.whatsapp.net`, or device-suffixed `5511...:3@s.whatsapp.net`.
 *   - Twilio sends `whatsapp:+E164` (provider prefix) — `extractPhoneFromSender`
 *     never matched it, so every Twilio contact forked with a phone-less person.
 *   - Gupshup / Hermes (WhatsApp Cloud/BSP) send bare `wa_id` digits.
 *
 * This module collapses all of those to ONE canonical form per channel BEFORE
 * the natural key is built and BEFORE phone extraction, so new writes converge.
 *
 * CANONICAL FORM (decided here):
 *   For every WhatsApp-family channel a phone handle canonicalizes to the
 *   suffixed JID `<e164-digits>@s.whatsapp.net`. This mirrors the convention the
 *   rest of the codebase already leans toward — `chats.canonicalId` is the
 *   `@s.whatsapp.net` JID, and LID→phone resolution yields the same suffixed
 *   form — so identities, chats and mappings all speak one dialect. `@lid` and
 *   `@g.us` keep their own distinct suffixed forms (a LID is NEVER collapsed to
 *   a phone here — that is a later phase); only the device `:NN` suffix and any
 *   provider prefix are stripped. The `+E164` phone is derived separately for
 *   cross-channel person matching (`persons.primary_phone`).
 *
 * Canonicalization is idempotent: feeding an already-canonical value back in
 * returns it unchanged, so it is safe to apply at both the write and the read
 * (lookup) site.
 */

import type { ChannelType } from '@omni/core/types';
import { isValidE164Phone } from './phone';

/**
 * WhatsApp-family channels whose phone handles share the `@s.whatsapp.net`
 * canonical JID and support `+E164` phone derivation.
 */
export const WHATSAPP_FAMILY_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>([
  'whatsapp-baileys',
  'whatsapp-business',
  'twilio-whatsapp',
  'gupshup',
  'hermes',
]);

/**
 * System / agent channels that must NEVER mint a human `person`.
 *
 *   - `internal` emits `from = sourceInstanceId` (an instance UUID, not a human).
 *   - `a2a` keys on an agent subject / `a2a:<contextId>`; its customer context is
 *     resolved from the execution context by the dispatcher, not from a person.
 */
export const PERSONLESS_CHANNELS: ReadonlySet<ChannelType> = new Set<ChannelType>(['internal', 'a2a']);

export interface CanonicalHandle {
  /** The canonical `platform_user_id` to use as the identity natural key. */
  platformUserId: string;
  /** A valid E.164 phone (`+digits`) when one is derivable, else undefined. */
  phone?: string;
}

const WA_PHONE_SUFFIX = '@s.whatsapp.net';

export function isWhatsAppFamily(channel: ChannelType): boolean {
  return WHATSAPP_FAMILY_CHANNELS.has(channel);
}

export function isPersonlessChannel(channel: ChannelType): boolean {
  return PERSONLESS_CHANNELS.has(channel);
}

/** Strip provider prefixes such as Twilio's `whatsapp:` (case-insensitive). */
function stripProviderPrefix(raw: string): string {
  return raw.replace(/^whatsapp:/i, '').trim();
}

/**
 * Strip a WhatsApp device/agent suffix `:NN` from the local part of a JID.
 * `5511...:3` → `5511...`; a bare number without a colon is returned unchanged.
 */
function stripDeviceSuffix(local: string): string {
  const colon = local.indexOf(':');
  return colon === -1 ? local : local.slice(0, colon);
}

/**
 * Canonicalize a raw channel handle for identity keying.
 *
 * Non-WhatsApp channels (Discord, Slack, Telegram, …) already emit stable ids
 * and are returned unchanged. WhatsApp-family handles collapse to one canonical
 * form as documented in the module header.
 */
export function canonicalizeHandle(channel: ChannelType, rawUserId: string): CanonicalHandle {
  if (!rawUserId) return { platformUserId: rawUserId };
  if (!isWhatsAppFamily(channel)) return { platformUserId: rawUserId };

  const stripped = stripProviderPrefix(rawUserId);
  const atIndex = stripped.indexOf('@');
  const suffix = atIndex === -1 ? '' : stripped.slice(atIndex); // includes the leading '@'
  const localRaw = atIndex === -1 ? stripped : stripped.slice(0, atIndex);

  // LID: its own canonical form. Never derive a phone from a LID (later phase).
  if (suffix === '@lid') {
    return { platformUserId: `${stripDeviceSuffix(localRaw)}@lid` };
  }

  // Groups, broadcasts and newsletters: preserve as distinct canonical forms.
  if (suffix === '@g.us' || suffix === '@broadcast' || suffix === '@newsletter') {
    return { platformUserId: stripped };
  }

  // Phone-like: bare digits, +E164, @s.whatsapp.net, or device-suffixed.
  const digits = stripDeviceSuffix(localRaw).replace(/^\+/, '');
  if (isValidE164Phone(digits)) {
    return { platformUserId: `${digits}${WA_PHONE_SUFFIX}`, phone: `+${digits}` };
  }

  // Unrecognized WhatsApp-family handle: leave untouched, derive no phone.
  return { platformUserId: rawUserId };
}
