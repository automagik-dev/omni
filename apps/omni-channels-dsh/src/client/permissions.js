// What a Bot may do on Omni, on screen (host: src/host/grants.js): the card a Bot's call puts
// in front of the user (Once · Always · No, or Send · Cancel for what asks every time), drawn
// at the call or, when the call is not drawn, above the composer; and the Bot's permissions
// on its settings page, one line each, with "ask each time" and Revoke.
import { createElement as h, useState } from 'react'
import { BotMark, call, t } from './core.js'

const NONE = {}
// The calls a card can come from.
export const ASKING_TOOLS = ['omni_messages', 'omni_send', 'omni_react', 'omni_media', 'omni_delete', 'omni_call']

const KIND_OF = { chat: 'chat', group: 'group', self: 'your own chat', channel: 'channel' }
const kindText = resource => t(KIND_OF[resource?.type] ?? 'chat')

// The card's question: who wants to do what, where.
function askTitle(bot, entry) {
  const where = entry.resource?.name ?? t('a chat')
  if (entry.action === 'read') return t('{bot} wants to read {where}', { bot: bot.name, where })
  if (entry.action === 'media') return t('{bot} wants to open a file in {where}', { bot: bot.name, where })
  if (entry.action === 'send') return t('{bot} wants to send to {where}', { bot: bot.name, where })
  if (entry.action === 'react') return t('{bot} wants to react in {where}', { bot: bot.name, where })
  if (entry.action === 'delete') return t('{bot} wants to delete a message in {where}', { bot: bot.name, where })
  if (entry.action === 'disconnect') return t('{bot} wants to disconnect a channel', { bot: bot.name })
  return t('{bot} wants to change Omni', { bot: bot.name })
}

// Its reach, in one sentence.
function reachText(entry) {
  const kind = kindText(entry.resource)
  if (entry.kind === 'confirm') {
    if (entry.action === 'send') return entry.resource?.type === 'call' ? t('Sends as you. Asks every time.') : t('Sends as you to a person. Asks every time.')
    if (entry.action === 'delete') return t('Deletes for everyone. Asks every time.')
    if (entry.action === 'disconnect') return t('Disconnects the channel. Asks every time.')
    return t('Asks every time.')
  }
  if (entry.action === 'read') return t('Read the messages of this {kind}.', { kind })
  if (entry.action === 'media') return t('Open photos, audio and files in this {kind}.', { kind })
  if (entry.action === 'send') return t('Send messages in this {kind}, as you.', { kind })
  if (entry.action === 'react') return t('React to messages in this {kind}.', { kind })
  return ''
}

const CONFIRM_LABEL = { send: 'Send', delete: 'Delete', disconnect: 'Disconnect', react: 'React' }

function Preview({ entry }) {
  const preview = entry.preview ?? NONE
  const lines = []
  if (entry.resource?.type === 'call') lines.push(h('code', { key: 'op', className: 'om-perm-op' }, `${preview.method ?? ''} ${preview.path ?? ''}${preview.query ? ` ?${preview.query}` : ''}`.trim()))
  if (preview.channel) lines.push(h('div', { key: 'channel', className: 'om-perm-to' }, t('From {channel}', { channel: preview.channel })))
  if (preview.to) lines.push(h('div', { key: 'to', className: 'om-perm-to' }, t('To {to}', { to: preview.to })))
  if (preview.emoji) lines.push(h('div', { key: 'emoji', className: 'om-perm-emoji' }, preview.emoji))
  if (preview.text) lines.push(h('blockquote', { key: 'text', className: 'om-perm-text' }, preview.text))
  // The whole call, so nothing runs that the card did not show.
  if (preview.body) lines.push(h('pre', { key: 'body', className: 'om-perm-body' }, preview.body))
  return lines.length === 0 ? null : h('div', { className: 'om-perm-preview' }, lines)
}

