import { createElement as h, useEffect, useRef, useState } from 'react'
import { refreshLive } from './omni-store.js'
import { call, hostText, t } from './core.js'
import { openConnectWizard } from './wizard.js'

// The Omni page in DSH's settings: where people who installed the Omni plugins into their
// own DSH find the Connect wizard, whether or not they ever saw onboarding. Not linked, it
// offers the wizard; linked, it says to which Omni, and offers Change (the wizard again) and
// Disconnect (asked first, then the link file goes).

export const SETTINGS_SECTION = Object.freeze({ id: 'omni', order: 60 })

/**
 * What the card shows for the link this host reports (`omni-link-info`), and its actions
 * in order. `confirming` is the second click of Disconnect.
 */
export function settingsView(info, { confirming = false } = {}) {
  if (!info?.linked && !info?.configured) {
    return {
      title: t('Connect your Omni'),
      lines: [t('Link this DSH to your Omni to see your channels and chats here, and let your Bots work with them.')],
      actions: [{ id: 'connect', label: t('Connect your Omni'), primary: true }],
    }
  }
  if (!info.linked) {
    return {
      title: t('Omni connected'),
      lines: [t('This DSH reaches an Omni through its profile settings (omni.url and its key).')],
      actions: [{ id: 'change', label: t('Change'), primary: false }],
    }
  }
  const lines = [info.version ? t('Omni {version}', { version: info.version }) : info.reachable === false ? t('Not answering right now.') : null].filter(Boolean)
  if (confirming) {
    return {
      title: t('Connected to {origin}', { origin: info.origin }),
      lines: [...lines, t('Disconnect from {origin}? Your Bots stop seeing its channels until you connect again.', { origin: info.origin })],
      actions: [{ id: 'confirm-disconnect', label: t('Disconnect'), primary: true, danger: true }, { id: 'cancel', label: t('Cancel'), primary: false }],
    }
  }
  return {
    title: t('Connected to {origin}', { origin: info.origin }),
    lines,
    actions: [{ id: 'change', label: t('Change'), primary: false }, { id: 'disconnect', label: t('Disconnect'), primary: false }],
  }
}

/**
 * What an action does. `close` leaves the settings panel (the wizard opens over the page),
 * `request` is this plugin's host call. Resolves the next `{info, confirming}`, or null when
 * nothing on the card changes.
 */
export async function runSettingsAction(id, { info, close = () => {}, request = call, open = openConnectWizard, refresh = () => refreshLive(call) } = {}) {
  if (id === 'connect' || id === 'change') {
    close()
    open()
    return null
  }
  if (id === 'disconnect') return { info, confirming: true }
  if (id === 'cancel') return { info, confirming: false }
  if (id === 'confirm-disconnect') {
    await request('omni-disconnect')
    await Promise.resolve(refresh()).catch(() => {})
    return { info: await request('omni-link-info'), confirming: false }
  }
  return null
}

// The chat threads' free reactions (host thread-tools.js): the emojis a thread reacts with
// without asking, shared by every thread. Typed as one line, separated by spaces or commas.
export const parseReactions = text => String(text ?? '').split(/[\s,]+/).filter(Boolean)

/**
 * Saves the list typed in the card (`omni-free-reactions-save`), or the defaults with
 * `reset`. Resolves the host's answer, `{ freeReactions, defaults }`.
 */
export async function saveFreeReactions(text, { reset = false, defaults = [], request = call } = {}) {
  return request('omni-free-reactions-save', { freeReactions: reset ? [...defaults] : parseReactions(text) })
}

// Whether chat threads and new automations ask first (host thread-tools.js, Decision 15): the
// owner's defaults for every thread, which a thread's own row can override. Asking is the
// default; turning it off is for an owner who leaves DSH running on its own.
export const THREAD_DEFAULT_FIELDS = Object.freeze(['threadSends', 'threadReactions', 'askFirstDefault'])

/**
 * The card's three choices for the host's answer (`omni-thread-defaults`): each with its
 * label, its options, the one chosen, and a plain line on what the choice lets happen.
 */
