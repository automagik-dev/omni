import { createElement as h } from 'react'
import { registerConnectStep } from './connect-step.js'
import { registerSettings } from './omni-settings.js'
import { WizardHost } from './wizard.js'
import { CHANNELS_CSS, ChannelsFooter, ChannelsPage, ChatPage } from './channels.js'
import { CHANNELS_PANEL, CHAT_PANEL } from './omni-store.js'
import { BOARD_KIND, BOARD_TAB_ID, BoardTab, EventsBadge, SUBSCRIPTIONS_CSS, SavedAutomationCard, SubscriptionsButton, boardTabDefinition } from './subscriptions.js'
import { AUTOMATIONS_CSS, AUTOMATIONS_PANEL, AutomationsPage } from './automations-page.js'
import { Badge, KeyValue, LiveChannel, LiveChat, LiveQr, OMNI_LIVE_CSS, OmniCallCard, OmniToolCard, Table, parseCall } from './omni-live.js'
import { OMNI_PEEK_CSS } from './omni-peek.js'
import { OMNI_CONNECT_CSS, connectFromApp } from './omni-connect.js'
import { addStrings, badges, botChildren, botSettings, headerButtons, nav, onShell, t, toolCards, icons } from './core.js'
import { OMNI_TREE_CSS, OmniTree } from './omni-tree.js'
import { ASKING_TOOLS, ConsentDock, PERMISSIONS_CSS, PermissionsCard, withConsent } from './permissions.js'
import { STRINGS } from './strings.js'
const { ClockIcon } = icons

// Omni's channels on the Bot surface: the Channels page and chats, the automations and
// their board, the cards of Omni's calls, and the Connect Omni onboarding step. Everything
// goes through the team's registries (@automagik/bots-dsh/client), so the Bot surface knows
// none of it.

export const inject = ['slots']

// The live views of omni the canvas plugin draws with (@automagik/omni-canvas-dsh), which
// requires this bundle the way this one requires the team's.
export const channels = Object.freeze({ Badge, KeyValue, LiveChannel, LiveChat, LiveQr, Table })

// Omni's automations board is a tab of DSH's right sidebar, which may load after this plugin.
// It never opens by itself: the header's Automations button is the way in, and the Session's
// own sidebar layout (open, closed, other tabs) is the user's.
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
  const fiber = ctx.inject(['sidebarRight', 'sidebarRightTabs'], (scope) => {
    scope.effect(() => scope.sidebarRightTabs.register(boardTabDefinition()), 'ds-bot: subscriptions tab type')
    scope.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: BOARD_TAB_ID, inject: face }, BoardTab)), 'ds-bot: subscriptions tab')
    scope.effect(() => {
      boardRight = scope.sidebarRight
      return () => { boardRight = null }
    }, 'ds-bot: the automations board for the header button')
  })
  return () => fiber.dispose()
}

// What the activity row says while one of Omni's tools runs.
const PHRASES = {
  omni_channels: () => ({ label: t('Checking your channels'), state: 'searching' }),
  omni_chats: () => ({ label: t('Reading your chats'), state: 'searching' }),
  omni_messages: () => ({ label: t('Reading your chats'), state: 'searching' }),
  find_chats: () => ({ label: t('Reading your chats'), state: 'searching' }),
  save_automation: () => ({ label: t('Saving an automation'), state: 'working' }),
  omni_endpoints: () => ({ label: t('Looking up omni'), state: 'searching' }),
  omni_call: arg => (arg('method') === 'GET' || arg('method') === undefined ? { label: t('Reading omni'), state: 'searching' } : { label: t('Changing omni'), state: 'working' }),
  omni_connect: () => ({ label: t('Connecting a channel'), state: 'working' }),
  omni_send: () => ({ label: t('Sending a message'), state: 'working' }),
  omni_react: () => ({ label: t('Reacting'), state: 'working' }),
  omni_media: () => ({ label: t('Opening a file'), state: 'working' }),
  omni_delete: () => ({ label: t('Deleting a message'), state: 'working' }),
}
const callCard = ({ arg, content, done }) => h(OmniCallCard, { ...parseCall(arg, content), done })
const toolCard = ({ tool, arg, content, done }) => h(OmniToolCard, { tool, arg, content, done })

