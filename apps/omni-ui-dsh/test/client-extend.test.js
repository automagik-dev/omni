import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'

// The registries other Omni plugins add to the Bot surface through (src/client/extend.js),
// and the copy they bring (i18n.js addStrings), bundled with a stand-in React.
const { outputFiles } = await build({
  stdin: {
    contents: [
      "export { badges, mountShellInstallers, nav, onShell, toolCards } from './src/client/extend.js'",
      "export { addStrings, installLocale, t } from './src/client/i18n.js'",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, format: 'cjs', platform: 'browser', write: false, logLevel: 'silent', external: ['react'],
})
const module = { exports: {} }
runInNewContext(outputFiles[0].text, {
  module, exports: module.exports, console,
  require: (name) => {
    if (name === 'react') return { useSyncExternalStore: (_subscribe, snapshot) => snapshot() }
    throw new Error(`Unexpected platform module ${name}`)
  },
})
const { addStrings, badges, installLocale, mountShellInstallers, nav, onShell, t, toolCards } = module.exports

test('a tool card is drawn by the last registration for its name, until its disposer runs', () => {
  const first = () => 'first'
  const second = () => 'second'
  const offFirst = toolCards.register(['omni_call', 'omni_chats'], first)
  const offSecond = toolCards.register('omni_call', second, { phrase: () => ({ label: 'Reading omni' }) })
  assert.equal(toolCards.renderer('omni_call'), second)
  assert.equal(toolCards.renderer('omni_chats'), first)
  assert.equal(toolCards.phrase('omni_call')().label, 'Reading omni')
  assert.equal(toolCards.phrase('omni_chats'), undefined)
  offSecond()
  assert.equal(toolCards.renderer('omni_call'), first)
  offFirst()
  assert.equal(toolCards.renderer('omni_call'), undefined)
  // A phrase without a card leaves the call undrawn.
  const off = toolCards.register('find_chats', null, { phrase: () => ({ label: 'Reading your chats' }) })
  assert.equal(toolCards.renderer('find_chats'), undefined)
  assert.equal(toolCards.phrase('find_chats')().label, 'Reading your chats')
  off()
})

test('nav rows and badges keep their order and leave with their disposer', () => {
  const offLate = nav.register({ id: 'late', order: 10 })
  const offEarly = nav.register({ id: 'early', order: -10 })
  assert.deepEqual([...nav.entries()].map(entry => entry.id), ['early', 'late'])
  let changed = 0
  const unsubscribe = badges.source.subscribe(() => { changed += 1 })
  const offBadge = badges.register({ id: 'events' })
  offBadge()
  unsubscribe()
  assert.equal(changed, 2)
  offLate()
  offEarly()
  assert.equal(nav.entries().length, 0)
})

test('a shell installer runs while the shell is up, also when it registers after, and leaves with it', () => {
  const log = []
  const installer = (tools) => {
    log.push(`install ${tools.name}`)
    return [() => { log.push('step'); return () => log.push('undo step') }]
  }
  const offEarly = onShell(installer)
  assert.deepEqual(log, [])
  const unmount = mountShellInstallers({ name: 'shell' })
  assert.deepEqual(log, ['install shell', 'step'])
  const offLate = onShell(() => [() => { log.push('late step'); return () => log.push('undo late') }])
  assert.deepEqual(log.slice(2), ['late step'])
  offEarly()
  assert.deepEqual(log.slice(3), ['undo step'])
  unmount()
  assert.deepEqual(log.slice(4), ['undo late'])
  offLate()
  assert.equal(log.length, 5)
  // A step that throws keeps the others and the shell.
  const offBroken = onShell(() => [() => { throw new Error('boom') }])
  const quiet = console.warn
  console.warn = () => {}
  try {
    const again = mountShellInstallers({ name: 'shell' })
    again()
  } finally {
    console.warn = quiet
    offBroken()
  }
})

test('added Chinese copy joins the one namespace and leaves with its disposer, re-registered each time', () => {
  const registered = []
  const dicts = new Map()
  const locale = {
    register(ns, lang, dict) {
      if (dicts.has(`${ns}:${lang}`)) throw new Error('already has locale')
      dicts.set(`${ns}:${lang}`, dict)
      registered.push(Object.keys(dict).length)
      return () => dicts.delete(`${ns}:${lang}`)
    },
    bind: ns => key => dicts.get(`${ns}:zh`)?.[key] ?? key,
    getLocale: () => ({ active: 'zh' }),
  }
  const offLocale = installLocale(locale)
  try {
    const before = registered.at(-1)
    const off = addStrings({ 'A plugin string': '插件的字符串', Model: 'not this' })
    assert.equal(t('A plugin string'), '插件的字符串')
    // A key the team already translates keeps its text.
    assert.equal(t('Model'), '模型')
    assert.equal(registered.at(-1), before + 1)
    off()
    assert.equal(t('A plugin string'), 'A plugin string')
    assert.equal(registered.at(-1), before)
  } finally {
    offLocale()
  }
  assert.equal(dicts.size, 0)
})