export function threadDefaultsView(defaults) {
  const sends = defaults?.threadSends === 'allow' ? 'allow' : 'ask'
  const reactions = defaults?.threadReactions === 'any' ? 'any' : 'list'
  const askFirst = defaults?.askFirstDefault === false ? 'off' : 'on'
  return {
    title: t('Asking you first'),
    lines: [
      t('Chat threads ask you before they send, and before any reaction that is not on the list below; new automations ask before they act. If you leave DeepSeek Harness running on its own, you can let them go without asking.'),
      t('Each thread can still choose for itself, from its menu in the sidebar.'),
    ],
    fields: [
      {
        id: 'threadSends', label: t('Messages from a chat thread'), value: sends,
        options: [{ value: 'ask', label: t('Ask me each time') }, { value: 'allow', label: t('Send without asking') }],
        note: sends === 'allow' ? t('A thread sends into its own chat as you, without showing you first. Someone in that chat could write a message that talks it into sending something.') : null,
      },
      {
        id: 'threadReactions', label: t('Reactions from a chat thread'), value: reactions,
        options: [{ value: 'list', label: t('Only the reactions below go without asking') }, { value: 'any', label: t('Any reaction goes without asking') }],
        note: null,
      },
      {
        id: 'askFirstDefault', label: t('New automations'), value: askFirst,
        options: [{ value: 'on', label: t('Ask me before they act') }, { value: 'off', label: t('Act without asking') }],
        note: askFirst === 'off'
          ? t('New automations act on what other people write in your chats. With this off, a message there could make a Bot run commands, change files or send as you without asking. Only for automations made from now on: each one you have keeps its own choice.')
          : t('Only for automations made from now on: each one you have keeps its own choice.'),
      },
    ],
    // A host that only reads the team shows them, and says why they cannot change here.
    readOnly: typeof defaults?.readOnly === 'string' && defaults.readOnly !== '' ? defaults.readOnly : null,
  }
}

/** Saves one choice from the card (`omni-thread-defaults-save`); resolves the host's answer. */
export async function saveThreadDefault(id, value, { request = call } = {}) {
  if (!THREAD_DEFAULT_FIELDS.includes(id)) throw new Error(`Unknown setting ${id}`)
  return request('omni-thread-defaults-save', { [id]: id === 'askFirstDefault' ? value !== 'off' : value })
}