export function apply(ctx) {
  ctx.effect(() => addStrings(STRINGS), 'ds-bot: channels copy')
  // Onboarding: Connect Omni, between omni-ai's welcome and Connect AI when it is installed.
  registerConnectStep(ctx)
  // The Omni page in DSH's settings, which opens the same wizard on demand.
  registerSettings(ctx)
  // The Omni desktop app hands over an omni://connect link it asked about (src/main.js there).
  ctx.effect(() => {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return undefined
    const onConnect = event => void connectFromApp(event.detail?.url, event.detail?.grant)
    window.addEventListener('omni-desktop:connect', onConnect)
    return () => window.removeEventListener('omni-desktop:connect', onConnect)
  }, 'ds-bot: omni:// links')
  // A call that needs the user's permission draws the card that asks (permissions.js).
  ctx.effect(() => toolCards.register('omni_call', withConsent(callCard), { phrase: PHRASES.omni_call, asks: true }), 'ds-bot: omni call card')
  for (const name of ['omni_channels', 'omni_chats', 'omni_messages', 'omni_connect', 'omni_send', 'omni_react', 'omni_media', 'omni_delete']) {
    const asks = ASKING_TOOLS.includes(name)
    ctx.effect(() => toolCards.register(name, asks ? withConsent(toolCard) : toolCard, { phrase: PHRASES[name], asks }), `ds-bot: ${name} card`)
  }
  // What each Bot may do on Omni, on its settings page. A team client older than this plugin has no such list.
  if (botSettings) ctx.effect(() => botSettings.register({ id: 'omni-permissions', order: 0, Component: PermissionsCard }), 'ds-bot: Omni permissions settings')
  for (const name of ['find_chats', 'omni_endpoints']) ctx.effect(() => toolCards.register(name, null, { phrase: PHRASES[name] }), `ds-bot: ${name} phrase`)
  // Saving an automation confirms in the chat, with the steering warning the board carries.
  ctx.effect(() => toolCards.register('save_automation', props => h(SavedAutomationCard, props), { phrase: PHRASES.save_automation }), 'ds-bot: save_automation card')
  // Omni's row counts the automation runs waiting for you; its header opens their board.
  ctx.effect(() => badges.register({ id: 'omni-events', Component: ({ bot, roster, useWork }) => (bot.id === roster.eventsBotId ? h(EventsBadge, { roster, useWork }) : null) }), 'ds-bot: automations badge')
  // The Omni Bot's channels hang under its sidebar row, each with its chats. A team client
  // older than this plugin has no such place.
  if (botChildren) ctx.effect(() => botChildren.register({ id: 'omni-channels', Component: OmniTree }), 'ds-bot: Omni channels in the sidebar')
  ctx.effect(() => headerButtons.register({
    id: 'omni-board',
    Component: ({ bot, roster, actions, useWork }) => (bot.id === roster.eventsBotId ? h(SubscriptionsButton, { roster, useWork, onToggle: () => toggleBoard(actions.reportError) }) : null),
  }), 'ds-bot: automations button')
  ctx.effect(() => nav.register({ id: 'automations', label: () => t('Automations'), icon: ClockIcon, run: actions => actions.selectPanel(AUTOMATIONS_PANEL) }), 'ds-bot: automations nav')
  // Omni chats and the Channels page are main panels, like the shell's Plugins page: they
  // replace the conversation in the center, and opening a Bot brings it back.
  ctx.effect(() => onShell(({ face, shadow, installCompiledStyles }) => [
    () => installCompiledStyles(CHANNELS_CSS + OMNI_TREE_CSS + SUBSCRIPTIONS_CSS + AUTOMATIONS_CSS + OMNI_LIVE_CSS + OMNI_PEEK_CSS + OMNI_CONNECT_CSS + PERMISSIONS_CSS, 'channels'),
    () => shadow('conversation.input.dock', { id: 'omni-consent', order: -80, inject: face }, ConsentDock),
    () => shadow('sidebar.footer.action', { id: 'bot-connect', order: -100, inject: face }, ChannelsFooter),
    // The Connect wizard opened on demand (settings, Channels, or once after install) mounts here.
    () => shadow('sidebar.footer.action', { id: 'omni-connect-wizard', order: 1000, inject: face }, WizardHost),
    () => shadow('main', { key: CHANNELS_PANEL, inject: face }, ChannelsPage),
    () => shadow('main', { key: CHAT_PANEL, inject: face }, ChatPage),
    () => shadow('main', { key: AUTOMATIONS_PANEL, inject: face }, AutomationsPage),
    () => installBoard(ctx, face),
  ]), 'ds-bot: channels on the Bot surface')
}
