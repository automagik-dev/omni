// Adding a channel, without React: how long each takes, what its card's action says, the
// steps its guided page walks through, and the small rules the pages share. The pages are in
// channel-connect-live.js; this file has no imports, so the rules test without a shell.

// Per channel type (omni's ids): the time on its card, the action at its foot, and its steps.
// Labels are English; the pages pass them through t().
export const ADD = {
  'whatsapp-baileys': { time: '1 min', how: 'Scan a code', steps: ['Name it', 'Scan', 'Done'] },
  'whatsapp-business': { time: '3 min', how: 'Enter your Meta details', steps: ['Enter the details', 'Done'] },
  slack: { time: '1 min', how: 'Connect with Slack', steps: ['Choose how it joins', 'Approve in Slack', 'Done'] },
  telegram: { time: '2 min', how: 'Create a bot', steps: ['Create the bot', 'Paste its token', 'Say hi'] },
  discord: { time: '2 min', how: 'Add your bot', steps: ['Paste the bot token', 'Invite it to a server', 'Done'] },
  clickup: { time: '2 min', how: 'Paste an API token', steps: ['Paste the token', 'Set the workspace', 'Done'] },
}

// The order of the cards, and which the linked Omni offers: `supported` is what it has
// loaded (omni-channel-types), or null when it could not say, and then all are offered.
export const ORDER = ['whatsapp-baileys', 'whatsapp-business', 'slack', 'telegram', 'discord', 'clickup']
export const offered = supported => ORDER.filter(type => supported === null || supported === undefined || supported.includes(type))

// A Telegram bot token, as @BotFather sends it.
export const TELEGRAM_TOKEN = /^\d{6,12}:[A-Za-z0-9_-]{30,}$/
export const isTelegramToken = text => typeof text === 'string' && TELEGRAM_TOKEN.test(text.trim())

// The token the person just copied in Telegram, if that is what the clipboard holds. Only
// called from a focus or click handler: browsers allow reading the clipboard then, and a
// refusal (or no clipboard) answers null without a word.
export async function copiedTelegramToken(readText) {
  try {
    const text = await readText()
    return isTelegramToken(text) ? text.trim() : null
  } catch {
    return null
  }
}

// The bot's own chat, from what Omni says about the connected channel: a username, with or
// without its @, or nothing.
export function telegramChat(detail) {
  const name = typeof detail === 'string' ? detail.trim().replace(/^@/, '') : ''
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(name) ? `https://t.me/${name}` : null
}

// A label that names a step as done, now, or still to come, for the step list.
export const stepState = (index, at) => (index < at ? 'done' : index === at ? 'now' : undefined)
