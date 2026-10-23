import { WelcomeStep } from './welcome.js'
import { ConnectAiStep } from './connect-ai.js'
import { STAGE_CSS } from './octopus.js'
import { announceStep } from './stage.js'

// Omni's onboarding on DSH's settings.onboarding slot. The shell mounts one step at a time,
// in order; Omni's come ahead of DSH's own welcome-notice (-100) and deepseek-official (0).
// The Omni plugin's omni-connect (-250) sits between these two when it is installed.
const STEPS = [
  { id: 'omni-welcome', order: -300, component: WelcomeStep },
  { id: 'omni-connect-ai', order: -200, component: ConnectAiStep },
]

export const inject = ['slots']

function installStyles() {
  const style = document.createElement('style')
  style.dataset.omniAi = ''
  style.textContent = STAGE_CSS
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
