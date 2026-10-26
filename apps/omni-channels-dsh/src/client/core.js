// What this plugin takes from the Bot team's client (@automagik/bots-dsh/client, from
// automagik-dev/automagik). The plugin's dsh.client.external names it, so DSH loads the
// team's bundle first and hands this one the same module instance: one interface dictionary,
// one roster, one set of the registries this plugin adds to. In a DSH that still runs the
// team under its former name, @automagik/omni-dsh, the bundle takes that one instead
// (scripts/build-client.mjs).
import { omni } from '@automagik/bots-dsh/client'

export const { call, t, addStrings, onShell, toolCards, nav, badges, botChildren, headerButtons, botSettings, chatSuggestions } = omni
export const { OmniMark, BotMark, MAIN_LOOK, CHARACTERS, relativeShort, createSource } = omni.ui
export const icons = omni.ui.icons
