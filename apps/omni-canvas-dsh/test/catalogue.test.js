import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BOARD_COLLAPSE_AFTER, RENDER } from '../src/client/omni-ui.js'
import { SPECS } from '../src/client/omni-ui-spec.js'
import { checkProgram, refusalText } from '../src/host/omni-ui-check.bundle.js'
import { OMNI_UI_PROMPT } from '../src/host/omni-ui-prompt.js'
import {
  CLICKUP,
  CLICKUP_PROGRAM,
  CLICKUP_TASKS,
  clickupBoardProps,
  clickupSectionProps,
  clickupTreeProps,
} from './fixtures/clickup.js'

const schemaOf = name => SPECS.find(([candidate]) => candidate === name)[2]
const validBoard = {
  columns: [
    { title: 'To do', count: 2, rows: ['a', 'b'] },
    { title: 'Done', rows: ['c'] },
  ],
  title: 'Tasks by status',
}
const validTree = {
  items: [{
    label: 'Acme team',
    meta: 'team',
    children: [{
      label: 'Product',
      meta: 'space',
      children: [{
        label: 'Q4 launch',
        meta: 'folder',
        children: [{ label: 'Launch checklist', meta: 'list' }],
      }],
    }],
  }],
  title: 'ClickUp structure',
}
const text = length => 'x'.repeat(length)

test('the generated prompt documents every SPECS component and the connector rule', () => {
  for (const [name, description] of SPECS) {
    assert.ok(OMNI_UI_PROMPT.includes(`${name}(`), `prompt signature for ${name}`)
    assert.ok(OMNI_UI_PROMPT.includes(description), `prompt description for ${name}`)
  }
  for (const part of [
    'Board(columns:',
    'Section(title:',
    'Tree(items:',
    'Keep Table for a small flat matrix (12 rows or fewer, no buckets).',
    'A bucket longer than 8 rows starts collapsed',
    'team → space → folder → list',
  ]) assert.ok(OMNI_UI_PROMPT.includes(part), part)
})

test('component props accept their documented shapes and reject out-of-bound values', () => {
  assert.equal(schemaOf('Board').safeParse(validBoard).success, true)
  assert.equal(schemaOf('Board').safeParse({ columns: [] }).success, false)
  assert.equal(schemaOf('Board').safeParse({ columns: Array.from({ length: 13 }, (_, index) => ({ title: `c${index}`, rows: [] })) }).success, false)
  assert.equal(schemaOf('Board').safeParse({ columns: [{ title: 'x', rows: Array.from({ length: 51 }, () => 'r') }] }).success, false)
  assert.equal(schemaOf('Board').safeParse({ columns: [{ title: 'x', count: -1, rows: [] }] }).success, false)
  assert.equal(schemaOf('Board').safeParse({ columns: [{ title: text(201), rows: [] }] }).success, false)

  assert.equal(schemaOf('Section').safeParse({ title: 'Recent', children: ['a', 'b'], count: 30 }).success, true)
  assert.equal(schemaOf('Section').safeParse({ title: 'Recent', children: Array.from({ length: 61 }, () => 'r') }).success, false)
  assert.equal(schemaOf('Section').safeParse({ title: 'Recent', children: [], count: 10_001 }).success, false)
  assert.equal(schemaOf('Section').safeParse({ title: text(201), children: [] }).success, false)

  assert.equal(schemaOf('Tree').safeParse(validTree).success, true)
  assert.equal(schemaOf('Tree').safeParse({ items: [] }).success, false)
  assert.equal(schemaOf('Tree').safeParse({ items: Array.from({ length: 21 }, (_, index) => ({ label: `n${index}` })) }).success, false)
  assert.equal(schemaOf('Tree').safeParse({ items: [{ label: 'x', children: Array.from({ length: 21 }, (_, index) => ({ label: `n${index}` })) }] }).success, false)
  assert.equal(schemaOf('Tree').safeParse({ items: [{ label: text(201) }] }).success, false)
  assert.equal(schemaOf('Tree').safeParse({ items: [{ label: 'x', meta: text(81) }] }).success, false)
})

