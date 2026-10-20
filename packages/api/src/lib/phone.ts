/**
 * Digits of a phone address: "+55 12 98229-8888", "5512982298888",
 * "5512982298888:12" and "5512982298888@s.whatsapp.net" all give
 * "5512982298888". Null for LIDs, groups and anything that is not 8-15 digits.
 */
export function phoneDigits(address: string | undefined | null): string | null {
  if (!address) return null;
  const [user, server] = address.split('@');
  if (server && server !== 's.whatsapp.net') return null;
  const digits = (user ?? '').split(':')[0]?.replace(/[\s()+-]/g, '') ?? '';
  return /^\d{8,15}$/.test(digits) ? digits : null;
}
