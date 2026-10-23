import { createElement as h, useEffect, useState } from 'react'
import { call } from './api.js'
import { genieSvg } from './genie.js'
import { OCTOPUS_SVG } from './octopus.js'
import { Stage, useFinish, useGate, useGlitch } from './stage.js'

// Step omni-team (order -270): a character select. Each Bot type shows what it can do, as
// stats with the switches behind them, what it controls, its own project, and the menu
// items it brings. Omni's channels come from the linked Omni (read through
// @automagik/omni-dsh's omni-overview); Genie has no DSH plugin yet, and says so.

// The Omni plugins' endpoint, which the channels plugin extends with omni-overview.
async function overview() {
  try {
    const response = await fetch('api/omni-ui', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ endpoint: 'omni-overview', payload: {} }) })
    const result = await response.json()
    return result.ok ? result.value : null
  } catch {
    return null
  }
}

// A home folder path as people write it.
const tilde = path => path.replace(/^\/(?:home|Users)\/[^/]+(?=\/)/, '~')

const TYPE_LABEL = { 'whatsapp-baileys': 'WhatsApp', 'whatsapp-cloud': 'WhatsApp Business', slack: 'Slack', telegram: 'Telegram', discord: 'Discord', gupshup: 'Gupshup' }
export const channelLabel = channel => TYPE_LABEL[channel.type] ?? channel.type ?? 'Channel'

// What each type can reach: a stat (0-5) and whether its switch is on. `locked` is the
// one thing the type exists for, so it cannot be switched off.
export const OMNI_STATS = [
  { id: 'channels', label: 'Channels', value: 5, on: true, locked: true },
  { id: 'threads', label: 'Threads', value: 3, on: true },
  { id: 'canvases', label: 'Live canvases', value: 4, on: true },
  { id: 'files', label: 'Files', value: 1, on: false },
  { id: 'shell', label: 'Shell', value: 0, on: false },
]
export const GENIE_STATS = [
  { id: 'threads', label: 'Threads', value: 5 },
  { id: 'files', label: 'Files', value: 4 },
  { id: 'shell', label: 'Shell', value: 4 },
  { id: 'plugins', label: 'Plugins', value: 3 },
  { id: 'channels', label: 'Channels', value: 1 },
]

function Stat({ stat, onToggle, disabled }) {
  return h('li', { className: `oai-stat${stat.on === false ? ' oai-off' : ''}` },
    h('span', { className: 'oai-stat-label' }, stat.label),
    h('span', { className: 'oai-bar', 'aria-label': `${stat.value} of 5` }, [0, 1, 2, 3, 4].map(index => h('i', { key: index, className: index < stat.value ? 'oai-pip on' : 'oai-pip' }))),
    !onToggle ? h('span', { className: 'oai-soon' }, 'soon')
      : stat.locked ? h('span', { className: 'oai-core', title: 'What this Bot is for: always on' }, 'core')
        : h('button', { type: 'button', role: 'switch', className: 'oai-switch', 'aria-checked': stat.on === true, 'aria-label': `${stat.label} for this Bot`, disabled, onClick: onToggle }))
}

function Facts({ rows }) {
  return h('dl', { className: 'oai-facts' }, rows.map(([term, value]) => [h('dt', { key: `${term}t` }, term), h('dd', { key: `${term}d` }, value)]))
}