export function ConsentCard({ bot, entry }) {
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const answer = (choice) => {
    if (busy) return
    setBusy(choice)
    setError('')
    Promise.resolve(call('omni-consent-answer', { id: entry.id, answer: choice }))
      .catch(failure => setError(failure?.message ?? String(failure)))
      .finally(() => setBusy(''))
  }
  const running = entry.status === 'running'
  const confirm = entry.kind === 'confirm'
  const button = (choice, label, primary = false) => h('button', {
    type: 'button', className: primary ? 'bt-q-submit' : 'bt-q-btn', disabled: Boolean(busy) || running, onClick: () => answer(choice),
  }, busy === choice ? '…' : label)
  return h('div', { className: 'bt-q om-perm', role: 'group', 'aria-label': askTitle(bot, entry), 'data-kind': entry.kind },
    h('div', { className: 'bt-q-head' },
      h('span', { className: 'om-perm-who' }, h(BotMark, { bot, size: 28 })),
      h('div', { className: 'bt-q-text' },
        h('p', { className: 'bt-q-title' }, askTitle(bot, entry)),
        h('div', { className: 'bt-q-detail' }, reachText(entry)))),
    h(Preview, { entry }),
    error ? h('div', { className: 'om-perm-error', role: 'alert' }, error) : null,
    h('div', { className: 'bt-q-foot' },
      running ? h('span', { className: 'om-perm-running' }, t('Running…')) : null,
      confirm
        ? [h('span', { key: 'deny' }, button('deny', t('Cancel'))), h('span', { key: 'once' }, button('once', t(CONFIRM_LABEL[entry.action] ?? 'Allow'), true))]
        : [
            h('span', { key: 'deny' }, button('deny', t('No'))),
            h('span', { key: 'once' }, button('once', t('Once'))),
            entry.resource?.channelId && entry.resource.channelName
              ? h('span', { key: 'channel' }, button('channel', t('Always, all of {channel}', { channel: entry.resource.channelName })))
              : null,
            h('span', { key: 'always' }, button('always', t('Always'), true)),
          ]))
}

const SETTLED = {
  once: 'Allowed once',
  always: 'Allowed from now on',
  channel: 'Allowed on the whole channel',
  interrupted: 'Interrupted by a restart',
  confirmed: 'Confirmed',
  denied: 'Not allowed',
  replaced: 'Asked again',
}

function Settled({ bot, entry }) {
  return h('div', { className: 'bt-event om-perm-done', 'data-status': entry.status },
    h(BotMark, { bot, size: 16 }), ` ${askTitle(bot, entry)} · ${t(SETTLED[entry.status] ?? entry.status)}`)
}

const entryAt = (roster, bot, sessionId, callId) => (roster.omniConsents?.[bot.id] ?? []).find(item => item.callId === callId && item.sessionId === sessionId)

/** A card render for the asking tools: the consent card at its call, else the tool's own card. */
export function withConsent(render) {
  return (props) => {
    const bot = props.roster?.byId?.[props.sessionId]
    const callId = props.call?.callId
    const entry = bot && callId ? entryAt(props.roster, bot, props.sessionId, callId) : undefined
    if (entry === undefined) {
      // Asked on a card drawn elsewhere: the Bot's own chat carries it.
      if (props.done && /^(consent|confirmation)_required:/.test(props.content ?? '')) return h('div', { className: 'bt-event' }, t('Asked you for permission in its chat'))
      return render ? render(props) : null
    }
    return h('div', { className: 'bt-q-inline' }, entry.status === 'pending' || entry.status === 'running' ? h(ConsentCard, { bot, entry }) : h(Settled, { bot, entry }))
  }
}

