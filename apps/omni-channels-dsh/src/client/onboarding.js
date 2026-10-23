// When the onboarding step omni-connect shows, and how a skip is kept. No React here, so
// the rules test without a shell.
//
// The step completes at once when this DSH already reaches an Omni (a paired link, or the
// older profile URL and key), and when the user skipped it before, unless they reopened
// it on purpose. A skip is kept by the omni-ai plugin (@automagik/omni-ai-dsh), whose
// settings entry holds the other onboarding flags; a DSH without it keeps the skip in
// this plugin's own browser storage.

export const CONNECT_STEP = Object.freeze({ id: 'omni-connect', order: -250 })
// Where a skip is kept without omni-ai: the browser-storage key the team's own plugin
// used while the step was its own, under its omni-ui prefix.
const SKIPPED_KEY = 'omni-ui:connect-omni-skipped'
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

export const localStore = () => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function skippedHere(storage = localStore()) {
  try {
    return storage?.getItem(SKIPPED_KEY) === '1'
  } catch {
    return false
  }
}

function keepSkipHere(storage = localStore()) {
  try {
    storage?.setItem(SKIPPED_KEY, '1')
  } catch { /* storage unavailable: the step shows again next time */ }
}

// The first-run step DSH mounts counts itself here while it shows, so the wizard this plugin
// opens on its own (wizard.js) never stacks on it.
let stepsShown = 0
export function noteStepShown() {
  stepsShown += 1
  return () => { stepsShown -= 1 }
}
// omni-ai's onboarding steps count themselves on this shared counter while they show: its team
// step installs this plugin mid-onboarding, and the wizard must not open on top of it.
const OMNI_AI_SHOWING = Symbol.for('automagik.omni.onboarding-showing')
export const stepShown = (scope = globalThis) => stepsShown > 0 || (scope[OMNI_AI_SHOWING] ?? 0) > 0

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
