import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chatsOf, isOmniBot } from '../src/client/omni-store.js'

test('only the Bot of kind omni carries the channel tree', () => {
  assert.equal(isOmniBot({ kind: 'omni' }), true)
  assert.equal(isOmniBot({ name: 'Omni' }), false)
  assert.equal(isOmniBot(undefined), false)
})

test('a channel shows its newest chats first, and counts the ones it leaves out', () => {
  const chats = Array.from({ length: 11 }, (_, n) => ({ id: `c${n}`, channelId: n % 4 === 0 ? 'slack' : 'wa', at: n }))
  const { chats: shown, more } = chatsOf({ chats }, 'wa', 5)
  assert.deepEqual(shown.map(chat => chat.id), ['c10', 'c9', 'c7', 'c6', 'c5'])
  assert.equal(more, 3)
  assert.deepEqual(chatsOf({ chats }, 'slack', 8), { chats: [chats[8], chats[4], chats[0]], more: 0 })
  assert.deepEqual(chatsOf({ chats }, 'none', 8), { chats: [], more: 0 })
})