test('the host check accepts a valid canvas and refuses out-of-bound props', () => {
  const valid = `root = Stack([b, s, t])\nb = Board([{title: "To do", count: 2, rows: [x]}])\ns = Section("Recent", [x], 1)\nt = Tree([{label: "Team", children: [{label: "Space"}]}])\nx = Text("a")`
  assert.equal(checkProgram(valid), null)
  // The existing flat matrix still works; the new guidance is for grouped data.
  assert.equal(checkProgram('root = Stack([t])\nt = Table(["Task"], [["Draft"]])'), null)

  const tooManyColumns = `root = Stack([b])\nb = Board([${Array.from({ length: 13 }, (_, index) => `{title: "c${index}", rows: []}`).join(', ')}])`
  assert.match(refusalText(checkProgram(tooManyColumns)), /^Board has an invalid columns: Too big/)

  const tooManyRows = `root = Stack([b])\nb = Board([{title: "c", rows: [${Array.from({ length: 51 }, (_, index) => `"r${index}"`).join(', ')}]}])`
  assert.match(refusalText(checkProgram(tooManyRows)), /^Board has an invalid columns\.0\.rows: Too big/)

  const tooManyChildren = `root = Stack([s])\ns = Section("x", [${Array.from({ length: 61 }, (_, index) => `"r${index}"`).join(', ')}])`
  assert.match(refusalText(checkProgram(tooManyChildren)), /^Section has an invalid children: Too big/)

  const tooManyItems = `root = Stack([t])\nt = Tree([${Array.from({ length: 21 }, (_, index) => `{label: "n${index}"}`).join(', ')}])`
  assert.match(refusalText(checkProgram(tooManyItems)), /^Tree has an invalid items: Too big/)
})

test('every SPECS component has a renderer', () => {
  for (const [name] of SPECS) assert.equal(typeof RENDER[name], 'function', name)
  assert.equal(BOARD_COLLAPSE_AFTER, 8)
})

// A plain-object React stand-in: function components run, host elements stay inspectable.
function render(value) {
  if (Array.isArray(value)) return value.map(render)
  if (value === null || typeof value !== 'object') return value
  if (typeof value.type === 'symbol') return render(value.props?.children)
  const element = typeof value.type === 'function' ? value.type(value.props) : value
  return { ...element, props: { ...element.props, children: render(element.props?.children) } }
}
function everyElement(value, visit) {
  if (Array.isArray(value)) { value.forEach(child => everyElement(child, visit)); return }
  if (value === null || typeof value !== 'object') return
  visit(value)
  everyElement(value.props?.children, visit)
}

test('a board bucket collapses only after eight rows', () => {
  const node = value => ({ type: 'node', props: { name: value.typeName } })
  const board = count => {
    const columns = [{ title: 'Bucket', rows: Array.from({ length: count }, (_, index) => ({ typeName: 'Text', props: { content: `task ${index}` } })) }]
    return render(RENDER.Board({ props: { columns }, renderNode: node }))
  }
  const details = value => {
    const found = []
    everyElement(value, element => { if (element.type === 'details') found.push(element) })
    return found
  }
  assert.equal(details(board(8)).length, 0)
  assert.equal(details(board(9)).length, 1)
})

test('the 82-card ClickUp fixture authors a board, a collapsed section and a hierarchy', () => {
  assert.equal(CLICKUP_TASKS, 82)
  assert.equal(checkProgram(CLICKUP_PROGRAM), null)
  assert.equal(CLICKUP.groups.reduce((sum, group) => sum + group.count, 0), 82)

  const node = value => ({ type: 'node', props: { name: value.typeName } })
  const board = render(RENDER.Board({ props: clickupBoardProps, renderNode: node }))
  const details = []
  everyElement(board, element => { if (element.type === 'details') details.push(element) })
  assert.equal(details.length, CLICKUP.groups.length, 'every bucket over 8 rows starts collapsed')
  for (const detail of details) {
    const summary = detail.props.children[0]
    const badges = []
    everyElement(summary, element => { if (element.type === 'span' && element.props?.className === 'ou-count') badges.push(element) })
    assert.equal(badges.length, 1, 'each bucket keeps its count in the summary')
  }

  const section = render(RENDER.Section({ props: clickupSectionProps, renderNode: node }))
  assert.equal(section.type, 'details')
  const summary = section.props.children[0]
  assert.ok(summary.props.children.some(child => child?.props?.children === CLICKUP.recent.length), 'the section shows its count')

  const tree = render(RENDER.Tree({ props: clickupTreeProps }))
  const labels = []
  everyElement(tree, element => { if (element.type === 'span' && typeof element.props?.children === 'string') labels.push(element.props.children) })
  assert.ok(labels.includes('Acme Inc.'))
  assert.ok(labels.includes('Q4 launch'))
  assert.ok(labels.includes('Launch checklist'))
})
