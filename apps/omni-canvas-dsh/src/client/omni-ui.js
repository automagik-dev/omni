import { Component, createContext, createElement as h, Fragment, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { createLibrary, defineComponent, reactive, Renderer, useStateField, useTriggerAction } from '@openuidev/react-lang'
import { QUERY_TOOLS, libraryOf } from './omni-ui-spec.js'
import { checkProgram as checkCanvas } from './omni-ui-check.js'
import { call, live, t } from './core.js'

// The live views of omni are the channels plugin's (its client's `channels`).
const { Badge, KeyValue, LiveChannel, LiveChat, LiveQr, Table } = live

// Canvases: Omni shows one with show_canvas (older replies carry it as an openui-lang
// fence) and the chat renders it in place as live, native UI. Adapted from genui-canvas (namastexlabs/agent-studio-plugins): the
// program is parsed and checked against the closed library before anything mounts, and a
// program that fails shows its source instead. Omni's canvases may read omni live (Query
// with the omni_get tool, GET only, through the host) and their buttons ask Omni to act
// (@ToAssistant); they never write by themselves: no Mutation.

// react-lang initializes $defaults in a passive effect; its first empty-store pass stays
// invisible rather than reading as invalid data (as in genui-canvas).
const RuntimeReady = createContext(false)

const nodeOf = (value, renderNode) => (value && typeof value === 'object' && 'typeName' in value ? renderNode(value) : value === null || value === undefined ? null : String(value))

function Stack({ props, renderNode }) {
  if (!useContext(RuntimeReady)) return null
  return h('div', { className: 'ou-stack', 'data-gap': props.gap ?? 'm' }, (props.children ?? []).map((child, index) => h(Fragment, { key: index }, nodeOf(child, renderNode))))
}
const Row = ({ props, renderNode }) => h('div', { className: 'ou-row', 'data-gap': props.gap ?? 'm' }, (props.children ?? []).map((child, index) => h(Fragment, { key: index }, nodeOf(child, renderNode))))
const Card = ({ props, renderNode }) => h('section', { className: 'ou-section' },
  h('header', null, h('strong', null, props.title), props.subtitle ? h('span', { className: 'ou-muted' }, props.subtitle) : null),
  (props.children ?? []).map((child, index) => h(Fragment, { key: index }, nodeOf(child, renderNode))))
const Heading = ({ props }) => h('div', { className: 'ou-heading', role: 'heading', 'aria-level': 3 }, props.text)
const Text = ({ props }) => h('p', { className: 'ou-text', 'data-tone': props.tone ?? 'normal' }, props.content)
const BadgeNode = ({ props }) => h(Badge, { text: props.text, tone: props.tone })
const Stat = ({ props }) => h('div', { className: 'ou-stat' },
  h('span', { className: 'ou-stat-label' }, props.label),
  h('strong', { className: 'ou-stat-value' }, typeof props.value === 'number' ? props.value.toLocaleString() : props.value ?? '—'),
  props.hint ? h('span', { className: 'ou-muted' }, props.hint) : null)
const TableNode = ({ props, renderNode }) => h(Table, { columns: props.columns, rows: (props.rows ?? []).map(row => (Array.isArray(row) ? row : [row]).map(value => (value && typeof value === 'object' && 'typeName' in value ? renderNode(value) : value))) })
const KeyValueNode = ({ props }) => h(KeyValue, { pairs: props.pairs ?? [] })

// A bucket longer than this starts closed, so a 30-task column does not flood the reply.
export const BOARD_COLLAPSE_AFTER = 8
const countOf = (count, fallback) => (Number.isInteger(count) ? count : fallback)
const rowsOf = (rows, renderNode) => (rows ?? []).map((row, index) => h(Fragment, { key: index }, nodeOf(row, renderNode)))

function BoardColumn({ column, renderNode }) {
  const rows = column.rows ?? []
  const count = countOf(column.count, rows.length)
  const head = h('span', { className: 'ou-board-column-head' }, h('strong', null, column.title), h('span', { className: 'ou-count' }, count))
  const body = h('div', { className: 'ou-board-rows' }, rowsOf(rows, renderNode))
  return rows.length > BOARD_COLLAPSE_AFTER
    ? h('details', { className: 'ou-board-column' }, h('summary', null, head), body)
    : h('section', { className: 'ou-board-column' }, head, body)
}

function Board({ props, renderNode }) {
  return h('section', { className: 'ou-board' },
    props.title ? h('strong', { className: 'ou-board-title' }, props.title) : null,
    h('div', { className: 'ou-board-columns' }, (props.columns ?? []).map((column, index) => h(BoardColumn, { key: index, column, renderNode }))))
}

function Section({ props, renderNode }) {
  const children = props.children ?? []
  return h('details', { className: 'ou-disclosure' },
    h('summary', null, h('span', { className: 'ou-disclosure-title' }, props.title), h('span', { className: 'ou-count' }, countOf(props.count, children.length))),
    h('div', { className: 'ou-disclosure-body' }, rowsOf(children, renderNode)))
}

function treeList(items, depth = 0) {
  return h('ul', { className: 'ou-tree', 'data-depth': depth }, (items ?? []).map((node, index) => h('li', { key: index, className: 'ou-tree-node' },
    h('span', { className: 'ou-tree-label' }, h('span', null, node.label), node.meta ? h('span', { className: 'ou-count' }, node.meta) : null),
    node.children?.length ? treeList(node.children, depth + 1) : null)))
}

function Tree({ props }) {
  return h('section', { className: 'ou-tree-wrap' },
    props.title ? h('strong', { className: 'ou-board-title' }, props.title) : null,
    treeList(props.items ?? []))
}

function Chart({ props }) {
  const data = (props.data ?? []).filter(point => Number.isFinite(point?.value))
  if (data.length === 0) return h('span', { className: 'ou-muted' }, t('No data to chart.'))
  const title = props.title ? h('strong', { className: 'ou-chart-title' }, props.title) : null
  if (props.kind === 'donut') {
    const total = data.reduce((sum, point) => sum + Math.max(0, point.value), 0) || 1
    let start = 0
    const R = 15.9155
    return h('figure', { className: 'ou-chart ou-donut' }, title,
      h('div', { className: 'ou-donut-row' },
        h('svg', { viewBox: '0 0 42 42', width: 120, height: 120, role: 'img', 'aria-label': props.title ?? t('Chart') },
          data.map((point, index) => {
            const share = Math.max(0, point.value) / total * 100
            const arc = h('circle', { key: index, cx: 21, cy: 21, r: R, fill: 'none', stroke: `hsl(${(index * 57 + 200) % 360} 65% 55%)`, strokeWidth: 6, strokeDasharray: `${share} ${100 - share}`, strokeDashoffset: 25 - start })
            start += share
            return arc
          })),
        h('ul', { className: 'ou-legend' }, data.map((point, index) => h('li', { key: index }, h('i', { style: { background: `hsl(${(index * 57 + 200) % 360} 65% 55%)` } }), point.label, h('span', { className: 'ou-muted' }, point.value.toLocaleString()))))))
  }
  if (props.kind === 'line') {
    const max = Math.max(...data.map(point => point.value))
    const min = Math.min(0, ...data.map(point => point.value))
    const span = max - min || 1
    const x = index => (data.length === 1 ? 50 : index / (data.length - 1) * 100)
    const y = value => 38 - (value - min) / span * 34
    return h('figure', { className: 'ou-chart' }, title,
      h('svg', { viewBox: '0 0 100 40', preserveAspectRatio: 'none', className: 'ou-line', role: 'img', 'aria-label': props.title ?? t('Chart') },
        h('polyline', { points: data.map((point, index) => `${x(index)},${y(point.value)}`).join(' '), fill: 'none', stroke: 'var(--bt-accent)', strokeWidth: 1.4, vectorEffect: 'non-scaling-stroke' })),
      h('div', { className: 'ou-line-axis' }, h('span', null, data[0].label), h('span', null, data.at(-1).label)))
  }
  const max = Math.max(...data.map(point => Math.abs(point.value))) || 1
  return h('figure', { className: 'ou-chart' }, title,
    h('div', { className: 'ou-bars' }, data.map((point, index) => h('div', { key: index, className: 'ou-bar' },
      h('span', { className: 'ou-bar-label' }, point.label),
      h('span', { className: 'ou-bar-track' }, h('span', { className: 'ou-bar-fill', style: { width: `${Math.abs(point.value) / max * 100}%` } })),
      h('span', { className: 'ou-bar-value' }, point.value.toLocaleString())))))
}

function Select({ props }) {
  const field = useStateField(props.name, props.value)
  const options = props.options ?? []
  return h('label', { className: 'ou-select' }, h('span', null, props.label),
    h('select', { name: field.name, value: field.value ?? options[0] ?? '', onChange: (event) => { if (options.includes(event.target.value)) field.setValue(event.target.value) } },
      options.map(option => h('option', { key: option, value: option }, option))))
}

function Button({ props }) {
  const trigger = useTriggerAction()
  return h('button', { type: 'button', className: 'ou-button', 'data-tone': props.tone ?? 'normal', onClick: () => trigger(props.label, undefined, props.action) }, props.label)
}

export const RENDER = {
  Stack, Row, Card, Heading, Text, Badge: BadgeNode, Stat, Table: TableNode, Board, Section, Tree, Chart, KeyValue: KeyValueNode, Select, Button,
  Channel: ({ props }) => h(LiveChannel, { id: props.id }),
  QrCode: ({ props }) => h(LiveQr, { channelId: props.channelId }),
  Chat: ({ props }) => h(LiveChat, { id: props.id, limit: props.limit }),
}
export const omniLibrary = libraryOf({ createLibrary, defineComponent, reactive }, RENDER)
// Checked before anything mounts, with the same check the host runs on show_canvas.
export const checkProgram = (program) => {
  const refusal = checkCanvas(program)
  return refusal === null ? null : t(refusal.text, refusal.params)
}

// Each Query tool reads on the host, through the same code as Omni's tool of that name.
const readOmni = Object.fromEntries(QUERY_TOOLS.map(name => [name, async args => call('omni-read', { tool: name, args })]))

// A canvas that fails says why, keeps its source, and lets the user hand the error back to
// the Bot that wrote it.
function Fallback({ program, reason, onAsk }) {
  return h('div', { className: 'ou-fallback' },
    h('p', { role: 'alert' }, t('This view could not be drawn: {reason}', { reason })),
    h('div', { className: 'ou-fallback-row' },
      onAsk ? h('button', { type: 'button', className: 'ou-button', onClick: () => onAsk(`Your canvas could not be drawn: ${reason}\nSend a corrected one.`) }, t('Ask to fix it')) : null,
      h('details', null, h('summary', null, t('Source')), h('pre', null, program))))
}

class Boundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? h(Fallback, { program: this.props.program, reason: t('it failed while rendering.'), onAsk: this.props.onAsk }) : this.props.children }
}

