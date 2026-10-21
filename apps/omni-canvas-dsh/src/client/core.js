// What this plugin takes from the Omni team's client (@automagik/omni-dsh/client) and the
// Omni channels client (@automagik/omni-channels-dsh/client). The plugin's
// dsh.client.external names both, so DSH loads them first and hands this one the same
// module instances: one interface dictionary, one set of registries, one omni store.
import { omni } from '@automagik/omni-dsh/client'
import { channels } from '@automagik/omni-channels-dsh/client'

export const { call, t, addStrings, onShell, toolCards, setCanvasRenderer } = omni
export const live = channels
