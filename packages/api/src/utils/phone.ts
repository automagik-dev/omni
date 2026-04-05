/**
 * Phone number validation utilities.
 *
 * Shared between message-persistence and sync-worker to prevent
 * LID (Linked Device ID) numbers from being stored as phone numbers.
 */

/**
 * Check if a phone string is a valid E.164 number.
 * Expects digits only (with optional leading +).
 * E.164 range: 7-15 digits.
 */
export function isValidE164Phone(phone: string): boolean {
  const bare = phone.replace(/^\+/, '');
  if (!/^\d+$/.test(bare)) return false;
  return bare.length >= 7 && bare.length <= 15;
}

/**
 * Check if a platformUserId looks like a WhatsApp LID (Linked Device ID).
 * LIDs are numeric IDs typically 14+ digits that are NOT real phone numbers.
 */
export function isLidFormat(platformUserId: string): boolean {
  const bare = platformUserId.split('@')[0] || platformUserId;
  return /^\d{14,}$/.test(bare);
}

/**
 * Validate a phone number from a contact sync, guarding against LID-as-phone.
 *
 * During contact sync, channel plugins may return the LID number as the
 * contact's phone. This function returns undefined when the phone is actually
 * a LID number masquerading as a phone.
 *
 * @param phone - The phone string from the contact (e.g. "+5512982298888")
 * @param platformUserId - The contact's platformUserId (e.g. "54958418317348@lid")
 * @returns The phone if valid, undefined if it's a LID or invalid
 */
export function validateContactPhone(phone: string | undefined, platformUserId: string): string | undefined {
  if (!phone) return undefined;
  if (!isValidE164Phone(phone)) return undefined;

  // Guard: if platformUserId is LID-format and phone matches it, the phone is fake
  const barePhone = phone.replace(/^\+/, '');
  const barePuid = platformUserId.split('@')[0] || platformUserId;
  if (isLidFormat(platformUserId) && barePhone === barePuid) return undefined;

  return phone;
}
