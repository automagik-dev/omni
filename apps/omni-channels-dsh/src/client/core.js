// What this plugin takes from the Omni team's client (@automagik/omni-dsh/client). The
// plugin's dsh.client.external names it, so DSH loads the team's bundle first and hands
// this one the same module instance: one interface dictionary, one roster, one set of the
// registries this plugin adds to.
import { omni } from '@automagik/omni-dsh/client'

export const { call, t, addStrings, onShell, toolCards, nav, badges, headerButtons } = omni
export const { OmniMark, BotMark, MAIN_LOOK, CHARACTERS, relativeShort, createSource } = omni.ui
export const icons = omni.ui.icons
