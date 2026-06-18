/**
 * Gupshup identity utilities
 *
 * Identity is round-tripped, never reshaped: the number Omni receives on
 * inbound (and stores as the chat id) is exactly what goes back out on the
 * Custom Integration callback (customer_id / user.phone), so Journey/Goals
 * can match the contact.
 *
 * We only strip transport formatting (leading +, a JID @suffix, a :device
 * suffix). We deliberately do NOT touch the Brazilian extra-9: it is present
 * on some numbers and absent on others, so any add/strip heuristic corrupts
 * identity. This mirrors the platform-wide convention — AccessService
 * .normalizePhone and agent-dispatcher's normalizePhoneIdentity also preserve
 * the digits and only drop formatting.
 */

/** Strip transport formatting (leading +, JID @suffix, :device suffix). Digits kept verbatim. */
function stripFormatting(phone: string): string {
  return phone.trim().replace(/^\+/, '').replace(/@.*$/, '').replace(/:\d+$/, '');
}

/** Normalize a phone number for identity use (formatting stripped, digits — incl. BR 9 — preserved). */
export function normalizePhone(phone: string): string {
  return stripFormatting(phone);
}

/** Convert a phone number to Gupshup outbound format. Identity is preserved verbatim. */
export function toGupshupPhone(phone: string): string {
  return stripFormatting(phone);
}

/** Extract the user ID from a webhook source field (formatting stripped, digits preserved). */
export function extractUserId(phone: string): string {
  return stripFormatting(phone);
}
