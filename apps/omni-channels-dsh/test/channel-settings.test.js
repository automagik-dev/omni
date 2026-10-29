import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { z } from 'zod'
import { FIELDS, GROUPS, inputValue, settingsSchemas } from '../src/host/channel-settings.js'
import { bundleClient, byLabel, mount, nodes, plain, react, settle, text } from './client-stand-in.js'
import { omni } from './omni-client.js'

// Copied from the issue's manifest, intentionally independent of descriptors/schema generation.
const ISSUE_FIELDS = `agentReplyFilter agentSessionStrategy agentPrefixSenderName agentGateEnabled agentGateModel agentGatePrompt agentWaitForMedia agentSendMediaPath agentSendMediaPathTypes agentStalledTimeoutMs messageSupersedeMode enableAutoSplit messageFormatMode disableUsernamePrefix triggerEvents triggerReactions triggerMentionPatterns triggerMode agentChainToInstanceId chainMode sessionReset inboundMaxAgeMinutes replayEnabled inboundReplyContext messageDebounceMode messageDebounceMinMs messageDebounceGroupMs messageDebounceMaxMs messageDebounceRestartOnTyping messageDebounceMaxWaitMs messageSplitDelayMode messageSplitDelayFixedMs messageSplitDelayMinMs messageSplitDelayMaxMs reactionAck reactionAckEmoji ackTimeoutMs agentAckMessage readReceipts markOnlineOnConnect processAudio processImages processVideo processDocuments processMediaOnBlocked downloadMediaOnSync audioTranscription accessMode groupHistorySize historyIdentity syncFullHistory ttsVoiceId ttsModelId followUpConfig closeContactConfig outboundPacing outboundPacingOverride agentProviderId`.split(' ')
const META = 'metaPhoneNumberId metaWabaId metaAppId metaBusinessId metaApiVersion metaConnectionMethod metaConnectedAt metaDisplayPhoneNumber'.split(' ')
const ID = '11111111-2222-4333-8444-555555555555'
const AGENT = '66666666-7777-4888-8999-aaaaaaaaaaaa'
const ui = await bundleClient(["export { ChannelSettings } from './channel-settings.js'"], { team: { omni }, globals: { setTimeout, clearTimeout } })
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node) === label)
const change = (tree, label, value) => byLabel(tree, label).props.onChange({ target: { value } })
const initial = { agentId: AGENT, agentProviderId: null, processAudio: true, inboundMaxAgeMinutes: 10,
  triggerReactions: ['👍'], sessionReset: { dm: { mode: 'none' } }, metaPhoneNumberId: '12345678', metaWabaId: '23456789', metaAppId: '34567890' }
function world({ writable = true, answer } = {}) {
  const calls = []
  let record = { ...initial }
  const request = async (endpoint, payload) => {
    calls.push([endpoint, plain(payload)])
    if (answer) return answer(endpoint, payload)
    if (endpoint === 'omni-channel-settings') return { settings: record }
    if (endpoint === 'omni-channel-agents') return { items: [{ id: AGENT, name: 'Helper' }] }
    if (endpoint === 'omni-channel-settings-save') record = { ...record, ...payload.patch }
    return { ok: true }
  }
  const view = mount(() => react.createElement(ui.ChannelSettings, { key: ID, channel: { id: ID, type: 'whatsapp-business' }, writable, request, refresh: async () => {} }))
  return { calls, view, async draw() { view.draw(); await settle(); return view.draw() } }
}

test('exact issue manifest, all groups and Meta settings have reachable controls; provider alone is read-only', async () => {
  assert.equal(ISSUE_FIELDS.length, 58)
  assert.deepEqual(Object.keys(FIELDS).sort(), [...ISSUE_FIELDS, ...META, 'agentId'].sort())
  assert.equal(GROUPS.length, 12)
  const { draw, view } = world()
  const tree = await draw()
  for (const key of [...ISSUE_FIELDS.filter(key => key !== 'agentProviderId'), ...META, 'agentId']) assert.ok(byLabel(tree, key), key)
  assert.ok(text(tree).includes('agent Provider Id'))
  assert.equal(nodes(tree).filter(node => node.type === 'output').length, 1)
  assert.ok(text(tree).includes('Helper'))
  view.unmount()
})

