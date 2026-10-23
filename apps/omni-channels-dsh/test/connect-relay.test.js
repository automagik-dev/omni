import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { DEFAULT_RELAY_URL, newPairing, openBox, pairingMessage, relayUrlOf, writeHashOf, writeTokenOf } from '../src/host/connect-relay.js'
import { install, LINK_FILE } from '../src/host/omni-link.js'
import { install as installHooks } from '@automagik/omni-dsh/src/host/extend.js'

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

// Sealed by Omni's packages/connect-relay (protocol.ts) for this pairing: the two copies of
// the protocol must agree, or a scan never connects.
const VECTOR = {
  pairing: { slot: 'AAECAwQFBgcICQoL', key: 'EBESExQVFhcYGRobHB0eHw' },
  writeToken: '8ig-9egNdDqSR_cZMRAC58ASHYRinAjXOQdTVptYawk',
  writeHash: 'FXH2P8MHICvPIa9P75bX35lX1Iuav0XkQM7UmCiIVL0',
  box: 's5Melh4clZgrXMmV-vbl2Un4aiA2JeiKTfpclc8PeFXY2exWwCP6waIPWDqqdSK6KBJakkgdnMqCXjhfp-b00V6mtiLsFi8jonpHqJ0Ef7XubJ5GtbbeEwUBtFvnB7wuP4uT0Ib8T2NbDTVEFsfoXnXr1Kx5iPoXi_xbTpFBTZFHrnUTeh1eYrer9bmZO9jfTU3hI4UiCYQ',
}

test("this copy of the protocol opens what Omni's sealed, and derives the same write token", async () => {
  assert.equal(await writeTokenOf(VECTOR.pairing), VECTOR.writeToken)
  assert.equal(await writeHashOf(VECTOR.pairing), VECTOR.writeHash)
  assert.deepEqual(await openBox(VECTOR.pairing, VECTOR.box), {
    url: 'https://omni.example.test', apiKey: 'omni_sk_vector', keyId: 'key-v', scopes: ['messages:read'], keyExpiresAt: null,
  })
  await assert.rejects(openBox(newPairing(), VECTOR.box))
  assert.match(pairingMessage(VECTOR.pairing), /\nomni-connect:AAECAwQFBgcICQoL\.EBESExQVFhcYGRobHB0eHw$/)
})

test('the relay is Automagik\'s unless set to another https address', () => {
  assert.equal(relayUrlOf({}), DEFAULT_RELAY_URL)
  assert.equal(relayUrlOf({ OMNI_CONNECT_RELAY_URL: 'https://relay.example.test/' }), 'https://relay.example.test')
  assert.equal(relayUrlOf({ OMNI_CONNECT_RELAY_URL: 'http://relay.example.test' }), DEFAULT_RELAY_URL)
})

// Seals the way Omni does (AES-GCM, the slot as associated data), for the fake Omni below.
async function seal({ slot, key }, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const material = await crypto.subtle.importKey('raw', Buffer.from(key, 'base64url'), { name: 'AES-GCM' }, false, ['encrypt'])
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(slot) }, material, new TextEncoder().encode(JSON.stringify(payload))))
  return Buffer.concat([iv, sealed]).toString('base64url')
}

// An in-memory relay: a slot registered with a write hash, answered once, read once.
function fakeRelay() {
  const slots = new Map()
  globalThis.fetch = async (address, init = {}) => {
    const url = new URL(String(address))
    const slot = url.pathname.split('/').at(-1)
    const json = (status, body) => new Response(body === undefined ? null : JSON.stringify(body), { status })
    const method = init.method ?? 'GET'
    if (method === 'POST') {
      slots.set(slot, { writeHash: JSON.parse(init.body).writeHash, box: null })
      return json(201, { expiresAt: new Date(Date.now() + 600_000).toISOString() })
    }
    const record = slots.get(slot)
    if (!record) return json(404, { error: { code: 'GONE' } })
    if (record.box === null) return json(202, { status: 'pending' })
    slots.delete(slot)
    return json(200, { box: record.box })
  }
  return { slots, answer: (slot, box) => { slots.get(slot).box = box } }
}

function runtime() {
  const home = mkdtempSync(join(tmpdir(), 'omni-scan-'))
  const synced = []
  const rt = { home, config: {}, ctx: { effect: run => run(), get: () => undefined }, syncOmniEvents: () => synced.push(Date.now()) }
  installHooks(rt)
  install(rt)
  return { rt, home, synced, stop: () => rmSync(home, { recursive: true, force: true }) }
}

test('scanning connects with nothing typed: the QR types the pairing, the owner\'s Omni answers on the relay, the link is saved', async (t) => {
  const relay = fakeRelay()
  const { rt, home, synced, stop } = runtime()
  t.after(stop)

  const started = await rt.omniLinkEndpoint('omni-scan-start')
  const text = started.scan.text
  const [, slot, key] = text.match(/omni-connect:([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{22})$/)
  assert.equal(started.scan.waLink, `https://wa.me/?text=${encodeURIComponent(text)}`)
  // The relay holds the write hash, never the key.
  assert.equal(relay.slots.get(slot).writeHash, await writeHashOf({ slot, key }))
  assert.ok(!JSON.stringify([...relay.slots]).includes(key))

  assert.equal((await rt.omniLinkEndpoint('omni-scan-poll')).status, 'pending')
  relay.answer(slot, await seal({ slot, key }, { url: 'https://omni.example.com/', apiKey: 'omni_sk_scanned', keyId: 'k9', scopes: ['messages:read'], keyExpiresAt: null }))
  assert.deepEqual(await rt.omniLinkEndpoint('omni-scan-poll'), { status: 'paired', origin: 'omni.example.com' })
  assert.equal(synced.length, 1)

  const file = join(home, LINK_FILE)
  assert.equal(statSync(file).mode & 0o777, 0o600)
  const link = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(link.url, 'https://omni.example.com')
  assert.equal(link.key, 'omni_sk_scanned')
  assert.equal(link.keyId, 'k9')
  assert.equal((await rt.omniLinkEndpoint('omni-scan-poll')).status, 'idle')
})

test('a box that does not open, or an expired slot, ends the scan without saving anything', async (t) => {
  const relay = fakeRelay()
  const { rt, home, stop } = runtime()
  t.after(stop)
  const started = await rt.omniLinkEndpoint('omni-scan-start')
  const [, slot] = started.scan.text.match(/omni-connect:([A-Za-z0-9_-]{16})\./)
  relay.answer(slot, await seal(newPairing(), { url: 'https://evil.example', apiKey: 'x', keyId: 'y' }))
  assert.equal((await rt.omniLinkEndpoint('omni-scan-poll')).status, 'expired')
  assert.throws(() => readFileSync(join(home, LINK_FILE)))

  await rt.omniLinkEndpoint('omni-scan-start')
  relay.slots.clear()
  assert.equal((await rt.omniLinkEndpoint('omni-scan-poll')).status, 'expired')
})

test('a relay that cannot be reached says to type the address instead', async (t) => {
  globalThis.fetch = async () => { throw new Error('offline') }
  const { rt, stop } = runtime()
  t.after(stop)
  await assert.rejects(rt.omniLinkEndpoint('omni-scan-start'), /Type your Omni's address/)
})
