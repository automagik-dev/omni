import { t } from './core.js'

// Only codes chosen by this host select guidance. Diagnostic strings never become copy.
const KEY_PROBLEMS = Object.freeze({
  'bot/bad-key': 'Paste the whole API key.',
  'bot/bad-address': 'Give the address of the Omni, like omni.example.com',
  'bot/key-refused': 'Omni did not accept that key. Check the key and try again.',
})
export const keyProblem = error => typeof error?.code === 'string' && Object.hasOwn(KEY_PROBLEMS, error.code)
  ? t(KEY_PROBLEMS[error.code]) : t('Could not connect to Omni. Try again.')

const THREAD_REASONS = Object.freeze({
  not_linked: 'Not connected: this app is not linked to an Omni.',
  other_omni: 'Not connected: this app is linked to another Omni.',
  being_cut: 'Not connected: its previous key is still being cut.',
  waiting: 'Not connected: waiting for a key from the linked Omni.',
  no_key: 'Not connected: this thread has no key.',
  needs_newer_team: 'Adding a chat needs a newer Bot team.',
  omni_unreachable: 'Could not reach Omni. Try again in a moment.',
  chat_keys_unavailable: 'Omni cannot make chat keys; update it.',
  chat_key_limit: 'This app holds as many chat keys as Omni allows.',
})
export function threadReason(thread) {
  if (thread.reason) console.warn('Chat is not connected:', thread.reason)
  const code = thread.reasonCode
  return typeof code === 'string' && Object.hasOwn(THREAD_REASONS, code)
    ? t(THREAD_REASONS[code]) : t('Not connected. Try reconnecting this chat.')
}
const CHANNEL_PROBLEMS = Object.freeze({
  not_connected: 'Omni does not report this channel as connected.',
  token_revoked: 'The bot token was revoked in BotFather. Paste a new token to reconnect.',
})
export function channelProblem(channel) {
  if (channel.problem) console.warn('Channel needs attention:', channel.problem)
  const code = channel.problemCode
  return typeof code === 'string' && Object.hasOwn(CHANNEL_PROBLEMS, code)
    ? t(CHANNEL_PROBLEMS[code]) : t('Omni does not report this channel as connected.')
}
