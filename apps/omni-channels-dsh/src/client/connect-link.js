// A link an Omni sends its owner to connect this app: the page on the Omni itself,
// https://<omni>/api/login/app?grant=<grant>, or the omni://connect?url=<omni>&grant=<grant>
// link that page opens. Either reads as { url, grant }, or null when it is neither.
const APP_PAGE = /\/api\/login\/app\/?$/
// The grant: 24 base64url characters, as the Omni mints it.
const GRANT = /^[A-Za-z0-9_-]{24}$/

const omniBase = (text) => {
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (url.username || url.password) return null
    return `${url.origin}${url.pathname.replace(/\/api\/v2\/?$/, '').replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

export function parseConnectLink(text) {
  let link
  try {
    link = new URL(String(text ?? '').trim())
  } catch {
    return null
  }
  const grant = link.searchParams.get('grant') ?? ''
  if (!GRANT.test(grant)) return null
  if (link.protocol === 'omni:') {
    const url = link.hostname === 'connect' || link.pathname.replace(/^\/+/, '') === 'connect' ? omniBase(link.searchParams.get('url') ?? '') : null
    return url ? { url, grant } : null
  }
  if ((link.protocol !== 'https:' && link.protocol !== 'http:') || !APP_PAGE.test(link.pathname)) return null
  const url = omniBase(`${link.origin}${link.pathname.replace(APP_PAGE, '')}`)
  return url ? { url, grant } : null
}
