// Scan to connect, the device's half: the same protocol as Omni's packages/connect-relay
// (this plugin installs on its own, so it carries its own copy; test/connect-relay.test.js
// opens a box that package sealed). The device makes a pairing (a slot id and a key),
// registers the slot on the relay with only the hash of a write token derived from the key,
// shows a QR that types `omni-connect:<slot>.<key>` into WhatsApp, and collects the box the
// owner's Omni leaves there once they send it to themselves. The relay never sees the key.

const SLOT_BYTES = 12
const KEY_BYTES = 16
export const DEFAULT_RELAY_URL = 'https://connect.automagik.dev'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const toBase64Url = bytes => Buffer.from(bytes).toString('base64url')
export const fromBase64Url = text => new Uint8Array(Buffer.from(text, 'base64url'))
const random = length => crypto.getRandomValues(new Uint8Array(length))

export const newPairing = () => ({ slot: toBase64Url(random(SLOT_BYTES)), key: toBase64Url(random(KEY_BYTES)) })
export const pairingMessage = ({ slot, key }, label = 'Connect my Omni app') => `${label}\nomni-connect:${slot}.${key}`

async function hmac(key, label) {
  const material = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return new Uint8Array(await crypto.subtle.sign('HMAC', material, encoder.encode(label)))
}
export const writeTokenOf = async ({ slot, key }) => toBase64Url(await hmac(fromBase64Url(key), `omni-connect/write/${slot}`))
const sha256 = async text => toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
export const writeHashOf = async pairing => sha256(await writeTokenOf(pairing))

export async function openBox(pairing, box) {
  const bytes = fromBase64Url(box)
  const key = await crypto.subtle.importKey('raw', fromBase64Url(pairing.key), { name: 'AES-GCM' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12), additionalData: encoder.encode(pairing.slot) }, key, bytes.slice(12))
  const payload = JSON.parse(decoder.decode(plain))
  if (typeof payload?.url !== 'string' || typeof payload?.apiKey !== 'string' || typeof payload?.keyId !== 'string') throw new Error('The box does not hold a connection')
  return payload
}

// The relay this host uses: OMNI_CONNECT_RELAY_URL (https only), else Automagik's.
export function relayUrlOf(env = process.env) {
  const value = String(env.OMNI_CONNECT_RELAY_URL ?? '').trim().replace(/\/+$/, '')
  return /^https:\/\/[^/\s]+/.test(value) ? value : DEFAULT_RELAY_URL
}
