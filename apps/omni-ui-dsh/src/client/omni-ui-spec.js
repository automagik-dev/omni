// The components Omni draws with in the chat: what each one takes and is for. OpenUI reads
// the same definitions twice. The browser renders them (omni-ui.js attaches a React
// component to each), and the build writes Omni's authoring prompt from them
// (scripts/build-client.mjs → src/host/omni-ui-prompt.js), so a component exists for Omni
// exactly when it can be drawn. Arguments are positional, in the order of each `props`.
import { tagSchemaId } from '@openuidev/lang-core'
import { z } from 'zod/v4'
import { FENCE } from './canvas-text.js'

export { FENCE }
// The one tool a canvas Query may name: a GET of any documented omni operation.
export const QUERY_TOOL = 'omni_get'

// Tagged so the generated prompt documents Action([...]) for Button.
export const ActionExpression = z.any()
tagSchemaId(ActionExpression, 'ActionExpression')

const tone = z.enum(['ok', 'warn', 'bad', 'info', 'muted'])
const point = z.object({ label: z.string().max(200), value: z.number().finite() })

export const SPECS = [
  ['Stack', 'Vertical group; the root of every canvas. gap: "s" | "m" | "l".', z.object({ children: z.array(z.any()).max(40), gap: z.enum(['s', 'm', 'l']).optional() })],
  ['Row', 'Side-by-side group that wraps on narrow screens (stats, buttons, cards).', z.object({ children: z.array(z.any()).max(12), gap: z.enum(['s', 'm', 'l']).optional() })],
  ['Card', 'A bordered section with a title.', z.object({ title: z.string().max(200), children: z.array(z.any()).max(40), subtitle: z.string().max(300).optional() })],
  ['Heading', 'A section title.', z.object({ text: z.string().max(200) })],
  ['Text', 'A paragraph. tone "muted" for secondary text.', z.object({ content: z.string().max(4000), tone: z.enum(['normal', 'muted']).optional() })],
  ['Badge', 'A short status label.', z.object({ text: z.string().max(80), tone: tone.optional() })],
  ['Stat', 'A key number with its label and an optional hint.', z.object({ label: z.string().max(120), value: z.union([z.number().finite(), z.string().max(120)]), hint: z.string().max(200).optional() })],
  ['Table', 'Rows of values under column titles. Each row is an array in column order.', z.object({ columns: z.array(z.string().max(80)).min(1).max(10), rows: z.array(z.array(z.any()).max(10)).max(200) })],
  ['Chart', 'Bars, a line or a donut from {label, value} points (at most 50).', z.object({ kind: z.enum(['bars', 'line', 'donut']), data: z.array(point).max(50), title: z.string().max(200).optional() })],
  ['KeyValue', 'Label/value pairs, for the fields of one record.', z.object({ pairs: z.array(z.object({ label: z.string().max(120), value: z.any() })).max(40) })],
  ['Select', 'A choice bound to a $variable; changing it only changes what the canvas shows.', z.object({ name: z.string().max(100), label: z.string().max(200), options: z.array(z.string().max(200)).min(1).max(30), value: z.string().max(200) })],
  ['Button', 'A button. Its action asks you (@ToAssistant) to do something, or opens a link (@OpenUrl). tone: "primary" | "normal" | "danger".', z.object({ label: z.string().max(80), action: ActionExpression, tone: z.enum(['primary', 'normal', 'danger']).optional() })],
  ['Channel', 'Live card of one omni channel (instance): name, kind, connection state, profile. Updates by itself.', z.object({ id: z.string().max(100) })],
  ['QrCode', 'Live WhatsApp QR code for connecting a channel (instance id). Refreshes as WhatsApp rotates it and turns into "Connected" once scanned.', z.object({ channelId: z.string().max(100) })],
  ['Chat', 'Live card of one chat with its latest messages.', z.object({ id: z.string().max(100), limit: z.number().int().min(1).max(30).optional() })],
]
export const ROOT = 'Stack'
// Components whose values stay with the canvas: Select writes its $variable.
export const BINDINGS = { Select: 'value' }

// The library over any OpenUI implementation: lang-core in the build, react-lang in the
// browser, each with its own defineComponent and createLibrary.
export function libraryOf({ createLibrary, defineComponent, reactive }, render = {}) {
  return createLibrary({
    root: ROOT,
    components: SPECS.map(([name, description, props]) => {
      const bound = BINDINGS[name]
      const shaped = bound && reactive ? props.extend({ [bound]: reactive(props.shape[bound]) }) : props
      return defineComponent({ name, description, props: shaped, component: render[name] ?? (() => null) })
    }),
  })
}

export const PROMPT_OPTIONS = {
  preamble: 'Omni draws with openui-lang: a small program that renders as native, live UI inside your chat message.',
  tools: [{ name: QUERY_TOOL, description: 'GET one documented omni API operation and return its JSON ({data} for one record, {items, meta} for lists).', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'API path under /api/v2 with ids and an optional ?query, e.g. /instances or /chats?limit=20' } }, required: ['path'] } }],
  bindings: true,
  additionalRules: [
    `Query("${QUERY_TOOL}", {path: "/instances"}, {items: []}, 15) reads omni live; the last argument refreshes it every N seconds. Lists come back as {items: [...]}, one record as {data: {...}}.`,
    'Mutation() is not available. Changes are yours to make with omni_call; a Button asks you for one with Action([@ToAssistant("...")]).',
    'Channel, QrCode and Chat fetch and refresh their own data from an id: prefer them to rebuilding those views from a Query.',
    'Use only fields you have seen in a real record (read one with omni_call first). Instances carry name, channel, isActive and profileName; whether one is connected comes from /instances/{id}/status, which Channel already shows.',
    'A @Each loop variable exists only inside its template: write @Each(inst.items, "i", Channel(i.id)), never i.name in another statement.',
    'A canvas cannot read secrets, call other services or run code.',
  ],
  examples: [
    'root = Stack([title, row, list])\ntitle = Heading("Channels")\nrow = Row([Stat("Connected", @Count(@Filter(inst.items, "isActive", "==", true))), Stat("Total", @Count(inst.items))])\ninst = Query("omni_get", {path: "/instances"}, {items: []}, 15)\nlist = Table(["Name", "Channel"], @Each(inst.items, "i", [i.name, i.channel]))',
    'root = Stack([qr, again])\nqr = QrCode("5f0c1d2e-…")\nagain = Button("Get a new code", Action([@ToAssistant("Restart the connection of that channel")]))',
  ],
}