// Cards whose call the transcript does not draw (a task run, a group, an earlier part of the
// chat) wait above the composer of the Bot's own chat.
export function ConsentDock({ sessionId, useRoster, useCards }) {
  const roster = useRoster(value => value)
  const shown = useCards?.(state => state[sessionId]) ?? NONE
  const bot = roster.byId?.[sessionId]
  if (!bot || (bot.sessionId ?? bot.id) !== sessionId) return null
  const drawn = entry => entry.callId && entry.sessionId === sessionId && shown[entry.callId] > 0
  const waiting = (roster.omniConsents?.[bot.id] ?? []).filter(entry => (entry.status === 'pending' || entry.status === 'running') && !drawn(entry))
  if (waiting.length === 0) return null
  return h('div', { className: 'bt-q-dock om-perm-dock' }, waiting.map(entry => h(ConsentCard, { key: entry.id, bot, entry })))
}

const ACTION_TEXT = { read: 'read', media: 'files', send: 'send', react: 'react', delete: 'delete' }

// On a Bot's settings page: what it may do on Omni.
export function PermissionsCard({ bot, roster, run, Card, SwitchRow }) {
  if (!roster.omniGrants) return null
  // An Omni Bot or a Main Bot operates all of Omni (host/grants.js operatesOmni).
  const main = bot.kind === 'omni' || (roster.mainBotIds ?? []).includes(bot.id)
  const grants = (roster.omniGrants ?? []).filter(grant => grant.botId === bot.id)
  const now = Date.now()
  if (main) {
    return h(Card, { title: t('On Omni') },
      h('div', { className: 'bt-set-row bt-bs-row' }, h('span', { className: 'bt-set-copy' },
        h('span', { className: 'bt-bs-label' }, t('All of Omni')),
        h('span', { className: 'bt-set-hint' }, t('Omni and Main Bots operate Omni. Messaging a person, deleting and disconnecting still ask you first.')))))
  }
  return h(Card, { title: t('On Omni') },
    grants.length === 0
      ? h('div', { className: 'bt-set-row bt-bs-row' }, h('span', { className: 'bt-set-copy' },
          h('span', { className: 'bt-bs-label' }, t('Nothing yet')),
          h('span', { className: 'bt-set-hint' }, t('When {bot} needs a chat, it asks you there, on a card.', { bot: bot.name }))))
      : grants.map(grant => h('div', { key: grant.id, className: 'om-grant' },
          h(SwitchRow, {
            label: `${grant.resource?.name ?? t('a chat')} · ${grant.actions.map(action => t(ACTION_TEXT[action] ?? action)).join(', ')}`,
            hint: [kindText(grant.resource), typeof grant.expiresAt === 'number' && grant.expiresAt <= now ? t('expired') : '', t('Ask each time')].filter(Boolean).join(' · '),
            on: grant.approval === 'confirm',
            onChange: on => run(call('omni-grant-approval', { id: grant.id, approval: on ? 'confirm' : 'auto' })),
          }),
          h('button', { type: 'button', className: 'bt-soft bt-soft-sm om-grant-revoke', onClick: () => run(call('omni-grant-revoke', { id: grant.id })) }, t('Revoke')))))
}

export const PERMISSIONS_CSS = `
.om-perm-who{flex:none;display:grid;place-items:center}
.om-perm-preview{margin:8px 0 2px;display:flex;flex-direction:column;gap:6px}
.om-perm-text{margin:0;padding:8px 10px;border-left:3px solid var(--accent,#22d3ee);border-radius:6px;background:rgba(127,127,127,.08);white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto}
.om-perm-body{margin:0;padding:8px 10px;border-radius:6px;background:rgba(127,127,127,.08);font:11.5px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto}
.om-perm-to,.om-perm-op{font-size:12px;opacity:.8;overflow-wrap:anywhere}
.om-perm-emoji{font-size:22px;line-height:1}
.om-perm-error{color:#e5484d;font-size:12px;margin-top:6px}
.om-perm-running{font-size:12px;opacity:.7;margin-right:auto}
.om-perm-done{display:flex;align-items:center;gap:4px}
.om-grant{display:flex;align-items:center;gap:8px}
.om-grant>:first-child{flex:1;min-width:0}
.om-grant-revoke{flex:none;margin-right:12px}
`