test('save sends only edited false/0/arrays/structured/null values and re-reads the same id', async () => {
  const { calls, draw, view } = world()
  let tree = await draw()
  for (const [key, value] of [['processAudio', 'false'], ['inboundMaxAgeMinutes', '0'], ['triggerReactions', '[]'], ['sessionReset', '{"dm":{"mode":"daily","hour":0}}'], ['agentId', '']]) {
    change(tree, key, value)
    tree = view.draw()
  }
  button(tree, 'Save settings').props.onClick()
  await settle()
  tree = view.draw()
  assert.deepEqual(calls.find(([endpoint]) => endpoint === 'omni-channel-settings-save')[1], { id: ID, patch: {
    processAudio: false, inboundMaxAgeMinutes: 0, triggerReactions: [], sessionReset: { dm: { mode: 'daily', hour: 0 } }, agentId: null,
  } })
  assert.equal(calls.filter(([endpoint]) => endpoint === 'omni-channel-settings').length, 2)
  assert.ok(text(tree).includes('Settings saved'))
  assert.equal(byLabel(tree, 'processAudio').props.value, 'false')
  change(tree, 'agentId', AGENT)
  button(view.draw(), 'Save settings').props.onClick()
  await settle()
  assert.equal(calls.filter(([name]) => name === 'omni-channel-settings-save').at(-1)[1].patch.agentId, AGENT)
  view.unmount()
})

test('read-only settings remain readable but every change control is disabled and mutation buttons are absent', async () => {
  const { calls, draw, view } = world({ writable: false })
  const tree = await draw()
  assert.equal(byLabel(tree, 'processAudio').props.disabled, true)
  assert.equal(byLabel(tree, 'agentId').props.disabled, true)
  assert.equal(button(tree, 'Save settings'), undefined)
  assert.equal(button(tree, 'Repair and reconnect'), undefined)
  assert.equal(byLabel(tree, 'Access token'), undefined)
  assert.deepEqual(calls.map(([endpoint]) => endpoint).sort(), ['omni-channel-agents', 'omni-channel-settings'])
  view.unmount()
})

