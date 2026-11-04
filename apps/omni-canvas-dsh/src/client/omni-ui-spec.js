// The components Omni draws with in the chat: what each one takes and is for. OpenUI reads
// the same definitions twice. The browser renders them (omni-ui.js attaches a React
// component to each), and the build writes Omni's authoring prompt from them
// (scripts/build-client.mjs → src/host/omni-ui-prompt.js), so a component exists for Omni
// exactly when it can be drawn. Arguments are positional, in the order of each `props`.
import { tagSchemaId } from '@openuidev/lang-core'
import { z } from 'zod/v4'

// The fence a reply's canvases come in, ```openui-lang; the team's chat finds them by the
// same word (its canvas-text.js), and a test keeps the two the same.
export const FENCE = 'openui-lang'
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
// A board bucket: the title, an optional count when the source has more rows than we draw,
// and the rows themselves (component references or plain values, positional like Table rows).
const boardColumn = z.object({
  title: z.string().max(200),
  count: z.number().int().min(0).max(10_000).optional(),
  rows: z.array(z.any()).max(50),
})
// A tree node is recursive: team → space → folder → list, and any deeper shape. Each level
// is bounded; the canvas check's program/node limits bound the whole thing.
const treeNode = z.lazy(() => z.object({
  label: z.string().max(200),
  meta: z.string().max(80).optional(),
  children: z.array(treeNode).max(20).optional(),
}))

export const SPECS = [
  ['Stack', 'Vertical group; the root of every canvas. gap: "s" | "m" | "l".', z.object({ children: z.array(z.any()).max(40), gap: z.enum(['s', 'm', 'l']).optional() })],
  ['Row', 'Side-by-side group that wraps on narrow screens (stats, buttons, cards).', z.object({ children: z.array(z.any()).max(12), gap: z.enum(['s', 'm', 'l']).optional() })],
  ['Card', 'A bordered section with a title.', z.object({ title: z.string().max(200), children: z.array(z.any()).max(40), subtitle: z.string().max(300).optional() })],
  ['Heading', 'A section title.', z.object({ text: z.string().max(200) })],
  ['Text', 'A paragraph. tone "muted" for secondary text.', z.object({ content: z.string().max(4000), tone: z.enum(['normal', 'muted']).optional() })],
  ['Badge', 'A short status label.', z.object({ text: z.string().max(80), tone: tone.optional() })],
  ['Stat', 'A key number with its label and an optional hint.', z.object({ label: z.string().max(120), value: z.union([z.number().finite(), z.string().max(120)]), hint: z.string().max(200).optional() })],
  ['Table', 'Rows of values under column titles, for a small flat matrix only (at most 12 rows, no buckets). For grouped rows use Board; long groups, Section; hierarchies, Tree.', z.object({ columns: z.array(z.string().max(80)).min(1).max(10), rows: z.array(z.array(z.any()).max(10)).max(200) })],
  ['Board', 'Ordered columns of bucketed rows, for tasks by status, deals by stage or tickets by assignee. Each column is {title, count?, rows}; a bucket with more than 8 rows starts collapsed with its count. Prefer it to Table for grouped rows.', z.object({ columns: z.array(boardColumn).min(1).max(12), title: z.string().max(200).optional() })],
  ['Section', 'A collapsible group that starts closed and shows its count, for a long list or bucket. count defaults to the number of children; use it when more than 8 rows would flood the reply.', z.object({ title: z.string().max(200), children: z.array(z.any()).max(60), count: z.number().int().min(0).max(10_000).optional() })],
  ['Tree', 'A hierarchy of {label, meta?, children?} nodes, for connector structure such as team → space → folder → list. meta is a short kind (team, space, folder, list).', z.object({ items: z.array(treeNode).min(1).max(20), title: z.string().max(200).optional() })],
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
    'Connector results often arrive as many rows. Bucket first: tasks by status, deals by stage, tickets by assignee → Board([{title: "To do", count: 31, rows: [task1, task2]}, …], "Tasks by status"). A bucket longer than 8 rows starts collapsed with its count; a standalone long group is Section("Recently updated", [row1, row2], 30), which also starts closed. A hierarchy (team → space → folder → list) is Tree([{label: "Team", meta: "team", children: […]}], "Structure").',
    'Keep Table for a small flat matrix (12 rows or fewer, no buckets). Never paste a connector result as markdown, one line per row, or a wall of Text: use Board, Section or Tree so the reply stays readable.',
    'A canvas cannot read secrets, call other services or run code.',
  ],
  examples: [
    'root = Stack([title, row, list])\ntitle = Heading("Channels")\nrow = Row([Stat("Connected", @Count(@Filter(ch.items, "state", "==", "connected"))), Stat("Total", @Count(ch.items))])\nch = Query("omni_channels", {}, {items: []}, 10)\nlist = Stack(@Each(ch.items, "c", Channel(c.id)))',
    'root = Stack([qr, again])\nqr = QrCode("5f0c1d2e-…")\nagain = Button("Get a new code", Action([@ToAssistant("Restart the connection of that channel")]))',
    'root = Stack([heading, board, recent, tree])\nheading = Heading("ClickUp: Q4 launch")\nboard = Board([{title: "To do", count: 31, rows: [t1, t2]}, {title: "In progress", count: 14, rows: [t3]}, {title: "Complete", count: 28, rows: [t4]}], "Tasks by status")\nrecent = Section("Recently updated", [t5, t6], 12)\ntree = Tree([{label: "Acme team", meta: "team", children: [{label: "Product", meta: "space", children: [{label: "Q4 launch", meta: "list"}]}]}], "ClickUp structure")\nt1 = Text("Draft launch brief")\nt2 = Text("Collect pricing approvals")\nt3 = Text("Build the onboarding flow")\nt4 = Text("Publish the release notes")\nt5 = Text("Customer note from Acme")\nt6 = Text("Design review moved to Friday")',
  ],
}
