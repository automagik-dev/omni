/**
 * Scan-to-connect: how a device learns its Omni's address and key without typing either.
 *
 * 1. The device makes a pairing: a slot id and a key, both random. It registers the slot
 *    with the relay, giving only the hash of a write token derived from the key, and shows
 *    a QR that opens WhatsApp with `omni-connect:<slot>.<key>` typed.
 * 2. The owner sends that to themselves. Their Omni sees it in the owner's self chat (the
 *    same proof of ownership the device login uses), mints a device key, seals its
 *    address and that key with the pairing key, and writes the box to the slot with the
 *    write token.
 * 3. The device reads the box once and opens it.
 *
 * The relay sees a slot id, a write-token hash and a sealed box: never the key, so never
 * the address or the Omni key. Only someone who saw the pairing key can write the slot.
 * Web Crypto only, so the same code runs in Bun, Node and a Cloudflare Worker.
 */

export const SLOT_BYTES = 12;
export const KEY_BYTES = 16;
/** base64url of SLOT_BYTES and KEY_BYTES. */
export const SLOT_PATTERN = /^[A-Za-z0-9_-]{16}$/;
export const KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/;
/** The text the QR types into WhatsApp. The whole message must be this. */
export const MESSAGE_PATTERN = /^(?:[^\n]{0,60}\n)?\s*omni-connect:([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})\s*$/;
/** A slot lives this long on the relay. */
export const SLOT_TTL_MS = 10 * 60 * 1000;
/** A sealed box is small: an address and a key. */
export const MAX_BOX_CHARS = 8192;

export type Pairing = { slot: string; key: string };
export type ConnectPayload = {
  /** The Omni's public base URL. */
  url: string;
  /** The device key the owner's approval minted. */
  apiKey: string;
  keyId: string;
  scopes: string[];
  keyExpiresAt: string | null;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

const random = (length: number) => crypto.getRandomValues(new Uint8Array(length));

export function newPairing(): Pairing {
  return { slot: toBase64Url(random(SLOT_BYTES)), key: toBase64Url(random(KEY_BYTES)) };
}

/** The message the QR types: one line a person can read, then the pairing. */
export function pairingMessage({ slot, key }: Pairing, label = 'Connect my Omni app'): string {
  return `${label}\nomni-connect:${slot}.${key}`;
}

/** The pairing a message carries, or null. The whole message must be the pairing (optionally after one short line). */
export function pairingInMessage(text: string | undefined): Pairing | null {
  const match = text?.match(MESSAGE_PATTERN);
  if (!match?.[1] || !match[2]) return null;
  return { slot: match[1], key: match[2] };
}

export function isPairing(value: unknown): value is Pairing {
  const candidate = value as Partial<Pairing> | null;
  return (
    typeof candidate?.slot === 'string' &&
    SLOT_PATTERN.test(candidate.slot) &&
    typeof candidate.key === 'string' &&
    KEY_PATTERN.test(candidate.key)
  );
}

async function hmac(key: Uint8Array, label: string): Promise<Uint8Array> {
  const material = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', material, encoder.encode(label)));
}

/** The token that lets the Omni write the slot: derived from the pairing key, never sent to the relay before the write. */
export async function writeTokenOf({ slot, key }: Pairing): Promise<string> {
  return toBase64Url(await hmac(fromBase64Url(key), `omni-connect/write/${slot}`));
}

export async function sha256(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))));
}

/** What the device registers: the hash of the write token, so the relay can check a writer without being able to write. */
export async function writeHashOf(pairing: Pairing): Promise<string> {
  return sha256(await writeTokenOf(pairing));
}

async function sealKey(key: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64Url(key), { name: 'AES-GCM' }, false, [usage]);
}

/** AES-GCM with the pairing key; the slot is the associated data, so a box only opens for its own slot. */
export async function seal(pairing: Pairing, payload: ConnectPayload): Promise<string> {
  const iv = random(12);
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(pairing.slot) },
    await sealKey(pairing.key, 'encrypt'),
    encoder.encode(JSON.stringify(payload)),
  );
  const box = new Uint8Array(iv.length + sealed.byteLength);
  box.set(iv);
  box.set(new Uint8Array(sealed), iv.length);
  return toBase64Url(box);
}

export async function open(pairing: Pairing, box: string): Promise<ConnectPayload> {
  const bytes = fromBase64Url(box);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(pairing.slot) },
    await sealKey(pairing.key, 'decrypt'),
    bytes.slice(12),
  );
  const payload = JSON.parse(decoder.decode(plain)) as Partial<ConnectPayload>;
  if (typeof payload.url !== 'string' || typeof payload.apiKey !== 'string' || typeof payload.keyId !== 'string') {
    throw new Error('The box does not hold a connection');
  }
  return {
    url: payload.url,
    apiKey: payload.apiKey,
    keyId: payload.keyId,
    scopes: Array.isArray(payload.scopes) ? payload.scopes.map(String) : [],
    keyExpiresAt: typeof payload.keyExpiresAt === 'string' ? payload.keyExpiresAt : null,
  };
}