test('repair uses current Meta identifiers, write-only password and existing id; double submit is blocked', async () => {
  let release
  const { calls, draw, view } = world({ answer: async endpoint => {
    if (endpoint === 'omni-channel-settings') return { settings: initial }
    if (endpoint === 'omni-channel-agents') return { items: [] }
    return new Promise(resolve => { release = resolve })
  } })
  let tree = await draw()
  assert.equal(byLabel(tree, 'Access token').props.type, 'password')
  assert.equal(byLabel(tree, 'Access token').props.autoComplete, 'off')
  assert.equal(byLabel(tree, 'Access token').props.value, '')
  change(tree, 'metaPhoneNumberId', '98765432')
  change(view.draw(), 'Access token', 'fixture-reentered-token')
  tree = view.draw()
  const submit = button(tree, 'Repair and reconnect').props.onClick
  submit(); submit()
  assert.deepEqual(calls.filter(([name]) => name === 'omni-wab-repair'), [['omni-wab-repair', {
    id: ID, accessToken: 'fixture-reentered-token', phoneNumberId: '98765432', wabaId: '23456789', appId: '34567890',
  }]])
  assert.equal(byLabel(view.draw(), 'Access token').props.value, '')
  release({ ok: true }); await settle()
  assert.equal(byLabel(view.draw(), 'Access token').props.value, '')
  view.unmount()
  const source = readFileSync(new URL('../src/client/channel-settings.js', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /localStorage|sessionStorage|console\./)
})

test('load/save/list failures are visible and never clear the assigned id or claim success', async () => {
  for (const fail of ['omni-channel-settings', 'omni-channel-agents', 'omni-channel-settings-save']) {
    const { view, draw } = world({ answer: async endpoint => {
      if (endpoint === fail) throw new Error('refused fixture')
      return endpoint === 'omni-channel-settings' ? { settings: initial } : { items: [] }
    } })
    let tree = await draw()
    if (fail === 'omni-channel-settings-save') {
      change(tree, 'processAudio', 'false'); button(view.draw(), 'Save settings').props.onClick(); await settle(); tree = view.draw()
    }
    assert.ok(text(tree).includes(fail === 'omni-channel-agents' ? 'Could not load agents' : 'refused fixture'))
    assert.ok(!text(tree).includes('Settings saved'))
    if (fail !== 'omni-channel-settings') assert.equal(byLabel(tree, 'agentId').props.value, AGENT)
    view.unmount()
  }
})

test('late responses after navigation are ignored; caller keys the actual component by channel id', async () => {
  let resolve
  const old = world({ answer: endpoint => endpoint === 'omni-channel-settings' ? new Promise(done => { resolve = done }) : Promise.resolve({ items: [] }) })
  old.view.draw(); old.view.unmount()
  const current = world()
  const before = await current.draw()
  resolve({ settings: { processAudio: false } }); await settle()
  assert.equal(byLabel(before, 'processAudio').props.value, byLabel(current.view.draw(), 'processAudio').props.value)
  const integration = readFileSync(new URL('../src/client/channels.js', import.meta.url), 'utf8')
  assert.match(integration, /h\(ChannelSettings, \{ key: channel\.id, channel, writable: writable && !channel\.busy \}\)/)
  current.view.unmount()
})

test('repair rereads normalized Meta state even after partial failure; later save preserves only unrelated edits', async () => {
  for (const failed of [false, 'connect', 'reload', 'verify']) {
    let reads = 0
    const { calls, draw, view } = world({ answer: async endpoint => {
      if (endpoint === 'omni-channel-settings') {
        if (++reads > 1 && ['reload', 'verify'].includes(failed)) throw new Error('Reload unavailable')
        return { settings: { ...initial, metaPhoneNumberId: reads > 1 ? '99999999' : initial.metaPhoneNumberId } }
      }
      if (endpoint === 'omni-channel-agents') return { items: [] }
      if (endpoint === 'omni-wab-repair' && failed && failed !== 'verify') throw new Error('Credentials may have been saved')
      return { ok: true }
    } })
    let tree = await draw()
    change(tree, 'metaPhoneNumberId', '87654321'); change(view.draw(), 'processAudio', 'false')
    change(view.draw(), 'Access token', 'fixture-reentered-token')
    button(view.draw(), 'Repair and reconnect').props.onClick(); await settle(); tree = view.draw()
    assert.equal(byLabel(tree, 'metaPhoneNumberId').props.value, ['reload', 'verify'].includes(failed) ? initial.metaPhoneNumberId : '99999999')
    assert.equal(byLabel(tree, 'Access token').props.value, '')
    assert.equal(text(tree).includes('Settings saved'), !failed)
    if (failed) assert.ok(text(tree).includes('Credentials may have been saved. Reload this channel before retrying.'))
    if (failed === 'verify') assert.ok(text(tree).includes('Reload unavailable'))
    button(tree, 'Save settings').props.onClick(); await settle()
    assert.deepEqual(calls.find(([endpoint]) => endpoint === 'omni-channel-settings-save')[1].patch, { processAudio: false })
    view.unmount()
  }
})

test('input and host schemas preserve meaningful values and reject unknown/provider/token fields', () => {
  assert.equal(inputValue(FIELDS.processAudio, 'false'), false)
  assert.equal(inputValue(FIELDS.inboundMaxAgeMinutes, '0'), 0)
  assert.throws(() => inputValue(FIELDS.inboundMaxAgeMinutes, ''))
  assert.throws(() => inputValue(FIELDS.processAudio, ''))
  const { patch } = settingsSchemas(z)
  assert.deepEqual(patch.parse({ processAudio: false, sessionReset: null, triggerEvents: [] }), { processAudio: false, sessionReset: null, triggerEvents: [] })
  for (const key of ['agentProviderId', 'metaAccessToken', 'surprise']) assert.equal(patch.safeParse({ [key]: AGENT }).success, false)
})
