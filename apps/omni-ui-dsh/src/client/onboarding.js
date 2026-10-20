import { STORAGE } from './storage.js'

// When the onboarding step omni-connect shows, and how a skip is kept. No React here, so
// the rules test without a shell.
//
// The step completes at once when this DSH already reaches an Omni (a paired link, or the
// older profile URL and key), and when the user skipped it before, unless they reopened
// it on purpose. A skip is kept by the omni-ai plugin (@automagik/omni-ai-dsh), whose
// settings entry holds the other onboarding flags; a DSH without it keeps the skip in
// this plugin's own browser storage.

export const CONNECT_STEP = Object.freeze({ id: 'omni-connect', order: -250 })
// omni-ai's host endpoint (apps/omni-ai-dsh/src/host/endpoint.js); document-relative like
// this plugin's own api/omni-ui.
const OMNI_AI_ROUTE = 'api/omni-ai'

// One omni-ai action. Any answer that is not omni-ai's own { ok: true } envelope throws:
// a DSH without omni-ai answers 404, or a page that is not JSON.
export async function callOmniAi(endpoint, payload, fetchImpl = globalThis.fetch) {
  const response = await fetchImpl(OMNI_AI_ROUTE, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload: payload ?? null }),
  })
  if (!response.ok) throw Object.assign(new Error(`omni-ai answered HTTP ${response.status}`), { code: `HTTP_${response.status}` })
  const result = await response.json()
  if (result?.ok !== true) throw Object.assign(new Error(result?.error?.message ?? 'omni-ai refused'), { code: result?.error?.code ?? 'omni-ai/error' })
  return result.value
}

const localStore = () => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function skippedHere(storage = localStore()) {
  try {
    return storage?.getItem(STORAGE.connectOmniSkipped) === '1'
  } catch {
    return false
  }
}

function keepSkipHere(storage = localStore()) {
  try {
    storage?.setItem(STORAGE.connectOmniSkipped, '1')
  } catch { /* storage unavailable: the step shows again next time */ }
}

// Whether the link this host reports reaches an Omni.
export const isConnected = link => link?.linked === true || link?.configured === true

// Decides at mount. Returns null when the step completed itself, else what the step shows
// with: { link }. `request` is this plugin's host call; `omniAi` is callOmniAi.
export async function gateConnect({ explicit, complete }, { request, omniAi = callOmniAi, storage = localStore() } = {}) {
  let link = null
  try {
    link = await request('omni-link')
  } catch { /* the host could not answer: offer the card */ }
  if (explicit === true) return { link }
  if (isConnected(link)) {
    complete()
    return null
  }
  let skipped = skippedHere(storage)
  if (!skipped) {
    try {
      skipped = (await omniAi('state'))?.connectOmniSkipped === true
    } catch { /* no omni-ai here: only this plugin's own storage counts */ }
  }
  if (skipped) {
    complete()
    return null
  }
  return { link }
}

// Keeps the skip with omni-ai, or here when omni-ai is absent, then hands on to the next step.
export async function skipConnect({ complete }, { omniAi = callOmniAi, storage = localStore() } = {}) {
  try {
    await omniAi('done', { stepId: CONNECT_STEP.id })
  } catch {
    keepSkipHere(storage)
  }
  complete()
}
