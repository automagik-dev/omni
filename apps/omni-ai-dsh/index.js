// Omni's welcome and Connect AI for DeepSeek Harness. The browser half (client.js) draws
// the onboarding steps; this host half keeps their done flags in the plugin's own
// settings entry and saves a CLIProxyAPI route through DSH's settings and credentials.
// It adds no provider code: every sign-in is DSH's own.
import z from '@deepseek-ai/schemastery'
import { install } from './src/host/endpoint.js'

export const name = 'omni-ai'
// `connection` serves the plugin's /api/omni-ai route to the browser.
export const inject = ['settings', 'credentials', 'connection']

// Live (volatile) fields, so ctx.settings can write them into the profile patch.
export const Config = z.object({
  welcomeDone: z.boolean().volatile(),
  connectAiDone: z.boolean().volatile(),
  connectOmniSkipped: z.boolean().volatile(),
})

export function apply(ctx) {
  install(ctx)
}
