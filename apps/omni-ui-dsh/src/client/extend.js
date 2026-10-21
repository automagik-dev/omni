// What other Omni plugins add to the Bot surface. The Omni channels and canvas plugins
// require this package's client bundle (`dsh.client.external`), so they share its one
// module instance: one interface dictionary, one roster, one set of these registries.
// Every `register` returns its disposer; a plugin that stops takes what it added along.
import { useSyncExternalStore } from 'react'
import { createSource } from './sources.js'

// A registry is a source over its entries, so the outlets that draw them re-render when
// a plugin loads after the surface is up.
function registry() {
  const source = createSource([])
  return {
    source,
    entries: () => source.getSnapshot(),
    register(entry) {
      source.set(list => [...list, entry].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
      return () => source.set(list => list.filter(item => item !== entry))
    },
  }
}

// The entries of a registry, for an outlet that re-renders when they change.
export const useEntries = list => useSyncExternalStore(list.source.subscribe, list.source.getSnapshot, list.source.getSnapshot)

// Tool cards: how the transcript draws one tool's call. `render(props)` gets the call's
// `{ call, tool, arg, argValue, done, content, sessionId, roster, actions }` and returns
// an element, or null to draw nothing; `render` null leaves the call undrawn. `phrase(arg)`
// is what the activity row says while it runs, `{ label, state }`. The last registration
// for a name wins.
const cards = registry()
const cardOf = name => cards.entries().findLast(entry => entry.names.includes(name))
export const toolCards = {
  source: cards.source,
  register: (names, render, { phrase } = {}) => cards.register({ names: [names].flat(), render, phrase }),
  renderer: name => cardOf(name)?.render ?? undefined,
  phrase: name => cardOf(name)?.phrase,
}

// Sidebar nav: rows of the account menu, `{ id, label(), icon, run(actions), order }`.
export const nav = registry()
// Row badges: drawn at the end of a Bot's sidebar row, `Component({ bot, roster, useWork })`.
export const badges = registry()
// Header buttons: drawn in a Bot's chat header, `Component({ bot, roster, actions, useWork })`.
export const headerButtons = registry()

// Shell installers: each one runs while the Bot shell is up (Bot mode) and comes off with
// it, so what it registers follows the surface like Omni's own panels. It gets the
// surface's `face`, `shadow` (a slot registration on the shell) and `installStyles`, and
// returns its steps: functions that each mount one thing and return its disposer.
const installers = new Set()
let shell = null
const running = new Map()

function start(installer) {
  const disposers = []
  try {
    for (const step of [installer(shell)].flat()) if (step) disposers.push(step())
  } catch (error) {
    console.warn('[ds-bot] shell installer', error)
  }
  running.set(installer, disposers)
}
function stop(installer) {
  const disposers = running.get(installer) ?? []
  running.delete(installer)
  for (const dispose of disposers.reverse()) {
    try { dispose?.() } catch (error) { console.warn('[ds-bot] shell installer', error) }
  }
}

export function onShell(installer) {
  installers.add(installer)
  if (shell !== null) start(installer)
  return () => {
    installers.delete(installer)
    stop(installer)
  }
}

// One step of the shell group (index.js): runs every installer, and withdraws them all
// when the shell comes off.
export function mountShellInstallers(tools) {
  shell = tools
  for (const installer of installers) start(installer)
  return () => {
    for (const installer of [...running.keys()]) stop(installer)
    shell = null
  }
}
