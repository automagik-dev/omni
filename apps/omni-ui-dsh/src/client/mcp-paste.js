// The Capabilities paste helper: whatever an MCP server's docs say to add (an mcpServers JSON
// block, an npx/uvx command, a URL) goes to the Main Bot, which sets it up with
// save_capability. Keys in it never reach a model: each is saved as a secret first and the
// text carries $DSH_SECRET_<NAME> in its place, the reference save_capability expands.

const SECRETISH = /(key|token|secret|password|passwd|pass|auth|bearer|credential|cookie)/i
// Values that are clearly not a key: placeholders, references, booleans, short words.
const placeholder = value => /^\$|^\$\{|<.*>|your[-_ ]|xxx|\.\.\.|^(true|false|null)$/i.test(value) || value.length < 8 || /\s/.test(value)
// Well-known key shapes, wherever they appear.
const KEY_SHAPES = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,}|omni_sk_[A-Za-z0-9]{16,})\b/g

const nameOf = key => key.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase().replace(/^(?=\d)/, 'K_').slice(0, 64) || 'MCP_KEY'

export function extractSecrets(raw) {
  const secrets = new Map()
  const take = (preferred, value) => {
    for (const [name, known] of secrets) if (known === value) return name
    let name = nameOf(preferred)
    for (let n = 2; secrets.has(name); n += 1) name = `${nameOf(preferred)}_${n}`
    secrets.set(name, value)
    return name
  }
  const ref = name => `$DSH_SECRET_${name}`
  let text = String(raw ?? '')
  // "SOME_API_KEY": "value" in JSON, and Authorization headers with a bearer token.
  text = text.replace(/"([A-Za-z0-9_.-]+)"(\s*:\s*)"(Bearer\s+)?([^"]+)"/g, (whole, key, colon, bearer, value) => {
    if (!SECRETISH.test(key) || placeholder(value)) return whole
    return `"${key}"${colon}"${bearer ?? ''}${ref(take(/^authorization$/i.test(key) ? 'MCP_AUTH_TOKEN' : key, value))}"`
  })
  // KEY=value in a shell command or an env file.
  text = text.replace(/\b([A-Z][A-Z0-9_]*)=("([^"]*)"|'([^']*)'|([^\s"']+))/g, (whole, key, _quoted, double, single, bare) => {
    const value = double ?? single ?? bare
    if (!SECRETISH.test(key) || placeholder(value)) return whole
    return `${key}=${ref(take(key, value))}`
  })
  // ?api_key=value in a URL.
  text = text.replace(/([?&])([A-Za-z0-9_.-]+)=([^&\s"']+)/g, (whole, sep, key, value) => {
    if (!SECRETISH.test(key) || placeholder(value)) return whole
    return `${sep}${key}=${ref(take(key, value))}`
  })
  // Any key with a well-known shape that is still in the text.
  text = text.replace(KEY_SHAPES, value => ref(take('MCP_API_KEY', value)))
  return { text, secrets: [...secrets].map(([name, value]) => ({ name, value })) }
}

export const mcpRequest = text => [
  'Add this MCP server as a shared capability with save_capability.',
  'Work out a short name, whether it is a local command (stdio) or a URL (streamable-http), and a one-line description from what I pasted.',
  'Keys are already saved as secrets and appear as $DSH_SECRET_<NAME>: keep those references exactly. If it needs a key I did not give, ask me for it with a secret card instead of guessing.',
  'Then tell me in one line what you added, and whether I must allow it in settings.',
  '',
  '<<<',
  text.trim(),
  '>>>',
].join('\n')