export function TeamStep(props) {
  const state = useGate(props)
  const finish = useFinish(props)
  const [glitching, glitch] = useGlitch()
  const [omni, setOmni] = useState(true)
  const [stats, setStats] = useState(OMNI_STATS)
  const [live, setLive] = useState(undefined)
  const [saving, setSaving] = useState(false)
  const [problem, setProblem] = useState(null)
  const [project, setProject] = useState(null)

  useEffect(() => { overview().then(setLive) }, [])
  useEffect(() => { call('companion').then(reply => setProject(reply?.omniProject ?? null), () => {}) }, [])
  useEffect(() => { if (state) glitch() }, [state, glitch])
  if (!state) return null

  const channels = live?.configured ? live.channels ?? [] : []
  const chats = live?.configured ? live.chats ?? [] : []
  const name = state.companionName ?? 'Your companion'
  const toggle = id => setStats(rows => rows.map(row => (row.id === id && !row.locked ? { ...row, on: !row.on } : row)))

  const go = async () => {
    setSaving(true)
    setProblem(null)
    try {
      await call('team-save', { omni, genie: false, omniAbilities: Object.fromEntries(stats.map(row => [row.id, row.on])) })
      finish()
    } catch (error) {
      setProblem(error.message)
      setSaving(false)
    }
  }

  const menu = channels.length > 0
    ? h('ul', { className: 'oai-menu-preview' }, channels.slice(0, 5).map(channel => h('li', { key: channel.id }, h('span', { className: `oai-dot ${channel.status === 'connected' ? 'ok' : 'warn'}` }), `${channelLabel(channel)} · ${channel.name}`)))
    : h('p', { className: 'oai-muted' }, live === undefined ? 'Reading your Omni…' : 'Link an Omni next, and each of its channels gets a place in your menu.')

  return h(Stage, {
    title: 'Grow your team',
    speech: `${name} here! Two friends can join us. Pick who comes along.`,
    at: 'omni-team',
    glitching,
    wide: true,
  },
  h('p', { className: 'oai-lede' }, `${name} leads. Each friend brings its own powers, its own project and its own place in your menu.`),
  h('div', { className: 'oai-select' },
    h('article', { className: `oai-fighter oai-omni${omni ? ' oai-chosen' : ''}` },
      h('div', { className: 'oai-portrait oai-rise', 'aria-hidden': 'true' },
        h('div', { className: 'oai-bubbles' }, [0, 1, 2, 3, 4, 5].map(index => h('i', { key: index }))),
        h('div', { className: 'oai-octo-wrap', dangerouslySetInnerHTML: { __html: OCTOPUS_SVG } })),
      h('header', null, h('h2', null, 'Omni'), h('span', { className: 'oai-class' }, 'Channel keeper')),
      h('p', null, 'Runs your Omni: every chat on every channel, answered by your team. A little Omni sits in each chat to help there.'),
      h('ul', { className: 'oai-stats' }, stats.map(stat => h(Stat, { key: stat.id, stat, onToggle: () => toggle(stat.id), disabled: !omni }))),
      h(Facts, { rows: [
        ['Controls', live?.configured ? `${live.origin}: ${channels.length} channels, ${chats.length} recent chats` : 'The Omni you link next'],
        ['Project', project ? `Its own: ${tilde(project)}` : 'Its own, in your team workspace'],
        ['Plugins', 'Omni channels · Omni canvases'],
        ['Helpers', 'A little Omni in each chat'],
      ] }),
      h('div', { className: 'oai-menu-label' }, 'In your menu'),
      menu,
      h('button', { type: 'button', role: 'switch', className: `oai-join${omni ? ' on' : ''}`, 'aria-checked': omni, onClick: () => setOmni(value => !value) }, omni ? 'On your team' : 'Add to your team')),
    h('article', { className: 'oai-fighter oai-genie oai-locked' },
      h('div', { className: 'oai-portrait oai-emerge', 'aria-hidden': 'true' },
        h('div', { className: 'oai-sparkles' }, [0, 1, 2, 3, 4].map(index => h('i', { key: index }))),
        h('div', { className: 'oai-genie-wrap', dangerouslySetInnerHTML: { __html: genieSvg(150, { uid: 'oaig' }) } })),
      h('header', null, h('h2', null, 'Genie'), h('span', { className: 'oai-class' }, 'Wish granter')),
      h('p', null, 'Give it a wish, get one delivery. It works in threads of itself, in its own project, and hands you the result.'),
      h('ul', { className: 'oai-stats' }, GENIE_STATS.map(stat => h(Stat, { key: stat.id, stat }))),
      h(Facts, { rows: [['Controls', 'Code, files and tasks in its project'], ['Project', 'Its own, per wish'], ['Plugins', 'Genie (not released for DSH yet)'], ['Helpers', 'One thread per wish']] }),
      h('div', { className: 'oai-menu-label' }, 'In your menu'),
      h('p', { className: 'oai-muted' }, 'Its threads, under Genie.'),
      h('span', { className: 'oai-join oai-soon-badge', 'aria-disabled': 'true' }, 'Coming soon'))),
  problem ? h('p', { className: 'oai-error', role: 'alert' }, problem) : null,
  h('div', { className: 'oai-actions' },
    h('button', { type: 'button', className: 'oai-primary oai-big', disabled: saving, onClick: go }, saving ? 'Bringing them in…' : omni ? 'Continue with Omni' : `Continue with just ${name}`)))
}
