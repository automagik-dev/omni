import { createElement as h } from 'react'
import { ClockIcon } from './icons.js'
import { t } from './i18n.js'
import { badges, headerButtons, nav, onShell, toolCards } from './extend.js'
import { registerConnectStep } from './connect-step.js'
import { CHANNELS_CSS, ChannelsFooter, ChannelsPage, ChatPage } from './channels.js'
import { CHANNELS_PANEL, CHAT_PANEL } from './omni-store.js'
import { BOARD_KIND, BOARD_TAB_ID, BoardTab, EventsBadge, SUBSCRIPTIONS_CSS, SubscriptionsButton, boardTabDefinition, isEventsBot } from './subscriptions.js'
import { AUTOMATIONS_CSS, AUTOMATIONS_PANEL, AutomationsPage } from './automations-page.js'
import { OMNI_LIVE_CSS, OmniCallCard, OmniToolCard, parseCall } from './omni-live.js'
import { OMNI_PEEK_CSS } from './omni-peek.js'
import { OMNI_CONNECT_CSS } from './omni-connect.js'

// Omni's channels on the Bot surface: the Channels page and chats, the automations and
// their board, the cards of Omni's calls, and the Connect Omni onboarding step. Everything
// goes through the team's registries (extend.js), so the Bot surface knows none of it.

// Omni's automations board is a tab of DSH's right sidebar, which may load after this plugin.
// The first time Omni's chat is on screen in a browser, its board opens; after that the
// Session's own sidebar layout (open, closed, other tabs) is the user's.
const BOARD_OPENED = 'omni.board.opened'
let boardRight = null
function toggleBoard(reportError) {
  const right = boardRight
  if (!right) return
  try {
    if (right.isExpanded() && right.active()?.kind === BOARD_KIND) right.toggleExpanded()
    else right.openTab(BOARD_KIND)
  } catch (error) {
    reportError?.(error, 'board')
  }
}

function installBoard(ctx, face) {
  const roster = face().hooks.roster
  const fiber = ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
    scope.effect(() => scope.sidebarRightTabs.register(boardTabDefinition()), 'ds-bot: subscriptions tab type')
    scope.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: BOARD_TAB_ID, inject: face }, BoardTab)), 'ds-bot: subscriptions tab')
    scope.effect(() => {
      const right = scope.sidebarRight
      boardRight = right
      let opened
      try { opened = new Set(JSON.parse(localStorage.getItem(BOARD_OPENED) ?? '[]')) } catch { opened = new Set() }
      const check = () => {
        const id = right.mounted.getSnapshot()
        if (!id || opened.has(id) || !isEventsBot(roster.getSnapshot(), id)) return
        opened.add(id)
        try { localStorage.setItem(BOARD_OPENED, JSON.stringify([...opened])) } catch { /* storage unavailable */ }
        queueMicrotask(() => { try { right.openTab(BOARD_KIND) } catch (error) { console.warn('[ds-bot] board', error) } })
      }
      const offs = [right.mounted.subscribe(check), roster.subscribe(check)]
      check()
      return () => { boardRight = null; for (const off of offs) off() }
    }, 'ds-bot: open the automations board')
  })
  return () => fiber.dispose()
}

// What the activity row says while one of Omni's tools runs.
const PHRASES = {
  omni_channels: () => ({ label: t('Checking your channels'), state: 'searching' }),
  omni_chats: () => ({ label: t('Reading your chats'), state: 'searching' }),
  omni_messages: () => ({ label: t('Reading your chats'), state: 'searching' }),
  find_chats: () => ({ label: t('Reading your chats'), state: 'searching' }),
  omni_endpoints: () => ({ label: t('Looking up omni'), state: 'searching' }),
  omni_call: arg => (arg('method') === 'GET' || arg('method') === undefined ? { label: t('Reading omni'), state: 'searching' } : { label: t('Changing omni'), state: 'working' }),
  omni_connect: () => ({ label: t('Connecting a channel'), state: 'working' }),
}
const callCard = ({ arg, content, done }) => h(OmniCallCard, { ...parseCall(arg, content), done })
const toolCard = ({ tool, arg, content, done }) => h(OmniToolCard, { tool, arg, content, done })

export function installChannels(ctx) {
  // Onboarding: Connect Omni, between omni-ai's welcome and Connect AI when it is installed.
  registerConnectStep(ctx)
  ctx.effect(() => toolCards.register('omni_call', callCard, { phrase: PHRASES.omni_call }), 'ds-bot: omni call card')
  for (const name of ['omni_channels', 'omni_chats', 'omni_messages', 'omni_connect']) {
    ctx.effect(() => toolCards.register(name, toolCard, { phrase: PHRASES[name] }), `ds-bot: ${name} card`)
  }
  for (const name of ['find_chats', 'omni_endpoints']) ctx.effect(() => toolCards.register(name, null, { phrase: PHRASES[name] }), `ds-bot: ${name} phrase`)
  // Omni's row counts the automation runs waiting for you; its header opens their board.
  ctx.effect(() => badges.register({ id: 'omni-events', Component: ({ bot, roster, useWork }) => (bot.id === roster.eventsBotId ? h(EventsBadge, { roster, useWork }) : null) }), 'ds-bot: automations badge')
  ctx.effect(() => headerButtons.register({
    id: 'omni-board',
    Component: ({ bot, roster, actions, useWork }) => (bot.id === roster.eventsBotId ? h(SubscriptionsButton, { roster, useWork, onToggle: () => toggleBoard(actions.reportError) }) : null),
  }), 'ds-bot: automations button')
  ctx.effect(() => nav.register({ id: 'automations', label: () => t('Automations'), icon: ClockIcon, run: actions => actions.selectPanel(AUTOMATIONS_PANEL) }), 'ds-bot: automations nav')
  // Omni chats and the Channels page are main panels, like the shell's Plugins page: they
  // replace the conversation in the center, and opening a Bot brings it back.
  ctx.effect(() => onShell(({ face, shadow, installCompiledStyles }) => [
    () => installCompiledStyles(CHANNELS_CSS + SUBSCRIPTIONS_CSS + AUTOMATIONS_CSS + OMNI_LIVE_CSS + OMNI_PEEK_CSS + OMNI_CONNECT_CSS, 'channels'),
    () => shadow('sidebar.footer.action', { id: 'bot-connect', order: -100, inject: face }, ChannelsFooter),
    () => shadow('main', { key: CHANNELS_PANEL, inject: face }, ChannelsPage),
    () => shadow('main', { key: CHAT_PANEL, inject: face }, ChatPage),
    () => shadow('main', { key: AUTOMATIONS_PANEL, inject: face }, AutomationsPage),
    () => installBoard(ctx, face),
  ]), 'ds-bot: channels on the Bot surface')
}
