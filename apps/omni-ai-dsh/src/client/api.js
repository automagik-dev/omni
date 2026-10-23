// Calls the host endpoint (src/host/endpoint.js). Document-relative, so DSH's web UI keeps
// working under a mounted base path.
const ROUTE = 'api/omni-ai'
// The Omni plugins' endpoint, which @automagik/omni-channels-dsh extends with discovery and
// linking (omni-discover, omni-link…). It answers only once those plugins run here.
const OMNI_UI = 'api/omni-ui'

export const call = (endpoint, payload) => callRoute(ROUTE, endpoint, payload)
export const callOmniUi = (endpoint, payload) => callRoute(OMNI_UI, endpoint, payload)

async function callRoute(route, endpoint, payload) {
  let response
  try {
    response = await fetch(route, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload: payload ?? null }),
    })
  } catch {
    throw Object.assign(new Error('Could not reach DSH. Check that it is still running.'), { code: 'NETWORK' })
  }
  if (!response.ok) throw Object.assign(new Error(`DSH answered HTTP ${response.status}`), { code: `HTTP_${response.status}` })
  const result = await response.json()
  if (!result.ok) throw Object.assign(new Error(result.error?.message ?? 'Request failed'), { code: result.error?.code ?? 'omni-ai/error' })
  return result.value
}
