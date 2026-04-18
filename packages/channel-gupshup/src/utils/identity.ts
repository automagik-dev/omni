/**
 * Gupshup identity utilities
 *
 * Phone normalization and user ID extraction for Gupshup Custom Integration.
 * Strips BR extra-9 for outbound to match what Gupshup expects.
 */

/**
 * Normalize a phone number for use in Gupshup API requests.
 * - Remove leading + if present
 * - Strip extra 9 from Brazilian mobile: 5551997285829 → 555197285829
 */
export function normalizePhone(phone: string): string {
  // Remove leading + if present
  const clean = phone.startsWith('+') ? phone.slice(1) : phone;
  // Strip extra 9 from Brazilian mobile: 5551997285829 → 555197285829
  return clean.replace(/^(55\d{2})9(\d{8})$/, '$1$2');
}

/**
 * Convert a phone number to Gupshup format (no leading +, BR extra-9 stripped).
 */
export function toGupshupPhone(phone: string): string {
  return normalizePhone(phone);
}

/**
 * Extract the user ID from a webhook source field.
 * Returns normalized phone (no leading +, BR extra-9 stripped).
 */
export function extractUserId(phone: string): string {
  return normalizePhone(phone);
}