export function ThreadDefaultsCard() {
  const [defaults, setDefaults] = useState(undefined)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => {
    call('omni-thread-defaults').then((reply) => { if (alive.current) setDefaults(reply) }, () => {})
  }, [])
  const change = async (id, value) => {
    setBusy(true)
    setNote(null)
    try {
      const reply = await saveThreadDefault(id, value)
      if (alive.current) {
        setDefaults(reply)
        setNote({ ok: true, text: t('Saved.') })
      }
    } catch (error) {
      if (alive.current) setNote({ ok: false, text: error.message })
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  if (defaults === undefined) return null
  return h(ThreadDefaultsFields, { view: threadDefaultsView(defaults), busy, note, onChange: change })
}

/** The card itself, for a view: on a host that only reads the team, every choice is shut and the reason shows. */
export function ThreadDefaultsFields({ view, busy = false, note = null, onChange = () => {} }) {
  return h('section', { className: 'oset-card' },
    h('div', { className: 'oset-text' },
      h('strong', null, view.title),
      view.lines.map(line => h('p', { key: line, className: 'oset-muted' }, line)),
      view.readOnly ? h('p', { className: 'oset-problem', role: 'status' }, hostText(view.readOnly)) : null,
      view.fields.map(field => h('label', { key: field.id, className: 'oset-field' },
        h('span', { className: 'oset-label' }, field.label),
        h('select', { className: 'oset-select', value: field.value, disabled: busy || view.readOnly !== null, 'data-setting': field.id, onChange: event => onChange(field.id, event.target.value) },
          field.options.map(option => h('option', { key: option.value, value: option.value }, option.label))),
        field.note ? h('span', { className: 'oset-muted' }, field.note) : null)),
      note ? h('p', { className: note.ok ? 'oset-muted' : 'oset-problem', role: note.ok ? 'status' : 'alert' }, note.text) : null))
}

export function FreeReactionsCard() {
  const [list, setList] = useState(undefined)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  const show = (reply) => {
    if (!alive.current) return
    setList(reply)
    setText(reply.freeReactions.join(' '))
  }
  useEffect(() => {
    call('omni-free-reactions').then(show, () => {})
  }, [])
  const save = async (reset) => {
    setBusy(true)
    setNote(null)
    try {
      show(await saveFreeReactions(text, { reset, defaults: list?.defaults }))
      if (alive.current) setNote({ ok: true, text: t('Saved.') })
    } catch (error) {
      if (alive.current) setNote({ ok: false, text: error.message })
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  if (list === undefined) return null
  return h('section', { className: 'oset-card' },
    h('div', { className: 'oset-text' },
      h('strong', null, t('Reactions without asking')),
      h('p', { className: 'oset-muted' }, t('In a chat thread, these reactions go without asking you first. Any other reaction asks, unless you let every reaction go above or in the thread\'s menu.')),
      h('input', { className: 'oset-input', value: text, disabled: busy, 'aria-label': t('Reactions without asking'), onChange: event => setText(event.target.value) }),
      note ? h('p', { className: note.ok ? 'oset-muted' : 'oset-problem', role: note.ok ? 'status' : 'alert' }, note.text) : null),
    h('div', { className: 'oset-actions' },
      h('button', { type: 'button', className: 'oset-button oset-primary', disabled: busy, onClick: () => save(false) }, t('Save')),
      h('button', { type: 'button', className: 'oset-button', disabled: busy, onClick: () => save(true) }, t('Reset'))))
}

export function OmniSettingsSection({ close }) {
  const [info, setInfo] = useState(undefined)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState(null)
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])
  useEffect(() => {
    call('omni-link-info').then((reply) => { if (alive.current) setInfo(reply) }, () => { if (alive.current) setInfo({ linked: false, configured: false }) })
  }, [])

  const act = async (id) => {
    setBusy(true)
    setProblem(null)
    try {
      const next = await runSettingsAction(id, { info, close })
      if (!alive.current || next === null) return
      setInfo(next.info)
      setConfirming(next.confirming)
    } catch (error) {
      if (alive.current) setProblem(error.message)
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const view = info === undefined ? null : settingsView(info, { confirming })
  return h('div', { className: 'oset-page' },
    h('h2', { className: 'oset-heading' }, 'Omni'),
    view === null ? h('p', { className: 'oset-muted' }, t('Looking for your Omni…')) : h('section', { className: 'oset-card' },
      h('div', { className: 'oset-text' },
        h('strong', null, view.title),
        view.lines.map(line => h('p', { key: line, className: 'oset-muted' }, line))),
      h('div', { className: 'oset-actions' }, view.actions.map(action => h('button', {
        key: action.id,
        type: 'button',
        className: `oset-button${action.primary ? ' oset-primary' : ''}${action.danger ? ' oset-danger' : ''}`,
        disabled: busy,
        onClick: () => act(action.id),
      }, action.label)))),
    problem ? h('p', { className: 'oset-problem', role: 'alert' }, problem) : null,
    info?.linked ? h(ThreadDefaultsCard) : null,
    info?.linked ? h(FreeReactionsCard) : null)
}

export const OMNI_SETTINGS_CSS = `
.oset-page{display:flex;flex-direction:column;gap:14px;max-width:640px}
.oset-heading{margin:0;font-size:18px;font-weight:600}
.oset-card{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;padding:18px 20px;border:1px solid color-mix(in srgb,currentColor 16%,transparent);border-radius:14px;background:color-mix(in srgb,#22d3ee 5%,transparent)}
.oset-text{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
.oset-text strong{font-size:15px;font-weight:600;overflow-wrap:anywhere}
.oset-muted{margin:0;opacity:.72;font-size:13px;line-height:1.45}
.oset-actions{display:flex;gap:8px;flex-wrap:wrap}
.oset-button{height:36px;padding:0 16px;border-radius:999px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:none;color:inherit;font:inherit;font-size:13.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.oset-button:disabled{opacity:.5;cursor:default}
.oset-primary{border:0;background:linear-gradient(135deg,#22d3ee,#ff3bd4);color:#06060f}
.oset-danger{background:#e5484d;color:#fff}
.oset-problem{margin:0;color:#e5484d;font-size:13px}
.oset-field{display:flex;flex-direction:column;gap:4px;margin-top:8px}
.oset-label{font-size:13px;font-weight:600}
.oset-select{height:34px;padding:0 10px;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:none;color:inherit;font:inherit;font-size:13.5px}
.oset-select:disabled{opacity:.5}
.oset-input{margin-top:6px;height:36px;padding:0 12px;border-radius:10px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);background:none;color:inherit;font:inherit;font-size:16px;letter-spacing:.12em}
`

// Registers the page on DSH's settings.section slot, which ui-settings declares in its own
// apply, possibly after this one.
export function registerSettings(ctx) {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.omniSettings = ''
    style.textContent = OMNI_SETTINGS_CSS
    document.head.append(style)
    return () => style.remove()
  }, 'omni-channels: settings styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: SETTINGS_SECTION.id, order: SETTINGS_SECTION.order, label: 'Omni' }, OmniSettingsSection))
}
