/**
 * WhatsApp id (waid) normalization shared by the WhatsApp channels (#1279).
 *
 * Lives in core because both the Baileys and the Cloud API channels must key a
 * Brazilian number the same way WhatsApp does, or one person splits into two
 * chats (the number as typed vs the id WhatsApp reports).
 */

/**
 * Compute the WhatsApp ID (waid) from a phone number's digits.
 *
 * Brazilian 9th-digit rules:
 * - DDDs 11–30 (SP, RJ, metro): the 9 is part of the real number, WhatsApp
 *   stores the JID WITH it → keep the 13-digit format.
 * - DDDs 31+ (MG, interior): WhatsApp stores the JID WITHOUT the leading 9
 *   → strip to 12 digits.
 *
 * See: Evolution API #1428, #357; Baileys #156
 */
export function computeWaid(digits: string): string {
  if (digits.length === 13 && digits.startsWith('55') && digits.charAt(4) === '9') {
    const ddd = Number(digits.slice(2, 4));
    // DDDs 31+ store without the 9th digit in WhatsApp
    if (ddd >= 31) {
      return digits.slice(0, 4) + digits.slice(5);
    }
  }
  return digits;
}
