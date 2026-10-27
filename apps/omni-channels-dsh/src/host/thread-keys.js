// Thread keys: each chat the owner adds as a thread works on a chat key of its own, a `cs`
// child of the link key that Omni locks to that one chat (POST /keys/children). The keys sit
// in a file of this plugin's own beside omni.json, omni-thread-keys.json (0600), read only by
// this host: never in state.json, the roster view, a log or a tool result.
//
// A key is cut when its thread goes, and whenever the link key changes (omni-link.js changes
// omni.json only inside handOverThreadKeys): the old key revokes its children before it is let
// go, and the same Omni gives each thread a fresh child of the new key; another Omni, or none,
// leaves the threads not connected. A thread never falls back
// to another key. A cut that does not go through stays pending, and drains by its parent's
// revoke, else the child's own self-revoke, else a 401 on the child's own key; a live child
// answers /auth/validate with 403 (it holds no auth:validate), which keeps it pending.
//
// The file:
//   threads   the key each thread holds, or a key still being cut (`pending`)
//   retired   an old link key, kept only while children of it are still being cut
//   waiting   a thread with no key, with why, given one when its Omni is linked here
//
// Each change holds a lock file beside it (omni-thread-keys.json.lock), so two DSH hosts on
// one home, one of them only reading the team, never change it at once.
import { randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { chmod, mkdir, open, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { cleanOmniUrl } from './omni-link.js'
import { NEEDS_NEWER_TEAM } from './resume-hook.js'

export const KEYS_FILE = 'omni-thread-keys.json'
// How often pending cuts drain and keyless threads ask for a key again.
export const DRAIN_MS = 5 * 60_000
// A lock whose holder is gone, or that its holder has not renewed for this long (it renews it
// every LOCK_BEAT_MS while it holds it), is taken over; so is one with no holder written in it
// whose file is older than LOCK_EMPTY_MS (a crash between making it and writing it).
const LOCK_STALE_MS = 2 * 60_000
const LOCK_BEAT_MS = 30_000
const LOCK_EMPTY_MS = 10_000
const KEEP_FAILED = 'This app could not keep the chat key.'
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const NOT_LINKED = 'Not connected: this app is not linked to an Omni.'
export const OTHER_OMNI = 'Not connected: this app is linked to another Omni.'
export const BEING_CUT = 'Not connected: its previous key is still being cut.'
export const WAITING = 'Not connected: waiting for a key from the linked Omni.'
const NO_KEY = 'Not connected: this thread has no key.'
export const UNREADABLE = 'The thread keys file could not be read, so the chat keys in it were not cut. Revoking this app\'s key in Omni ends them.'

const text = z.string().min(1).max(2000)
const Entry = z.object({ childId: text, key: text, chatId: text, origin: text, parentKeyId: text.nullable(), pending: z.object({ since: z.number() }).nullable() })
const Waiting = z.object({ chatId: text, origin: text, reason: z.string().max(1000) })
const KeysFile = z.object({
  version: z.literal(1),
  threads: z.record(z.string(), Entry),
  retired: z.array(z.object({ origin: text, parentKey: text, childIds: z.array(text) })),
  waiting: z.record(z.string(), Waiting).default({}),
})

// Omni's answers, as Group 4's routes give them (packages/api/src/schemas/openapi/keys.ts).
const Minted = z.object({ data: z.object({ id: z.string().regex(ID), plainTextKey: text, parentKeyId: z.string().nullish(), chatId: z.string(), chatExternalId: z.string(), instanceId: z.string().regex(ID) }) })
const Revoked = z.object({ data: z.object({ status: z.enum(['revoked', 'already_revoked']) }) })
const Instance = z.object({ data: z.object({ ownerIdentifier: z.string().max(200).nullish() }) })
const Refusal = z.object({ error: z.object({ message: z.string().max(500) }) })

// The same Omni: the same API address (its path too), whatever key it was reached with.
const sameOmni = (a, b) => {
  const base = cleanOmniUrl(a)
  return base !== null && base === cleanOmniUrl(b)
}
// Omni's words, with a key it was sent never repeated in them.
const without = (said, key) => (typeof said === 'string' && key ? said.split(key).join('[key]') : said)
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

// A WhatsApp id's number: "5511999990000:12@s.whatsapp.net" → "5511999990000".
export const digitsOf = value => String(value ?? '').replace(/[:@].*$/, '').replace(/\D/g, '')
// Whether a chat is the owner's own, by the owner's number a mint returned (`self`): a
// thread's key cannot read its channel, so this is how it still knows.
export const isOwnChat = (self, chatJid) => typeof self === 'string' && self !== '' && digitsOf(chatJid) === self

export function install(rt) {
  const path = join(rt.home, KEYS_FILE)
  const empty = () => ({ version: 1, threads: {}, retired: [], waiting: {} })

  const lockPath = `${path}.lock`

  // Read on every use, as omni.json is: the file is the one truth. `bad`: it is there but fails
  // its check, which is said once, not on every use. The last read is kept while the file on
  // disk is the same one (inode, size, change time), so a lookup per tool call stays cheap.
  let warned = false
  let last = null
  function readKeys() {
    let raw
    let seen
    try {
      const info = statSync(path)
      seen = `${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
      // A copy: callers change what they read before they write it.
      if (last?.seen === seen) return { file: structuredClone(last.file), bad: false }
      raw = readFileSync(path, 'utf8')
    } catch {
      last = null
      return { file: empty(), bad: false }
    }
    let parsed
    try {
      parsed = KeysFile.safeParse(JSON.parse(raw))
    } catch {
      parsed = { success: false }
    }
    if (parsed.success) {
      last = { seen, file: structuredClone(parsed.data) }
      return { file: parsed.data, bad: false }
    }
    if (!warned) rt.warn?.('omni-channels: %s could not be read; its thread keys are not used', KEYS_FILE)
    warned = true
    last = null
    return { file: empty(), bad: true }
  }
  const read = () => readKeys().file

  // A file that fails its check is moved aside (0600) before it is replaced, so the live keys
  // in it are not lost.
  async function write(file) {
    await mkdir(rt.home, { recursive: true })
    if (readKeys().bad) {
      const aside = `${path}.unreadable-${Date.now()}`
      await rename(path, aside)
      await chmod(aside, 0o600)
      warned = false
    }
    const temp = `${path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
      await rename(temp, path)
    } catch (error) {
      await rm(temp, { force: true }).catch(() => {})
      throw error
    }
  }

  // The lock beside the file, made with O_EXCL and holding this holder's own token; one that is
  // stale (see LOCK_STALE_MS) is taken over. Returns its release.
  const holderOf = raw => {
    try {
      const holder = JSON.parse(raw)
      return Number.isInteger(holder?.pid) && typeof holder.token === 'string' && Number.isFinite(holder.at) ? holder : null
    } catch {
      return null
    }
  }
  // The lock file goes only while it is still the one read: never another holder's.
  async function unlinkIf(raw) {
    if ((await readFile(lockPath, 'utf8').catch(() => null)) === raw) await unlink(lockPath).catch(() => {})
  }
  async function lock() {
    await mkdir(rt.home, { recursive: true })
    const token = randomUUID()
    const mine = () => JSON.stringify({ pid: process.pid, token, at: Date.now() })
    for (let wait = 10; ; wait = Math.min(wait * 2, 200)) {
      let handle = null
      try {
        handle = await open(lockPath, 'wx', 0o600)
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error
      }
      if (handle !== null) {
        try {
          await handle.writeFile(mine())
          await handle.close()
        } catch (error) {
          await handle.close().catch(() => {})
          await unlink(lockPath).catch(() => {})
          throw error
        }
        return hold(token, mine)
      }
      const raw = await readFile(lockPath, 'utf8').catch(() => null)
      const made = await stat(lockPath).catch(() => null)
      // Gone since the open: try again at once. There but unreadable: wait, as for a holder.
      if (raw === null || made === null) {
        if (made !== null) await new Promise(resolve => setTimeout(resolve, wait))
        continue
      }
      const holder = holderOf(raw)
      const stale = holder === null
        ? Date.now() - made.mtimeMs > LOCK_EMPTY_MS
        : !alive(holder.pid) || !(Date.now() - holder.at < LOCK_STALE_MS)
      if (stale) {
        await unlinkIf(raw)
        continue
      }
      await new Promise(resolve => setTimeout(resolve, wait))
    }
  }
  // While held, the lock is renewed, so only a gone holder (or a reused pid) ever looks stale.
  function hold(token, mine) {
    // `released`: a beat that read the lock just before the release must not bring it back.
    let released = false
    const ours = async () => holderOf(await readFile(lockPath, 'utf8').catch(() => ''))?.token === token
    const beat = setInterval(() => {
      void ours().then(still => (still && !released ? writeFile(lockPath, mine(), { mode: 0o600 }) : undefined)).catch(() => {})
    }, LOCK_BEAT_MS)
    beat.unref?.()
    return async () => {
      released = true
      clearInterval(beat)
      const raw = await readFile(lockPath, 'utf8').catch(() => null)
      if (raw !== null && holderOf(raw)?.token === token) await unlinkIf(raw)
    }
  }

  // One change to the file at a time, in this host and across hosts: a mint, a cut, a drain
  // and a hand-over never interleave. Nothing inside a section may await mint, revoke, drain or
  // handOverThreadKeys: it would wait on the queue it holds, forever.
  let queue = Promise.resolve()
  const serial = (run) => {
    const locked = async () => {
      const release = await lock()
      try {
        return await run()
      } finally {
        await release()
      }
    }
    const next = queue.then(locked, locked)
    queue = next.catch(() => {})
    return next
  }

  const listeners = new Set()
  const changed = (threadIds) => {
    for (const threadId of threadIds) {
      for (const listener of listeners) {
        try {
          listener(threadId)
        } catch (error) {
          rt.warn?.('omni-channels: a thread key listener failed: %s', error?.message ?? error)
        }
      }
    }
  }

  // One request with exactly this URL and key (rt.omniRequest never falls back to the link's
  // when given them); status 0 when Omni could not be reached.
  async function ask(url, key, method, route, body) {
    try {
      const response = await rt.omniRequest(method, route, { url, key, body })
      if (!response) return { status: 0, json: null }
      return { status: response.status, json: await response.json().catch(() => null) }
    } catch {
      return { status: 0, json: null }
    }
  }

  // Whether a child is cut now: by a parent's revoke, else its own self-revoke, else a 401 on
  // its own key. Each step is idempotent; anything else leaves it live, as far as is known.
  // `down`: the Omnis that did not answer in this pass, which are not asked again in it.
  async function cut(entry, parents, down = new Set()) {
    const base = cleanOmniUrl(entry.origin)
    if (down.has(base)) return false
    const reached = (reply) => {
      if (reply.status === 0) down.add(base)
      return reply.status !== 0
    }
    for (const parent of parents) {
      const reply = await ask(entry.origin, parent, 'POST', `/keys/children/${encodeURIComponent(entry.childId)}/revoke`, {})
      if (!reached(reply)) return false
      if (reply.status === 200 && Revoked.safeParse(reply.json).success) return true
    }
    const own = await ask(entry.origin, entry.key, 'POST', '/keys/children/self/revoke')
    if (!reached(own)) return false
    if (own.status === 200 && Revoked.safeParse(own.json).success) return true
    return (await ask(entry.origin, entry.key, 'POST', '/auth/validate')).status === 401
  }

  // The keys that may be a child's parent: the old link keys of the same Omni kept for it, and
  // the linked one. A key never goes to another Omni.
  const kin = (old, entry) => sameOmni(old.origin, entry.origin) && old.childIds.includes(entry.childId)
  function parentsOf(file, entry, link) {
    const keys = file.retired.filter(old => kin(old, entry)).map(old => old.parentKey)
    if (link !== null && sameOmni(link.url, entry.origin)) keys.push(link.key)
    return [...new Set(keys)]
  }

  // A cut child leaves the file, and an old link key goes once nothing of it is left to cut.
  function drop(file, threadId) {
    const entry = file.threads[threadId]
    delete file.threads[threadId]
    file.retired = file.retired
      .map(old => (kin(old, entry) ? { ...old, childIds: old.childIds.filter(id => id !== entry.childId) } : old))
      .filter(old => old.childIds.length > 0)
  }

  function refusalOf(reply, link) {
    const host = new URL(link.url).host
    const said = without(Refusal.safeParse(reply.json).data?.error?.message, link.key)
    if (reply.status === 0) return `Could not reach Omni at ${host}.`
    // A 404 without Omni's own words is a route this Omni does not have.
    if (reply.status === 404) return said ?? `Omni at ${host} cannot make chat keys; update it.`
    if (reply.status === 403) return `Omni refused a chat key${said ? `: ${said}` : '.'}`
    if (reply.status === 409) return said ?? 'This app holds as many chat keys as Omni allows.'
    return `Omni answered ${reply.status} for a chat key${said ? `: ${said}` : '.'}`
  }

  // A key this host will not keep cuts itself, if Omni answers.
  const discard = async (link, key) => {
    if (typeof key === 'string' && key !== '') await ask(link.url, key, 'POST', '/keys/children/self/revoke')
  }

  // A fresh child of the link key for one thread, and the owner's number read with the link
  // key (`self`); the file changes only when the key was made. `status`: Omni's answer, 0 when
  // it could not be reached.
  async function mintIn(file, threadId, chatId, link) {
    const reply = await ask(link.url, link.key, 'POST', '/keys/children', { chatId })
    if (reply.status !== 201) return { ok: false, reason: refusalOf(reply, link), status: reply.status }
    const minted = Minted.safeParse(reply.json)
    if (!minted.success || minted.data.data.chatId !== chatId) {
      await discard(link, reply.json?.data?.plainTextKey)
      return { ok: false, reason: 'Omni answered something else for a chat key.', status: reply.status }
    }
    const child = minted.data.data
    const channel = await ask(link.url, link.key, 'GET', `/instances/${child.instanceId}`)
    const owner = channel.status === 200 ? Instance.safeParse(channel.json).data?.data?.ownerIdentifier : null
    file.threads[threadId] = { childId: child.id, key: child.plainTextKey, chatId, origin: link.url, parentKeyId: child.parentKeyId ?? link.keyId ?? null, pending: null }
    delete file.waiting[threadId]
    return { ok: true, self: digitsOf(owner) || null }
  }

  // The keyless threads of the linked Omni ask for a key again: returns the ones that got it,
  // and whether any reason changed. An Omni that does not answer is not asked again in this pass.
  async function claimIn(file, link, down = new Set()) {
    const got = []
    let reasons = false
    if (link === null || rt.teamResume?.ready !== true) return { got, reasons }
    for (const [threadId, waiting] of Object.entries(file.waiting)) {
      if (file.threads[threadId] || !sameOmni(link.url, waiting.origin) || down.has(cleanOmniUrl(link.url))) continue
      const minted = await mintIn(file, threadId, waiting.chatId, link)
      if (minted.status === 0) down.add(cleanOmniUrl(link.url))
      if (minted.ok) got.push(threadId)
      else if (waiting.reason !== `Not connected: ${minted.reason}`) {
        waiting.reason = `Not connected: ${minted.reason}`
        reasons = true
      }
    }
    return { got, reasons }
  }

  const live = (entry, link) => entry !== undefined && entry.pending === null && link !== null && sameOmni(link.url, entry.origin)

  rt.threadKeys = {
    // A thread's key, made with the link key. On a failure nothing is written and the reason
    // comes back: the thread then has no key, and nothing runs on the link key for it.
    mint: async (threadId, chatId) => {
      if (typeof threadId !== 'string' || threadId === '') return { ok: false, reason: 'Unknown thread.' }
      if (typeof chatId !== 'string' || !ID.test(chatId)) return { ok: false, reason: 'Unknown chat.' }
      if (rt.teamResume?.ready !== true) return { ok: false, reason: rt.teamResume?.reason ?? NEEDS_NEWER_TEAM }
      // The file or its lock could not be made (a full or read-only disk): the reason, not a throw.
      const kept = error => {
        rt.warn?.('omni-channels: a thread key could not be kept: %s', error?.message ?? error)
        return { ok: false, reason: KEEP_FAILED }
      }
      return serial(async () => {
        const link = rt.omniLink?.() ?? null
        if (link === null) return { ok: false, reason: NOT_LINKED }
        const file = read()
        if (file.threads[threadId]) return { ok: false, reason: 'This thread has a key already.' }
        const minted = await mintIn(file, threadId, chatId, link)
        if (!minted.ok) return { ok: false, reason: minted.reason }
        try {
          await write(file)
        } catch (error) {
          // Not kept, so not left live.
          await discard(link, file.threads[threadId].key)
          return kept(error)
        }
        changed([threadId])
        return minted
      }).catch(kept)
    },
    keyFor: (threadId) => {
      const entry = read().threads[threadId]
      return live(entry, rt.omniLink?.() ?? null) ? entry.key : null
    },
    connected: threadId => rt.threadKeys.keyFor(threadId) !== null,
    reasonOf: (threadId) => {
      const link = rt.omniLink?.() ?? null
      const file = read()
      const entry = file.threads[threadId]
      if (live(entry, link)) return null
      if (entry?.pending) return BEING_CUT
      if (link === null) return NOT_LINKED
      const waiting = file.waiting[threadId]
      const origin = entry?.origin ?? waiting?.origin
      if (origin === undefined) return NO_KEY
      return sameOmni(link.url, origin) ? waiting?.reason ?? NO_KEY : OTHER_OMNI
    },
    // The thread is gone: its key is cut, or kept pending until a drain cuts it.
    revoke: threadId => serial(async () => {
      const file = read()
      const entry = file.threads[threadId]
      const waited = file.waiting[threadId] !== undefined
      delete file.waiting[threadId]
      if (entry === undefined) {
        if (waited) {
          await write(file)
          changed([threadId])
        }
        return { cut: true }
      }
      if (await cut(entry, parentsOf(file, entry, rt.omniLink?.() ?? null))) drop(file, threadId)
      else entry.pending ??= { since: Date.now() }
      await write(file)
      changed([threadId])
      return { cut: file.threads[threadId] === undefined }
    }),
    // Pending cuts are tried again, and the keyless threads of the linked Omni ask for a key.
    drain: () => serial(async () => {
      const file = read()
      const link = rt.omniLink?.() ?? null
      const done = []
      const down = new Set()
      for (const [threadId, entry] of Object.entries(file.threads)) {
        if (entry.pending === null) continue
        if (await cut(entry, parentsOf(file, entry, link), down)) {
          drop(file, threadId)
          done.push(threadId)
        }
      }
      const claimed = await claimIn(file, link, down)
      if (done.length === 0 && claimed.got.length === 0 && !claimed.reasons) return
      await write(file)
      changed([...done, ...claimed.got])
    }),
    onChange: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  // omni.json changes only here (`commit`, a new link on any path, or a disconnect with `next`
  // null), inside the same lock as every mint and cut, so none runs on the old link meanwhile.
  // First every thread key is cut with the key it was made with, and the old link key stays in
  // the file only while a cut is pending. Then each thread of the same Omni gets a fresh child
  // of the next key; one whose mint fails, or whose old key is still being cut, waits for it
  // with the reason, and asks again at start and on the timer. Another Omni, or none, leaves
  // the threads not connected. A new link with the same key on the same Omni changes nothing.
  // `unreadable`: why nothing in the file could be cut, when it failed its check.
  rt.handOverThreadKeys = (next, commit = async () => {}) => serial(async () => {
    const link = rt.omniLink?.() ?? null
    const { file, bad } = readKeys()
    const threadIds = Object.keys(file.threads)
    const same = link !== null && next && next.key === link.key && sameOmni(next.url, link.url)
    if (same || (threadIds.length === 0 && Object.keys(file.waiting).length === 0)) {
      await commit()
      return { unreadable: bad ? UNREADABLE : null }
    }
    const kept = []
    const down = new Set()
    for (const threadId of threadIds) {
      const entry = file.threads[threadId]
      if (entry.pending === null) file.waiting[threadId] = { chatId: entry.chatId, origin: entry.origin, reason: WAITING }
      if (await cut(entry, parentsOf(file, entry, link), down)) {
        drop(file, threadId)
        continue
      }
      entry.pending ??= { since: Date.now() }
      if (link !== null && sameOmni(link.url, entry.origin)) kept.push(entry.childId)
    }
    if (link !== null && kept.length > 0) file.retired.push({ origin: link.url, parentKey: link.key, childIds: kept })
    const claimed = await claimIn(file, next ?? null, down)
    await write(file)
    await commit()
    changed([...new Set([...threadIds, ...claimed.got])])
    return { unreadable: null }
  })

  // At start and on a timer, on the host that holds the team (one that only reads it leaves
  // that to the other).
  rt.ctx.effect?.(() => {
    let stopped = false
    let running = null
    // A tick while the last drain still runs (an Omni slow to answer) is skipped.
    const tick = () => {
      if (running !== null) return
      running = (async () => {
        await rt.load?.()
        if (stopped || rt.readOnly?.() !== undefined) return
        await rt.threadKeys.drain()
      })().catch(error => rt.warn?.('omni-channels: thread keys: %s', error?.message ?? error)).finally(() => { running = null })
    }
    tick()
    const timer = setInterval(tick, DRAIN_MS)
    timer.unref?.()
    return async () => {
      stopped = true
      clearInterval(timer)
      await running
    }
  }, 'omni-channels: thread keys')
}
