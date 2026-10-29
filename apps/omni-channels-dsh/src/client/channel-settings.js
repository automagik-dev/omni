import * as SettingsReact from 'react'
const { createElement: h, useEffect, useRef, useState } = SettingsReact
import { FIELDS, GROUPS, fieldText, inputValue } from '../host/channel-settings.js'
import { call, t } from './core.js'
import { refreshLive } from './omni-store.js'

// Keyed by channel id by the parent: a late response can never edit a different channel.
export function ChannelSettings({ channel, writable, request = call, refresh = () => refreshLive(call) }) {
  const [record, setRecord] = useState(null)
  const [draft, setDraft] = useState({})
  const [agents, setAgents] = useState([])
  const [agentError, setAgentError] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [token, setToken] = useState('')
  const alive = useRef(false)
  const inFlight = useRef(false)
  useEffect(() => {
    alive.current = true
    request('omni-channel-settings', { id: channel.id }).then(reply => {
      if (alive.current) setRecord(reply.settings)
    }, failure => { if (alive.current) setError(failure.message) })
    request('omni-channel-agents').then(reply => {
      if (alive.current) setAgents(reply.items)
    }, () => { if (alive.current) setAgentError(t('Could not load agents. The current assignment is unchanged.')) })
    return () => { alive.current = false }
  }, [channel.id, request])
  const edit = (key, value) => { setDraft(before => ({ ...before, [key]: value })); setSaved(false) }
  const value = key => Object.hasOwn(draft, key) ? draft[key] : record?.[key]
  const run = async (endpoint, payload) => {
    if (!writable || inFlight.current) return
    inFlight.current = true
    if (endpoint === 'omni-wab-repair') setDraft(before => Object.fromEntries(Object.entries(before).filter(([key]) => !key.startsWith('meta'))))
    setBusy(true); setError(''); setSaved(false)
    try {
      await request(endpoint, payload)
      const reply = await request('omni-channel-settings', { id: channel.id })
      if (!alive.current) return
      setRecord(reply.settings)
      setDraft(before => endpoint === 'omni-channel-settings-save' ? {} : Object.fromEntries(Object.entries(before).filter(([key]) => !key.startsWith('meta'))))
      setSaved(true)
      await refresh().catch(() => { if (alive.current) setError(t('Settings saved, but the channel overview could not refresh.')) })
    } catch (failure) {
      if (endpoint === 'omni-wab-repair' && alive.current) {
        try {
          const reply = await request('omni-channel-settings', { id: channel.id })
          if (alive.current) {
            setRecord(reply.settings)
            setDraft(before => Object.fromEntries(Object.entries(before).filter(([key]) => !key.startsWith('meta'))))
          }
        } catch { /* Keep the failure visible even when the authoritative reload also fails. */ }
      }
      if (alive.current) setError(endpoint === 'omni-wab-repair' ? `${failure.message} ${t('Credentials may have been saved. Reload this channel before retrying.')}` : failure.message)
    } finally {
      inFlight.current = false
      if (alive.current) setBusy(false)
    }
  }
  const save = () => {
    try {
      const patch = Object.fromEntries(Object.entries(draft).map(([key, text]) => [key, text === null ? null : inputValue(FIELDS[key], text)]))
      void run('omni-channel-settings-save', { id: channel.id, patch })
    } catch (failure) { setError(failure.message) }
  }
  const control = key => {
    const field = FIELDS[key]
    const current = value(key)
    const text = Object.hasOwn(draft, key) ? draft[key] ?? '' : fieldText(field, current)
    const props = { 'aria-label': key, disabled: !writable || busy || field.readOnly, value: text,
      onChange: event => edit(key, event.target.value) }
    const options = field.options ?? (field.kind === 'boolean' ? ['true', 'false'] : null)
    return h('label', { key, className: 'oc-field' }, h('span', null, key.replace(/([a-z])([A-Z])/g, '$1 $2')),
      field.readOnly ? h('output', null, current ?? t('Not set')) : options
        ? h('select', props, h('option', { value: '' }, current === null ? t('Inherited / not set') : t('Not provided')), options.map(option => h('option', { key: option, value: option }, option)))
        : field.kind === 'json' ? h('textarea', { ...props, rows: 3, placeholder: 'JSON' })
          : h('input', { ...props, type: field.kind === 'number' ? 'number' : 'text', min: field.kind === 'number' ? 0 : undefined, placeholder: current === null ? 'null' : t('Not provided') }),
      field.example ? h('small', { className: 'oc-fine' }, `${t('Example')}: ${field.example}`) : null,
      field.nullable && !field.readOnly ? h('button', { type: 'button', className: 'oc-link', disabled: !writable || busy, onClick: () => edit(key, null) }, t('Clear override (null)')) : null)
  }
  const repair = () => {
    const accessToken = token.trim()
    if (!accessToken) return
    try {
      if (Object.entries(draft).some(([key, item]) => key.startsWith('meta') && item === null)) throw new Error(t('Save cleared Meta identifiers before reconnecting.'))
      const read = key => Object.hasOwn(draft, key) ? inputValue(FIELDS[key], draft[key]) : record[key]
      const credentials = { accessToken, phoneNumberId: read('metaPhoneNumberId'), wabaId: read('metaWabaId') }
      for (const [key, name] of [['metaAppId', 'appId'], ['metaBusinessId', 'businessId']]) {
        const item = read(key)
        if (item) credentials[name] = item
      }
      setToken('')
      void run('omni-wab-repair', { id: channel.id, ...credentials })
    } catch (failure) { setToken(''); setError(failure.message) }
  }
  return h('section', { 'aria-label': t('Channel settings') },
    h('h2', { className: 'oc-section' }, t('Channel settings')),
    error ? h('p', { role: 'alert', className: 'oc-problem' }, error) : null,
    saved ? h('p', { role: 'status' }, t('Settings saved')) : null,
    !record ? h('p', null, error ? t('Settings unavailable') : t('Loading settings…')) : h('div', null,
      h('label', { className: 'oc-field' }, h('span', null, t('Assigned agent')),
        h('select', { 'aria-label': 'agentId', value: value('agentId') ?? '', disabled: !writable || busy, onChange: event => edit('agentId', event.target.value || null) },
          h('option', { value: '' }, t('No agent')),
          value('agentId') && !agents.some(agent => agent.id === value('agentId')) ? h('option', { value: value('agentId') }, value('agentId')) : null,
          agents.map(agent => h('option', { key: agent.id, value: agent.id }, `${agent.name} · ${agent.id}`)))),
      h('label', { className: 'oc-field' }, t('Agent UUID (empty unassigns; list shows up to 200 agents)'), h('input', { 'aria-label': 'Agent UUID', value: value('agentId') ?? '', disabled: !writable || busy, onChange: event => edit('agentId', event.target.value.trim() || null) })),
      agentError ? h('p', { role: 'status' }, agentError) : null,
      GROUPS.filter(group => group.label !== 'Meta connection' || channel.type === 'whatsapp-business').map(group => h('details', { key: group.label },
        h('summary', null, t(group.label)), group.keys.map(control))),
      h('p', { className: 'oc-fine' }, t('JSON fields accept JSON values. Clear override sends null; untouched fields are never reset. Some settings apply on the next connection.')),
      h('p', { className: 'oc-fine' }, t('outboundPacingOverride requires a full-access key to enable. Meta API version is a provisioning snapshot; the runtime environment takes precedence.')),
      writable ? h('button', { type: 'button', className: 'oc-primary', disabled: busy || Object.keys(draft).length === 0, onClick: save }, busy ? t('Saving…') : t('Save settings')) : null,
      channel.type === 'whatsapp-business' && writable ? h('div', { className: 'oc-fix' },
        h('p', null, t('Repair this Business connection using the Meta identifiers above. Re-enter the access token; the existing channel and its chats are kept.')),
        h('label', { className: 'oc-field' }, h('span', null, t('Access token')), h('input', { type: 'password', 'aria-label': 'Access token', autoComplete: 'off', value: token, disabled: busy, onChange: event => setToken(event.target.value) })),
        h('button', { type: 'button', className: 'oc-secondary', disabled: busy || !token.trim(), onClick: repair }, t('Repair and reconnect'))) : null))
}
