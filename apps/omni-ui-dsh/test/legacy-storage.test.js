import assert from 'node:assert/strict'
import { test } from 'node:test'
import { STORAGE, legacyKeys, migrateStorage } from '../src/client/storage.js'

const memoryStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries))
  return {
    map,
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => { map.set(key, String(value)) },
    removeItem: (key) => { map.delete(key) },
  }
}

test('every key is under the omni-ui prefix', () => {
  for (const key of Object.values(STORAGE)) assert.match(key, /^omni-ui[:.]/)
})

// DS Bot may run beside Omni on the same DSH origin; its values are its own.
test('values of DS Bot and its earlier names are neither read, moved nor removed', () => {
  const others = {
    'ds-bot:unread': '{"a":true}',
    'ds-bot:prefs': '{"theme":"paper"}',
    'ds-bot.browser.v2': '{"a":{"tabs":[],"active":null}}',
    'dsh-bot:seen': '{"a":1}',
    'dsh-bot-team:prefs': 'team',
    'dsh-bot.browser.v1': '{"a":{"url":"https://example.com/"}}',
    'other:key': 'kept',
  }
  const storage = memoryStorage(others)
  migrateStorage(storage)
  assert.deepEqual(Object.fromEntries(storage.map), others)
  for (const key of Object.values(STORAGE)) assert.deepEqual(legacyKeys(key), [], key)
})

test('unusable storage is no error', () => {
  const broken = { getItem: () => { throw new Error('denied') }, setItem() {}, removeItem() {} }
  assert.doesNotThrow(() => migrateStorage(broken))
})

test('a saved grok theme becomes the mono theme', () => {
  const storage = memoryStorage({ 'omni-ui:prefs': '{"theme":"grok","accent":"#123456"}' })
  migrateStorage(storage)
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE.prefs)), { theme: 'mono', accent: '#123456' })
  migrateStorage(memoryStorage({ 'omni-ui:prefs': 'not json' }))
})
