export function toZenviaPhone(input: string): string {
  if (!input) return '';
  const withoutJid = input.includes('@') ? (input.split('@')[0] ?? '') : input;
  return withoutJid.replace(/\D/g, '');
}

const PHONE_LIKE = /^[\d+\s()-]+$/;

export function toSenderId(input: string): string {
  if (!input) return '';
  const isAddress = input.includes('@') || PHONE_LIKE.test(input);
  return isAddress ? toZenviaPhone(input) || input : input;
}
