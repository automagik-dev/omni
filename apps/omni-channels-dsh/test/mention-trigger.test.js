import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matches, STREAMS } from '../src/host/omni-events.js'

test('mention subscriptions consume messages and match only inbound mentions of the instance', () => {
  const sub = { on: true, sources: [{ kind: 'chat', id: 'chat-1' }], trigger: { kind: 'mention' } }
  const row = { eventType: 'message.received', direction: 'inbound', chatUuid: 'chat-1', rawPayload: { isMentioningInstance: true } }
  assert.ok(STREAMS.some(stream => stream.eventType === row.eventType && stream.kinds.includes(sub.trigger.kind)))
  assert.equal(matches(sub, row), true)
  for (const rawPayload of [undefined, {}, { isMentioningInstance: false }, { isMentioningInstance: 'true' }]) {
    assert.equal(matches(sub, { ...row, rawPayload, mentions: [{ id: 'someone-else' }] }), false)
  }
  assert.equal(matches(sub, { ...row, direction: 'outbound' }), false)
  assert.equal(matches(sub, { ...row, chatUuid: 'other-chat' }), false)
  assert.equal(matches({ ...sub, on: false }, row), false)
})
