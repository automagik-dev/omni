// Canvases: the Main Bot shows what it found as an openui-lang program the chat renders as
// live UI (src/client/omni-ui.js). show_canvas checks a program first with the same
// components the client renders (omni-ui-check.bundle.js), so the user never sees a
// refused one. A canvas reads omni through Omni's own reads, so canvases come with an
// Omni named here, as the rest of operating it does.
import { defineTool } from '@deepseek-ai/dsh-tools'
import { output } from './tools.js'
import { checkProgram, refusalText } from './omni-ui-check.bundle.js'
import { OMNI_UI_PROMPT } from './omni-ui-prompt.js'

// After the operator rules (omni-rules.js), as the last part of the Main Bot's rules.
export const CANVAS_RULES = [
  '## Showing things: canvases',
  '- When a view says it better than words (an overview, a list, numbers, a QR code, a chat), call show_canvas with an openui-lang program. It renders in the chat as native, live UI. If it is refused, fix what the reason says and call it again; the user never sees a refused canvas.',
  '- A tool\'s card already shows what the tool returned (a channel list, a chat list, a QR code). Draw a canvas only when it adds something those cards do not, such as a summary or a combination, and never repeat a card or a canvas in text: answer in a line.',
  '- Never paste raw JSON, long lists or tables in text. Never write openui-lang in your reply text; only show_canvas checks a canvas before the user sees it.',
  '- The canvas language follows.',
  '',

  OMNI_UI_PROMPT,
].join('\n')

export function install(rt) {
  const { ctx } = rt
  const named = () => rt.omniNamed?.() === true

  ctx.effect(() => rt.hooks.mainRules(() => (named() ? CANVAS_RULES : null), { order: 200 }), 'ds-bot: canvas rules')

  ctx.tools.register(defineTool({
    name: 'show_canvas',
    description: 'Main Bot only. Shows the user a canvas: an openui-lang program, rendered live in the chat. It is checked first; when it is refused, fix what the reason says and call again. Prefer it to long text, lists or tables.',
    parameters: { program: { type: 'string', required: true, description: 'The openui-lang program, root = Stack([...]) first, one statement per line' } },
    output,
    async execute(args, exec) {
      await rt.load()
      if (!rt.isMain(rt.selfOf(exec.agent?.id))) return 'Only a Main Bot operates omni. Ask it in its chat.'
      const problem = checkProgram(String(args.program ?? ''))
      return problem === null ? 'Shown.' : `Not shown: ${refusalText(problem)} Fix it and call show_canvas again.`
    },
  }))
}
