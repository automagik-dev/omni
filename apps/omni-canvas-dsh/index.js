// Omni's canvases for DeepSeek Harness: the Main Bot shows what it found as an openui-lang
// program that the chat renders as live UI. show_canvas checks a program before the user
// sees it, and the Main Bot learns the canvas language as the last part of its rules.
//
// A canvas reads omni through Omni's own reads, so this plugin sits on the Omni channels
// plugin (@automagik/omni-channels-dsh): its runtime's prototype is that plugin's runtime
// (omniChannels), whose prototype is the team's (omniTeam). Its tool and effects sit on
// this plugin's fiber, and it adds to the team only through rt.hooks.
import * as canvas from './src/host/canvas.js'

export const name = 'omni-canvas'
export const inject = ['omniTeam', 'omniChannels', 'tools']

export function apply(ctx, config = {}) {
  createRuntime(ctx, ctx.omniChannels, config)
}

export function createRuntime(ctx, channels, config = {}) {
  const rt = Object.assign(Object.create(channels), { ctx, config })
  canvas.install(rt)
  return rt
}
