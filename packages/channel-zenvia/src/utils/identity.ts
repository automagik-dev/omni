export function toZenviaPhone(input: string): string {
  if (!input) return '';
  const withoutJid = input.includes('@') ? (input.split('@')[0] ?? '') : input;
  return withoutJid.replace(/\D/g, '');
}
