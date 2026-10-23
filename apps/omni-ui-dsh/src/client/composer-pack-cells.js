import { createElement as h } from 'react'
import { composerPacks, useEntries } from './extend.js'
import { ModelMenu } from './model-menu.js'
import { cellChoice, packFor, targetOf } from './composer-packs.js'

// The composer's model cell under a pack that offers it: Omni's own model and thinking
// menu, which saves to the Bot like the one in its details. DSH's own picker stays out,
// since it moves the Session without the Bot knowing. `env` carries the registrants of
// the composer's cells, for packs that depend on another plugin being there.
export function packModelCell(env) {
  return function PackModelCell({ sessionId, useRoster, actions }) {
    const roster = useRoster(value => value)
    const packs = useEntries(composerPacks)
    const target = targetOf(roster, sessionId)
    const pack = packFor(target, { packs, env })
    if (cellChoice(pack, 'model', target) !== 'model') return null
    const run = promise => Promise.resolve(promise)
      .then(() => true)
      .catch((failure) => { actions?.reportError?.(failure, 'composer-model'); return false })
    return h('span', { className: 'bt-composer-model', 'data-pack': pack.id },
      h(ModelMenu, { bot: target.bot, roster, actions, run }))
  }
}

// Fits the menu's trigger into the composer's tool row.
export const COMPOSER_PACK_CSS = `
.bt-composer-model{display:inline-flex;min-width:0}
.bt-composer-model .bt-model-trigger{min-height:30px;padding:2px 6px 2px 8px;background:transparent}
.bt-composer-model .bt-model-copy{display:var(--dsh-composer-model-text-display,flex)}
`
