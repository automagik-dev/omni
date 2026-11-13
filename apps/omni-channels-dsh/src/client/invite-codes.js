// #1716: the invite code list staff upload (host answer-invites.js, invite-codes.js), in the
// answer settings: paste lines or a JSON array, then the list with each code's project, expiry
// and state. The list is the whole install's; it is read only when staff show it.
import { createElement as h, useEffect, useState } from 'react'
import { call, hostText } from './core.js'

const pad = value => String(value).padStart(2, '0')
// The end of that day where staff are, as an ISO time.
const endOfDay = (year, month, day) => {
  const at = new Date(year, month - 1, day, 23, 59, 59, 999)
  return at.getFullYear() === year && at.getMonth() === month - 1 && at.getDate() === day ? at.toISOString() : undefined
}
// A code's expiry as staff read it: the day, where they are.
export const dayOf = iso => {
  const at = new Date(iso)
  return Number.isNaN(at.getTime()) ? '' : `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
}

/**
 * What staff pasted, as the upload's entries: a JSON array as it is, or one code a line,
 * `code, project, expires YYYY-MM-DD[, context]` (the word "expires" may be left out; the context
 * is the rest of the line). `{ entries }`, or `{ problem }` naming the line, never its code.
 */
export function parseInviteLines(text) {
  const trimmed = String(text ?? '').trim()
  if (trimmed === '') return { problem: 'Paste at least one code.' }
  if (trimmed.startsWith('[')) {
    let entries
    try { entries = JSON.parse(trimmed) } catch { return { problem: 'The JSON could not be read.' } }
    return Array.isArray(entries) && entries.length > 0 ? { entries } : { problem: 'The JSON must be a list of codes.' }
  }
  const entries = []
  const lines = trimmed.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const parts = line.split(',')
    const [code = '', project = '', expires = ''] = parts.map(part => part.trim())
    const date = /^(?:expires\s+)?(\d{4})-(\d{2})-(\d{2})$/i.exec(expires)
    const expiresAt = date ? endOfDay(Number(date[1]), Number(date[2]), Number(date[3])) : undefined
    if (code === '' || project === '' || expiresAt === undefined) return { problem: `Line ${index + 1}: write code, project, expires YYYY-MM-DD, and a note if you like.` }
    const context = parts.slice(3).join(',').trim()
    entries.push({ code, project, expiresAt, ...(context ? { context } : {}) })
  }
  return entries.length > 0 ? { entries } : { problem: 'Paste at least one code.' }
}

const STATES = { open: 'Open', used: 'Used', expired: 'Expired' }

export function InviteCodes() {
  const [shown, setShown] = useState(false)
  const [codes, setCodes] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)
  const [read, setRead] = useState(0)
  useEffect(() => {
    if (!shown) return undefined
    let alive = true
    call('omni-invite-codes', {}).then(
      reply => { if (alive) setCodes(Array.isArray(reply?.codes) ? reply.codes : []) },
      (error) => { if (alive) setResult({ ok: false, text: hostText(error.message) }) },
    )
    return () => { alive = false }
  }, [shown, read])
  const add = async () => {
    const parsed = parseInviteLines(text)
    if (parsed.problem) { setResult({ ok: false, text: parsed.problem }); return }
    setBusy(true); setResult(null)
    try {
      const reply = await call('omni-invite-codes-add', { entries: parsed.entries })
      setText('')
      const used = reply?.used ? ` ${reply.used} already used, left as they were.` : ''
      setResult({ ok: true, text: `Added ${reply?.added ?? 0}, updated ${reply?.updated ?? 0}.${used}` })
      setRead(before => before + 1)
    } catch (error) { setResult({ ok: false, text: hostText(error.message) }) } finally { setBusy(false) }
  }
  return h('div', { className: 'ot-invites', role: 'group', 'aria-label': 'Invite codes' },
    h('div', { className: 'ot-invites-head' },
      h('span', { className: 'bt-field-label' }, shown && codes !== null ? `Invite codes (${codes.length})` : 'Invite codes'),
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', 'aria-expanded': shown, onClick: () => setShown(before => !before) }, shown ? 'Hide' : 'Show')),
    shown ? h('label', { className: 'ot-answer-label' },
      h('span', { className: 'bt-note' }, 'One code a line: code, project, expires YYYY-MM-DD, and a note about the person if you like. Or paste a JSON list. A code lets in one person.'),
      h('textarea', {
        className: 'bt-input bt-input-area ot-invites-paste', value: text, spellCheck: false, autoComplete: 'off',
        placeholder: 'INV-…, project, 2026-12-31, a note', 'aria-label': 'Codes to add', onChange: event => setText(event.target.value),
      })) : null,
    shown ? h('div', { className: 'bt-actions' },
      h('button', { type: 'button', className: 'bt-soft bt-soft-sm', disabled: busy || text.trim() === '', onClick: add }, 'Add codes')) : null,
    shown && result ? h('p', { className: result.ok ? 'ot-picker-note' : 'ot-picker-problem', role: result.ok ? 'status' : 'alert' }, result.text) : null,
    !shown || codes === null ? null
      : codes.length === 0 ? h('span', { className: 'bt-note' }, 'No codes yet.')
      : h('ul', { className: 'ot-invite-list' }, codes.map(code => h('li', { key: code.code, className: 'ot-invite', 'data-state': code.state },
        h('span', { className: 'ot-invite-code' }, code.code),
        h('span', { className: 'ot-invite-state' }, STATES[code.state] ?? code.state),
        h('span', { className: 'ot-invite-meta', title: code.context || undefined }, `${code.project} · expires ${dayOf(code.expiresAt)}`)))))
}

export const INVITE_CODES_CSS = `
.ot-invites{display:grid;gap:6px;min-width:0}
.ot-invites-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
.ot-invites .ot-invites-paste{box-sizing:border-box;width:100%;min-width:0;font-family:var(--bt-mono, ui-monospace, monospace);font-size:12px}
.ot-invites .bt-actions{justify-content:flex-end}
.ot-invite-list{display:grid;gap:6px;max-height:220px;margin:0;padding:0;overflow-y:auto;list-style:none}
.ot-invite{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:1px 8px;min-width:0;padding:6px 8px;border:1px solid var(--bt-line, rgba(127,127,127,.2));border-radius:8px}
.ot-invite-code{flex:1 0 auto;max-width:100%;overflow-wrap:anywhere;font-family:var(--bt-mono, ui-monospace, monospace);font-size:12px;line-height:17px;color:var(--bt-ink)}
.ot-invite-state{flex:none;font-size:11px;line-height:17px;color:var(--bt-ink-2)}
.ot-invite[data-state=open] .ot-invite-state{color:var(--bt-ok, #16a34a)}
.ot-invite-meta{flex-basis:100%;min-width:0;overflow-wrap:anywhere;font-size:12px;line-height:17px;color:var(--bt-ink-3)}
`
