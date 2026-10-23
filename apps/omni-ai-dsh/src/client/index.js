import { CompanionStep } from './companion.js'
import { TeamStep } from './team.js'
import { INK_CSS } from './companion-art.js'
import { ONBOARD_CSS } from './onboard-css.js'
import { ConnectAiStep } from './connect-ai.js'
import { STAGE_CSS } from './octopus.js'
import { announceStep } from './stage.js'
import { TERMINAL_CSS } from './terminal.js'

// Automagik's onboarding on DSH's settings.onboarding slot. The shell mounts one step at a
// time, in order; these come ahead of DSH's own welcome-notice (-100) and deepseek-official
// (0): create your companion, grow your team, then (with the Omni plugins and Omni on the
// team) the channels plugin's omni-connect (-250), then Connect AI.
const STEPS = [
  { id: 'omni-companion', order: -300, component: CompanionStep },
  { id: 'omni-team', order: -270, component: TeamStep },
  { id: 'omni-connect-ai', order: -200, component: ConnectAiStep },
]

export const inject = ['slots']

function installStyles() {
  const style = document.createElement('style')
  style.dataset.omniAi = ''
  style.textContent = STAGE_CSS + ONBOARD_CSS + INK_CSS + TERMINAL_CSS
  document.head.append(style)
  return () => style.remove()
}

export function apply(ctx) {
  ctx.effect(installStyles, 'omni-ai: stage styles')
  // ui-settings declares the slot in its own apply, which may run after this one.
  for (const step of STEPS) {
    ctx.effect(() => announceStep(step.id), `omni-ai: ${step.id} on the rail`)
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({ name: 'settings.onboarding', id: step.id, order: step.order }, step.component))
  }
}
