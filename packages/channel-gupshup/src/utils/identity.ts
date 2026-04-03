/**
 * Gupshup identity utilities
 *
 * Phone normalization and user ID extraction for Gupshup BSP.
 * Gupshup uses E.164 phone numbers without the leading + as user identifiers.
 */

/**
 * Normalize a phone number to E.164 format (with leading +).
 *
 * Strips spaces, dashes, parentheses, and dots.
 * If the number has no leading +, it is returned as-is (already expected
 * to include the country code). Numbers starting with 00 are converted
 * to + prefix.
 *
 * @example
 * normalizePhone('55 11 9 9999-9999') // '+5511999999999'
 * normalizePhone('+5511999999999')     // '+5511999999999'
 * normalizePhone('005511999999999')    // '+5511999999999'
 */
export function normalizePhone(raw: string): string {
  // Strip formatting characters
  let cleaned = raw.replace(/[\s\-().]/g, '');

  // Convert 00-prefixed international format to +
  if (cleaned.startsWith('00')) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  // Ensure leading +
  if (!cleaned.startsWith('+')) {
    cleaned = `+${cleaned}`;
  }

  return cleaned;
}

/**
 * Extract the Gupshup user ID from a webhook payload source field.
 *
 * Gupshup sends `source` as the phone number without the leading +
 * (e.g. "5511999999999"). This returns the E.164 version with +.
 */
export function extractUserId(source: string): string {
  const stripped = source.trim();
  return stripped.startsWith('+') ? stripped : `+${stripped}`;
}

/**
 * Strip the leading + from a phone number for use in Gupshup API requests.
 * Gupshup's destination field expects the number without +.
 */
export function toGupshupPhone(e164: string): string {
  return e164.startsWith('+') ? e164.slice(1) : e164;
}
