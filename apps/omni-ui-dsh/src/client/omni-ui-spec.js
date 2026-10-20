// The components Omni draws with in the chat: what each one takes and is for. OpenUI reads
// the same definitions twice. The browser renders them (omni-ui.js attaches a React
// component to each), and the build writes Omni's authoring prompt from them
// (scripts/build-client.mjs → src/host/omni-ui-prompt.js), so a component exists for Omni
// exactly when it can be drawn. Arguments are positional, in the order of each `props`.
import { tagSchemaId } from '@openuidev/lang-core'
import { z } from 'zod/v4'
import { FENCE } from './canvas-text.js'

export { FENCE }
// The tools a canvas Query may name: Omni's own read tools, with the same names and
// arguments, and omni_get for any other documented GET.
export const QUERY_TOOL = 'omni_get'
export const CHANNELS_TOOL = 'omni_channels'
const READ_TOOLS = [
  { name: CHANNELS_TOOL, description: 'Every channel with its live state: {items: [{id, name, channel, state ("connected", "connecting", "paused"…), profile, phone, active}]}.', inputSchema: { type: 'object', properties: {} } },
  { name: 'omni_chats', description: 'Chats and groups, most recent first: {items: [{id, name, type, channelId, unread, lastMessageAt, preview}], more}.', inputSchema: { type: 'object', properties: { channel: { type: 'string', description: 'Channel id or exact name' }, search: { type: 'string' }, unread_only: { type: 'boolean' }, limit: { type: 'number' } } } },
  { name: 'omni_messages', description: 'A chat\'s latest messages, oldest first: {chat: {id, name, channel}, items: [{from, at, text}]}.', inputSchema: { type: 'object', properties: { chat: { type: 'string', description: 'Chat id' }, limit: { type: 'number' } }, required: ['chat'] } },
  { name: QUERY_TOOL, description: 'GET one documented omni API operation and return its JSON ({data} for one record, {items, meta} for lists).', inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'API path under /api/v2 with ids, e.g. /automations' }, query: { type: 'object', description: 'Query parameters, e.g. {limit: 20}' } }, required: ['path'] } },
]
export const QUERY_TOOLS = READ_TOOLS.map(tool => tool.name)

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
  preamble: 'A canvas is an openui-lang program, passed to show_canvas: it renders as native, live UI in the chat.',
  tools: READ_TOOLS,
  bindings: true,
  additionalRules: [
    'A Query reads omni live with your own read tools, same names and arguments: Query("omni_chats", {channel: "sales", unread_only: true}, {items: []}, 20). The last argument refreshes it every N seconds.',
    `Connection state comes from Query("${CHANNELS_TOOL}", {}, {items: []}, 10): its items carry state; /instances items do not.`,
    'Mutation() is not available. Changes are yours to make with omni_call; a Button asks you for one with Action([@ToAssistant("...")]).',
    'Channel, QrCode and Chat fetch and refresh their own data from an id: prefer them to rebuilding those views from a Query. A channel\'s live state is what Channel shows; /instances items carry no connection state.',
    'Use only fields you have seen in a real record (read one with omni_call first). Instances carry name, channel, isActive and profileName; whether one is connected comes from /instances/{id}/status, which Channel already shows.',
    'A @Each loop variable exists only inside its template: write @Each(inst.items, "i", Channel(i.id)), never i.name in another statement.',
    'A canvas cannot read secrets, call other services or run code.',
  ],
  examples: [
    'root = Stack([title, row, list])\ntitle = Heading("Channels")\nrow = Row([Stat("Connected", @Count(@Filter(ch.items, "state", "==", "connected"))), Stat("Total", @Count(ch.items))])\nch = Query("omni_channels", {}, {items: []}, 10)\nlist = Stack(@Each(ch.items, "c", Channel(c.id)))',
    'root = Stack([qr, again])\nqr = QrCode("5f0c1d2e-…")\nagain = Button("Get a new code", Action([@ToAssistant("Restart the connection of that channel")]))',
  ],
}
