import { createElement as h, useEffect, useSyncExternalStore } from 'react'
import { ConnectOmniStep } from './connect-step.js'
import { CONNECT_STEP, callOmniAi, gateConnect, localStore, stepShown } from './onboarding.js'
import { call, t } from './core.js'

// The Connect step on demand: the same wizard DSH shows during first-run onboarding, opened
// from this plugin's settings page, the Channels page, or by itself once after install. DSH
// hands a way to reopen a step only to its account launcher, so this plugin mounts the
// step itself (WizardHost sits in the sidebar footer, which is always there) and the step
// portals its stage to the page.

let isOpen = false
const listeners = new Set()
const emit = () => { for (const listener of listeners) listener() }
const subscribe = (listener) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export const wizardOpen = () => isOpen
export function openConnectWizard() {
  if (isOpen) return
  isOpen = true
  emit()
}
export function closeConnectWizard() {
  if (!isOpen) return
  isOpen = false
  emit()
}

// Remembered in this browser: the wizard opened by itself once already.
export const AUTO_OPENED = 'omni-channels:connect-wizard-opened'
const AUTO_OPEN_DELAY_MS = 1500

/**
 * Opens the wizard once, on the first page load after install, when this DSH has no Omni
 * and the person never finished or skipped the step (gateConnect answers null for both),
 * unless DSH's own onboarding is showing it right then. Resolves whether it opened.
 */
export async function autoOpenOnce({ request = call, omniAi = callOmniAi, storage = localStore(), gate = gateConnect, shown = stepShown, open = openConnectWizard, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  try {
    if (storage?.getItem(AUTO_OPENED) === '1') return false
  } catch {}
  const state = await gate({ stepId: CONNECT_STEP.id, complete: () => {} }, { request, omniAi, storage }).catch(() => null)
  if (!state) return false
  // DSH may mount its first-run step a moment after the page: let it go first.
  await wait(AUTO_OPEN_DELAY_MS)
  if (shown()) return false
  try {
    storage?.setItem(AUTO_OPENED, '1')
  } catch {}
  open()
  return true
}

export function WizardHost() {
  const open = useSyncExternalStore(subscribe, wizardOpen, wizardOpen)
  useEffect(() => { void autoOpenOnce() }, [])
  if (!open) return null
  return h(ConnectOmniStep, { stepId: CONNECT_STEP.id, explicit: true, onDemand: true, complete: closeConnectWizard, openSection: () => {} })
}

// The Channels page before an Omni is linked: one card that opens the wizard.
export function ConnectPrompt() {
  return h('section', { className: 'oc-connect-prompt' },
    h('div', null,
      h('strong', null, t('Connect your Omni')),
      h('p', null, t('This page shows sample data until this DSH is linked to your Omni.'))),
    h('button', { type: 'button', className: 'oc-primary', onClick: openConnectWizard }, t('Connect your Omni')))
}
