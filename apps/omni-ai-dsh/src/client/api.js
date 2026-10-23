// Calls the host endpoint (src/host/endpoint.js). Document-relative, so DSH's web UI keeps
// working under a mounted base path.
const ROUTE = 'api/omni-ai'

export async function call(endpoint, payload) {
  let response
  try {
    response = await fetch(ROUTE, {
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
