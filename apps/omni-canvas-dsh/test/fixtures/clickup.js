// A realistic ClickUp result: the 82-card query from the report, bucketed by status, with
// the hierarchy the connector's list_spaces/list_folders/list_lists actions return. The
// authored program uses Board for the buckets, Section for the long recent list and Tree
// for discovery; the props below drive the renderer test with the same data.
const GROUPS = [
  {
    title: 'To do',
    count: 31,
    tasks: [
      'Draft Q4 launch brief',
      'Collect pricing approvals',
      'Confirm launch date with support',
      'Book customer webinar',
      'Write release notes',
      'Prepare partner enablement deck',
      'Review legal copy for the landing page',
      'Schedule customer interviews',
      'Refresh the pricing page screenshots',
      'Draft the launch email sequence',
      'Localize onboarding copy',
      'Audit analytics events for signup',
      'Plan the in-app announcement',
      'Collect product screenshots from design',
      'Update the help center index',
      'Draft the changelog entry',
      'Set up the launch dashboard',
      'Confirm the rollback plan',
      'Review accessibility on the new flow',
      'Prepare the sales FAQ',
      'Book the launch review meeting',
      'Check billing proration for upgrades',
      'Draft the status page note',
      'Confirm the support rotation',
      'Review the migration checklist',
      'Prepare the customer health report',
      'Update the onboarding checklist',
      'Draft the partner co-marketing brief',
      'Confirm the press embargo',
      'Review the API deprecation notice',
      'Collect final design sign-off',
    ],
  },
  {
    title: 'In progress',
    count: 14,
    tasks: [
      'Build the onboarding flow',
      'Migrate the billing webhook',
      'Tune the search ranking',
      'Add the usage chart to settings',
      'Write the migration runbook',
      'Fix the duplicate notification',
      'Add the new trial banner',
      'Instrument the checkout funnel',
      'Review the data retention policy',
      'Update the admin permissions screen',
      'Test the invite flow in staging',
      'Add the audit log export',
      'Polish the empty states',
      'Review the mobile layout',
    ],
  },
  {
    title: 'Review',
    count: 9,
    tasks: [
      'Review the API pagination change',
      'Review the SSO callback fix',
      'Review the pricing experiment copy',
      'Review the new onboarding email',
      'Review the webhook retry logic',
      'Review the admin audit trail',
      'Review the launch checklist',
      'Review the support macros',
      'Review the status page template',
    ],
  },
  {
    title: 'Complete',
    count: 28,
    tasks: [
      'Ship the audit log filters',
      'Publish the API changelog',
      'Update the SSO documentation',
      'Fix the timezone display bug',
      'Add the workspace switcher',
      'Ship the new billing portal',
      'Improve the invite acceptance flow',
      'Add the notification preferences page',
      'Ship the usage export',
      'Update the security page',
      'Add the team roles matrix',
      'Ship the mobile navigation update',
      'Publish the migration guide',
      'Add the health check endpoint',
      'Ship the new error page',
      'Update the support handoff',
      'Add the invoice download link',
      'Ship the dashboard filters',
      'Publish the pricing FAQ',
      'Fix the duplicate session alert',
      'Add the data export queue',
      'Ship the updated onboarding checklist',
      'Fix the webhook signature check',
      'Add the workspace deletion guard',
      'Ship the new search empty state',
      'Update the release checklist',
      'Add the usage limit warning',
      'Publish the Q4 roadmap',
    ],
  },
]

const RECENT = [
  'Customer note from Acme',
  'Design review moved to Friday',
  'Launch checklist updated',
  'Pricing approval received',
  'Support rotation confirmed',
  'Webinar registration opened',
  'Release notes shared for review',
  'Mobile layout approved',
  'Status page note scheduled',
]

const HIERARCHY = [
  {
    label: 'Acme Inc.',
    meta: 'team',
    children: [
      {
        label: 'Product',
        meta: 'space',
        children: [
          {
            label: 'Q4 launch',
            meta: 'folder',
            children: [
              { label: 'Launch checklist', meta: 'list' },
              { label: 'Assets', meta: 'list' },
              { label: 'QA', meta: 'list' },
            ],
          },
          {
            label: 'Roadmap',
            meta: 'folder',
            children: [{ label: 'Now / Next / Later', meta: 'list' }],
          },
        ],
      },
      {
        label: 'Marketing',
        meta: 'space',
        children: [
          {
            label: 'Campaigns',
            meta: 'folder',
            children: [{ label: 'Launch email', meta: 'list' }],
          },
        ],
      },
    ],
  },
]

export const CLICKUP = { title: 'ClickUp: Q4 launch', groups: GROUPS, recent: RECENT, hierarchy: HIERARCHY }
export const CLICKUP_TASKS = GROUPS.reduce((sum, group) => sum + group.tasks.length, 0)

const taskVar = (group, task) => `t${group}_${task}`
const taskNodes = GROUPS.flatMap((group, groupIndex) => group.tasks.map((task, taskIndex) => ({ typeName: 'Text', props: { content: task }, name: taskVar(groupIndex, taskIndex) })))

export const clickupBoardProps = {
  title: CLICKUP.title,
  columns: GROUPS.map((group, groupIndex) => ({
    title: group.title,
    count: group.count,
    rows: group.tasks.map((_, taskIndex) => ({ typeName: 'Text', props: { content: GROUPS[groupIndex].tasks[taskIndex] } })),
  })),
}

export const clickupSectionProps = {
  title: 'Recently updated',
  count: RECENT.length,
  children: RECENT.map(content => ({ typeName: 'Text', props: { content } })),
}

export const clickupTreeProps = { title: 'ClickUp structure', items: HIERARCHY }

const boardColumns = GROUPS.map((group, groupIndex) => `{title: ${JSON.stringify(group.title)}, count: ${group.count}, rows: [${group.tasks.map((_, taskIndex) => taskVar(groupIndex, taskIndex)).join(', ')}]}`).join(', ')
const recentRows = RECENT.map((_, index) => `r${index}`).join(', ')

export const CLICKUP_PROGRAM = [
  'root = Stack([heading, stats, board, recent, tree])',
  `heading = Heading(${JSON.stringify(CLICKUP.title)})`,
  'stats = Row([Stat("Total tasks", 82), Stat("In progress", 14), Stat("Complete", 28)])',
  `board = Board([${boardColumns}], "Tasks by status")`,
  `recent = Section("Recently updated", [${recentRows}], ${RECENT.length})`,
  `tree = Tree([{label: "Acme Inc.", meta: "team", children: [{label: "Product", meta: "space", children: [{label: "Q4 launch", meta: "folder", children: [{label: "Launch checklist", meta: "list"}, {label: "Assets", meta: "list"}, {label: "QA", meta: "list"}]}, {label: "Roadmap", meta: "folder", children: [{label: "Now / Next / Later", meta: "list"}]}]}, {label: "Marketing", meta: "space", children: [{label: "Campaigns", meta: "folder", children: [{label: "Launch email", meta: "list"}]}]}]}], "ClickUp structure")`,
  ...taskNodes.map(node => `${node.name} = Text(${JSON.stringify(node.props.content)})`),
  ...RECENT.map((content, index) => `r${index} = Text(${JSON.stringify(content)})`),
].join('\n')