function Canvas({ program, onAsk }) {
  const invalid = useMemo(() => checkProgram(program), [program])
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(null)
  useEffect(() => setReady(true), [])
  const onError = useCallback((errors) => { if (errors.length > 0) setFailed(errors[0]?.message ?? t('a part could not be rendered.')) }, [])
  const onAction = useCallback((event) => {
    if (event.type === 'continue_conversation') onAsk(String(event.params?.message ?? event.humanFriendlyMessage ?? ''))
    else if (event.type === 'open_url' && /^https?:\/\//i.test(String(event.params?.url ?? ''))) window.open(event.params.url, '_blank', 'noopener,noreferrer')
  }, [onAsk])
  if (invalid || failed) return h(Fallback, { program, reason: invalid ?? failed, onAsk })
  return h(RuntimeReady.Provider, { value: ready },
    h(Renderer, { response: program, library: omniLibrary, isStreaming: false, toolProvider: readOmni, onAction, onError, publishObservability: false }))
}

// One canvas in a reply. `onAsk` sends a button's request to Omni as the user's message.
export function OmniCanvas({ program, complete, onAsk }) {
  if (!complete) return h('div', { className: 'ou-canvas ou-drawing' }, h('span', { className: 'ou-live-dot', 'aria-hidden': true }), t('Drawing…'))
  return h('div', { className: 'ou-canvas' }, h(Boundary, { key: program, program, onAsk }, h(Canvas, { program, onAsk })))
}

export const OMNI_UI_CSS = `
.bt-canvas-line{display:flex;margin:4px 0;min-width:0}
.ou-canvas{margin:6px 0;width:100%;max-width:680px;color:var(--bt-ink);font-size:14px}
.ou-drawing{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border:1px dashed var(--bt-line-2);border-radius:14px;color:var(--bt-ink-3);font-size:13px}
.ou-stack{display:flex;flex-direction:column;gap:12px;min-width:0}
.ou-stack[data-gap=s]{gap:6px}
.ou-stack[data-gap=l]{gap:20px}
.ou-row{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch}
.ou-row>*{flex:1 1 140px;min-width:0}
.ou-row[data-gap=s]{gap:6px}
.ou-row[data-gap=l]{gap:18px}
.ou-section{display:flex;flex-direction:column;gap:10px;padding:14px;border:1px solid var(--bt-line);border-radius:16px;background:var(--bt-card)}
.ou-section>header{display:flex;flex-direction:column;gap:2px}
.ou-section>header strong{font-size:14px;font-weight:600}
.ou-heading{font-size:16px;font-weight:600;line-height:22px}
.ou-text{margin:0;line-height:1.5}
.ou-text[data-tone=muted]{color:var(--bt-ink-3);font-size:13px}
.ou-stat{display:flex;flex-direction:column;gap:2px;padding:12px 14px;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card)}
.ou-stat-label{font-size:12.5px;color:var(--bt-ink-3)}
.ou-stat-value{font-size:22px;line-height:28px;font-weight:600;font-variant-numeric:tabular-nums}
.ou-board{display:flex;flex-direction:column;gap:10px;min-width:0}
.ou-board-title{font-size:13px;font-weight:600}
.ou-board-columns{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:start}
.ou-board-column{display:flex;flex-direction:column;gap:6px;min-width:0;padding:10px 12px;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card)}
.ou-board-column>summary{list-style:none;cursor:pointer}
.ou-board-column>summary::-webkit-details-marker{display:none}
.ou-board-column>summary .ou-board-column-head::before{content:'▸';margin-right:2px;color:var(--bt-ink-3);transition:transform .15s}
.ou-board-column[open]>summary .ou-board-column-head::before{transform:rotate(90deg)}
.ou-board-column-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px}
.ou-board-column-head strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-board-rows{display:flex;flex-direction:column;gap:6px;min-width:0}
.ou-board-rows>*{min-width:0}
.ou-disclosure{padding:10px 12px;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card)}
.ou-disclosure>summary{display:flex;align-items:center;gap:8px;list-style:none;cursor:pointer;font-size:13.5px;font-weight:600}
.ou-disclosure>summary::-webkit-details-marker{display:none}
.ou-disclosure>summary::before{content:'▸';color:var(--bt-ink-3);transition:transform .15s}
.ou-disclosure[open]>summary::before{transform:rotate(90deg)}
.ou-disclosure-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-disclosure-body{display:flex;flex-direction:column;gap:8px;margin-top:10px}
.ou-count{display:inline-flex;flex:0 0 auto;align-items:center;justify-content:center;min-width:22px;height:20px;padding:0 7px;border-radius:999px;background:var(--bt-hover);color:var(--bt-ink-2);font-size:12px;font-weight:500;font-variant-numeric:tabular-nums}
.ou-tree-wrap{display:flex;flex-direction:column;gap:8px;min-width:0}
.ou-tree{display:flex;flex-direction:column;gap:6px;margin:0;padding:0;list-style:none;min-width:0}
.ou-tree .ou-tree{margin:6px 0 0 12px;padding-left:12px;border-left:1px solid var(--bt-line)}
.ou-tree-node{min-width:0}
.ou-tree-label{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px}
.ou-tree-label>span:first-child{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ou-chart{margin:0;display:flex;flex-direction:column;gap:8px;padding:12px 14px;border:1px solid var(--bt-line);border-radius:14px;background:var(--bt-card)}
.ou-chart-title{font-size:13px;font-weight:600}
.ou-bars{display:flex;flex-direction:column;gap:6px}
.ou-bar{display:grid;grid-template-columns:minmax(60px,30%) 1fr auto;gap:10px;align-items:center;font-size:12.5px}
.ou-bar-label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--bt-ink-2)}
.ou-bar-track{height:8px;border-radius:4px;background:var(--bt-hover);overflow:hidden}
.ou-bar-fill{display:block;height:100%;border-radius:4px;background:var(--bt-accent)}
.ou-bar-value{font-variant-numeric:tabular-nums;color:var(--bt-ink-2)}
.ou-line{width:100%;height:90px}
.ou-line-axis{display:flex;justify-content:space-between;font-size:11px;color:var(--bt-ink-3)}
.ou-donut-row{display:flex;align-items:center;gap:18px;flex-wrap:wrap}
.ou-legend{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:4px;font-size:12.5px}
.ou-legend li{display:flex;align-items:center;gap:6px}
.ou-legend i{width:9px;height:9px;border-radius:3px}
.ou-select{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:var(--bt-ink-2)}
.ou-select select,.ou-button{height:34px;padding:0 12px;border:1px solid var(--bt-line-2);border-radius:10px;background:var(--bt-card);color:var(--bt-ink);font:inherit;font-size:13.5px;cursor:pointer}
.ou-button[data-tone=primary]{border-color:transparent;background:var(--bt-ink);color:var(--bt-main)}
.ou-button[data-tone=danger]{color:#d13438}
.ou-button:hover{background:var(--bt-hover)}
.ou-button[data-tone=primary]:hover{opacity:.9;background:var(--bt-ink)}
.ou-row>.ou-button{flex:0 0 auto}
.ou-fallback{padding:10px 12px;border-left:3px solid #ff9800;font-size:13px}
.ou-fallback p{margin:0 0 6px}
.ou-fallback-row{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.ou-fallback summary{cursor:pointer;color:var(--bt-ink-3);line-height:34px}
.ou-fallback pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
`
