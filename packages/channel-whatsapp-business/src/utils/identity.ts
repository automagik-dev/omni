/**
 * Phone number normalization for Meta WhatsApp Cloud.
 *
 * Meta expects digits-only E.164 (no `+`). Inbound `from` is always
 * digits-only already. Outbound senders strip `+` and any non-digits.
 */

import { computeWaid } from '@omni/core';

/**
 * Chat key for a phone: digits only, Brazilian ninth digit normalized the
 * way WhatsApp ids are (#1279). Inbound `from` is already in this form, so an
 * outbound chat keyed with it is the same chat the reply lands in.
 */
export function toWaId(input: string): string {
  return computeWaid(toMetaPhone(input));
}

/**
 * Normalize an arbitrary phone string to Meta wire format (digits only).
 *
 * Accepts:
 *   - "+5511999998888"
 *   - "55 11 99999-8888"
 *   - "5511999998888"
 *   - "5511999998888@s.whatsapp.net" (WhatsApp JID — strips suffix)
 *
 * Returns digits only. Empty string if input has no digits.
 */
export function toMetaPhone(input: string): string {
  if (!input) return '';
  // Drop WhatsApp JID suffix if present.
  const withoutJid = input.includes('@') ? (input.split('@')[0] ?? '') : input;
  return withoutJid.replace(/\D/g, '');
}

/**
 * Format a Meta phone (digits-only) back to canonical E.164 with leading `+`.
 *
 * Not used for event chat ids: those stay digits-only (`toWaId` / inbound
 * `from`), so outbound and inbound land in the same chat.
 */
export function toE164(metaPhone: string): string {
  const digits = metaPhone.replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

/**
 * Compare two phone identifiers ignoring `+`, whitespace, JID suffix, etc.
 */
export function phonesEqual(a: string, b: string): boolean {
  return toMetaPhone(a) === toMetaPhone(b);
}
