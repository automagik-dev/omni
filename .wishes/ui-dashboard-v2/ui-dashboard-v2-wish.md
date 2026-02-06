# WISH: UI Dashboard V2

> Complete redesign with proper UX, infinite scroll, message ordering, contact linking, and modern visual design.

**Status:** DRAFT
**Created:** 2026-02-05
**Author:** WISH Agent
**Beads:** omni-2j8

---

## Problem Statement

The current UI is a bare-bones functional prototype:

1. **Data limits** - Hardcoded `limit: 10` or `limit: 50`, no pagination/infinite scroll
2. **Message ordering** - Messages displayed in wrong order (API returns newest-first, UI renders as-is)
3. **Visual design** - Dark theme only, minimal styling, no visual hierarchy
4. **Missing features** - No contact linking, no filters, no search, no configurations
5. **No theme toggle** - Users stuck with dark-only theme

The API has rich capabilities that the UI doesn't expose:
- Cursor-based pagination with `hasMore` indicator
- Full-text search across messages
- Advanced filtering (date ranges, message types, channels)
- Person/identity linking and cross-channel presence
- Settings management with history

---

## Target Users

Multi-purpose dashboard serving:
1. **Developers** - Debugging integrations, viewing raw events, testing channels
2. **Operations** - Monitoring conversations, managing contacts
3. **Admins** - Configuring channels, managing settings

---

## Assumptions

- **ASM-1**: Users prefer infinite scroll over traditional pagination for messages/events
- **ASM-2**: Theme preference should persist in localStorage
- **ASM-3**: Contact linking is a power-user feature (not prominent in main flow)
- **ASM-4**: Real-time updates can be polling-based initially (no WebSocket requirement)

---

## Decisions

- **DEC-1**: Use shadcn/ui components for consistent design system
- **DEC-2**: Theme toggle with light/dark modes (persist to localStorage)
- **DEC-3**: Infinite scroll for lists (messages, events, chats)
- **DEC-4**: Use react-query's `useInfiniteQuery` for pagination
- **DEC-5**: Reverse message order in ChatView (oldest first, newest at bottom)
- **DEC-6**: Adopt v1 layout structure (collapsible sidebar, status footer, tab navigation)
- **DEC-7**: Keep v1 color scheme (purple accent, status colors green/yellow/red)
- **DEC-8**: Two-panel chat layout (list + conversation)

---

## Risks

- **RISK-1**: shadcn/ui + Tailwind v4 compatibility issues
  - *Mitigation*: Test each component, adapt styles manually if needed
- **RISK-2**: Infinite scroll performance with large datasets
  - *Mitigation*: Virtual scrolling (react-virtual) if needed in phase 2
- **RISK-3**: Search debouncing and UX
  - *Mitigation*: 300ms debounce, loading indicators, optimistic UI

---

## Scope

### IN SCOPE

1. **Layout (v1 Style)**
   - Collapsible sidebar with navigation and instances list
   - Status bar footer with service health indicators
   - Tab-based dashboard (Overview, Messages, Instances, System, Logs, Manage)
   - Two-panel chat layout

2. **Theme System**
   - Light/dark toggle with localStorage persistence
   - v1 color scheme (purple accent, status colors)
   - Consistent color tokens across all components

3. **Dashboard Tabs**
   - **Overview**: Stats cards, instance summaries, recent events
   - **Messages**: Message type breakdown, error stages (charts optional)
   - **Instances**: Instance details with metrics
   - **System**: Server overview (RAM/CPU/Disk/Load), service health cards, DB pool
   - **Logs**: Real-time log stream with filters (can be simplified)
   - **Manage**: Instance settings toggles, API keys, restart/logout

4. **Pagination/Infinite Scroll**
   - Convert all lists to use `useInfiniteQuery`
   - "Load more" button or infinite scroll trigger
   - Proper loading states

5. **Chat View (v1 Style)**
   - Two-panel layout (list + conversation)
   - Chat list with avatar, name, date, preview, unread badge
   - Conversation view with message bubbles
   - Message input with emoji, attachment, send
   - Correct chronological order (oldest first)

6. **Search & Filters**
   - Search in chats, contacts, events
   - Instance filter dropdown
   - Date range filters for events
   - Status filters for contacts

7. **Contact/Person View**
   - `/contacts` page with filter bar (Instance, Search, Status)
   - Contact cards grid with avatars
   - Person detail with cross-channel identities
   - Link/unlink identities UI

8. **Settings & Instance Management**
   - Instance settings toggles (Auto-read, Always online, etc.)
   - API key display (masked with reveal)
   - Restart/Logout actions
   - System settings with history

9. **Visual Polish**
   - v1-style cards, spacing, typography
   - Status indicators (green/yellow/red dots)
   - Progress bars for metrics
   - Loading skeletons
   - Empty states

### OUT OF SCOPE

- Real-time WebSocket updates (polling is fine for now)
- Virtual scrolling (defer until performance issues arise)
- Drag-and-drop file upload
- Keyboard shortcuts
- Mobile-responsive design (desktop-first)
- Message editing/deletion
- i18n/translations

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| apps/ui | [x] components, [x] pages, [x] hooks | Primary work |
| sdk | [ ] no changes | Already supports all needed endpoints |
| api | [ ] no changes | API is feature-complete |
| core | [ ] no changes | No schema changes needed |

### System Checklist

- [ ] **Events**: No changes
- [ ] **Database**: No changes
- [ ] **SDK**: No changes (already generated)
- [ ] **CLI**: No changes
- [ ] **Tests**: UI component tests (optional in this phase)

---

## Execution Groups

### Group A: Layout & Design System

**Goal:** Establish v1-style layout structure with theme toggle and polished components

**Packages:** apps/ui

**Deliverables:**
- [ ] **Layout Components (v1 style)**
  - Collapsible sidebar with: Logo, nav items, instances list, logout
  - Status bar footer with service health indicators
  - Two-panel layout component for chat view
- [ ] **Theme System**
  - Theme context with light/dark toggle
  - Theme toggle button in header
  - localStorage persistence for theme preference
  - Update index.css with v1 color scheme (purple accent, status colors)
- [ ] **UI Components (shadcn-based)**
  - Tabs component (for dashboard sections)
  - Select/Dropdown component
  - Dialog/Modal component
  - Skeleton loading states
  - Empty state component
  - Status badge component (health indicators)
  - Progress bar component (for metrics)

**Acceptance Criteria:**
- [ ] Sidebar collapses/expands correctly
- [ ] Status footer shows service health (can be mocked initially)
- [ ] Theme toggle works and persists across page refresh
- [ ] Both themes have proper contrast and readability
- [ ] All components match v1 visual style

**Validation:**
- Compare side-by-side with v1 screenshots
- Manual testing of theme toggle and sidebar

---

### Group B: Data Layer - Pagination & Search

**Goal:** Implement proper data fetching with infinite scroll and search

**Packages:** apps/ui

**Deliverables:**
- [ ] Convert hooks to use `useInfiniteQuery`:
  - `useChats` with infinite scroll
  - `useEvents` with infinite scroll
  - `useMessages` with infinite scroll
- [ ] Search hook with debouncing (`useSearch`)
- [ ] Date range filter component
- [ ] Multi-select filter component (for channels, message types)
- [ ] Update pages:
  - Dashboard: Show more than 10 events with "View all" link
  - Chats: Infinite scroll, search bar, filters
  - Events: Infinite scroll, date range, type filters
  - ChatView: Load more messages, correct ordering

**Acceptance Criteria:**
- [ ] Can scroll/load beyond initial 50 items
- [ ] Search works with debounce (no excessive API calls)
- [ ] Filters combine correctly (AND logic)
- [ ] Message order is oldest-first in chat view

**Validation:**
- Test with chat containing 100+ messages
- Verify network tab shows cursor-based pagination
- Check message timestamps are ascending

---

### Group C: Features - Contacts & Settings

**Goal:** Add contact management and settings configuration

**Packages:** apps/ui

**Deliverables:**
- [ ] New `/contacts` page:
  - List all persons with search
  - Show identity count per person
- [ ] Person detail view (`/contacts/:id`):
  - Person info (name, avatar)
  - List of identities by channel
  - Cross-channel timeline
  - Link/unlink identity actions
- [ ] Enhanced Settings page:
  - List settings by category
  - Edit setting modal with change reason
  - View history for each setting
- [ ] Add Contacts to sidebar navigation

**Acceptance Criteria:**
- [ ] Can view all contacts with pagination
- [ ] Can see person's identities across channels
- [ ] Can edit system settings with change reason
- [ ] Settings show masked values for secrets

**Validation:**
- Create test person with multiple identities
- Edit a setting and verify history shows change

---

## Component Breakdown

### New Components

```
components/
├── layout/
│   ├── Sidebar.tsx           # v1-style collapsible sidebar
│   ├── SidebarNav.tsx        # Navigation items with icons
│   ├── SidebarInstances.tsx  # Expandable instances list
│   ├── StatusBar.tsx         # v1-style footer with service health
│   ├── ServiceStatus.tsx     # Individual service indicator
│   ├── Shell.tsx             # Main app shell (sidebar + content + statusbar)
│   └── Header.tsx            # Page header with actions
├── ui/
│   ├── theme-toggle.tsx      # Light/dark toggle button (sun/moon icon)
│   ├── skeleton.tsx          # Loading skeleton
│   ├── empty-state.tsx       # Empty state with icon/message
│   ├── select.tsx            # Better dropdown select
│   ├── dialog.tsx            # Modal dialog
│   ├── tabs.tsx              # Tab navigation (v1-style with icons)
│   ├── date-picker.tsx       # Date range picker
│   ├── progress.tsx          # Progress bar (for metrics)
│   └── status-badge.tsx      # Health status badge (green/yellow/red)
├── common/
│   ├── infinite-scroll.tsx   # Scroll trigger component
│   ├── search-input.tsx      # Debounced search input
│   └── multi-filter.tsx      # Multi-select filter chips
├── dashboard/
│   ├── StatsCard.tsx         # Metric card (Total Messages, etc.)
│   ├── InstanceCard.tsx      # Instance with metrics
│   ├── SystemMetrics.tsx     # RAM/CPU/Disk/Load/Uptime
│   ├── ServiceCard.tsx       # Service health with memory/cpu/uptime
│   └── DbPoolStatus.tsx      # Database connection pool
├── chats/
│   ├── ChatList.tsx          # Left panel chat list
│   ├── ChatListItem.tsx      # Single chat with avatar/preview
│   ├── ChatPanel.tsx         # Right panel conversation
│   ├── MessageBubble.tsx     # Message with timestamp/status
│   └── MessageInput.tsx      # Input with emoji/attach/send
├── contacts/
│   ├── ContactCard.tsx       # Contact card with avatar
│   ├── ContactFilters.tsx    # Instance/Search/Status filters
│   ├── IdentityList.tsx      # List of identities by channel
│   └── LinkIdentityModal.tsx # Link identity dialog
└── settings/
    ├── SettingRow.tsx        # Single setting with toggle/value
    ├── EditSettingModal.tsx  # Edit setting form
    └── SettingHistory.tsx    # History timeline
```

### New Hooks

```typescript
// hooks/useInfiniteChats.ts
export function useInfiniteChats(params: Omit<ListChatsParams, 'cursor'>)

// hooks/useInfiniteEvents.ts
export function useInfiniteEvents(params: Omit<ListEventsParams, 'cursor'>)

// hooks/useInfiniteMessages.ts
export function useInfiniteChatMessages(chatId: string, params?: { limit?: number })

// hooks/usePersons.ts
export function usePersons(params?: ListPersonsParams)
export function usePersonPresence(id: string)
export function usePersonTimeline(id: string)

// hooks/useSettings.ts
export function useSettings(category?: string)
export function useSettingHistory(key: string)
export function useUpdateSetting()

// hooks/useSearch.ts
export function useSearch<T>(searchFn: (query: string) => Promise<T>, delay?: number)

// context/ThemeContext.tsx
export function useTheme(): { theme: 'light' | 'dark', toggle: () => void }
```

---

## UI Mockups (Text-Based)

### Theme Toggle (Header)
```
┌─────────────────────────────────────────────────────┐
│  Omni  │ Dashboard  Chats  Events  ...  │ [☀️/🌙] │
└─────────────────────────────────────────────────────┘
```

### Chats List with Filters
```
┌─────────────────────────────────────────────────────┐
│ Chats                                               │
├─────────────────────────────────────────────────────┤
│ [🔍 Search...         ] [Instance ▼] [Type ▼]      │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │ 👤 John Doe           whatsapp  ·  2m ago       │ │
│ │    Last message preview...                      │ │
│ └─────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────┐ │
│ │ 👥 Team Chat          discord   ·  5m ago       │ │
│ │    Latest activity in the group...              │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│              [Loading more...]                      │
└─────────────────────────────────────────────────────┘
```

### Contact Detail
```
┌─────────────────────────────────────────────────────┐
│ ← Back                                              │
├─────────────────────────────────────────────────────┤
│      👤                                             │
│   John Doe                                          │
│   john@email.com · +1234567890                      │
├─────────────────────────────────────────────────────┤
│ Identities                          [+ Link New]   │
├─────────────────────────────────────────────────────┤
│ WhatsApp │ +1234567890   │ 142 messages │ 2h ago   │
│ Discord  │ john#1234     │ 38 messages  │ 1d ago   │
│ Slack    │ @johndoe      │ 5 messages   │ 3d ago   │
├─────────────────────────────────────────────────────┤
│ Timeline                                            │
├─────────────────────────────────────────────────────┤
│ • 2h ago  WhatsApp  Message received               │
│ • 1d ago  Discord   Joined server                  │
│ • 3d ago  Slack     First message                  │
└─────────────────────────────────────────────────────┘
```

---

## Open Questions

1. **Virtual scrolling**: Should we implement react-virtual now or wait for performance issues?
   - *Recommendation*: Wait - premature optimization

2. **Real-time updates**: Polling interval for dashboard stats?
   - *Recommendation*: 30 seconds for dashboard, manual refresh elsewhere

3. **shadcn components**: Which ones to port vs. write from scratch?
   - *Recommendation*: Start with shadcn CLI, adapt for Tailwind v4

---

## Success Metrics

- [ ] All pages have working pagination (can load 100+ items)
- [ ] Theme toggle works with persistence
- [ ] Message order is correct in chat view
- [ ] Can search chats and events
- [ ] Can view and edit settings
- [ ] New contacts page is functional

---

## Dependencies

- **UI Foundation wish** (SHIPPED) - provides Vite, Tailwind v4, SDK integration
- No external API changes needed

---

## Design Reference: Omni v1

Based on analysis of the production v1 UI at `omni-sampaio.namastex.io`, we'll adopt these patterns:

### Layout Structure (KEEP)

1. **Collapsible Sidebar Navigation**
   - Logo at top
   - Navigation items with icons
   - Instances section (expandable, shows individual instances with status dots)
   - Items: Dashboard, Instances, Chats, Contacts, Settings
   - Logout at bottom

2. **Status Bar Footer**
   - Fixed at bottom
   - Service health indicators: Gateway, API, Database, WhatsApp Web, Discord
   - Green/yellow/red status dots
   - Response times in parentheses
   - Current time and version

3. **Dashboard Tab Navigation**
   - Overview, Messages, Instances, System, Logs, Manage
   - Horizontal tabs below header
   - Each tab has icon + label

4. **Two-Panel Chat Layout**
   - Left: Chat list with search, avatar, name, date, last message preview, unread badge
   - Right: Conversation with header, messages, input area
   - Resizable separator

### Visual Design (KEEP)

1. **Color Scheme**
   - Dark theme: Deep navy/black background (`oklch(0.145 0 0)`)
   - Purple accent color for CTAs (`oklch(0.546 0.245 262.881)`)
   - Green for healthy/connected status
   - Yellow for warning/connecting
   - Red for error/disconnected

2. **Cards & Containers**
   - Subtle borders, slightly elevated backgrounds
   - Rounded corners (8px)
   - Consistent padding

3. **Status Indicators**
   - Colored dots (green/yellow/red) for health
   - Progress bars for metrics (RAM, CPU, Disk)
   - Badges for counts and tags

4. **Typography**
   - Clean sans-serif (Inter)
   - Clear hierarchy: headings, subheadings, body, captions
   - Monospace for IDs and technical values

### Key Pages (Reference Screenshots)

| Page | Key Elements |
|------|-------------|
| Dashboard Overview | Stats cards (4-grid), Instance sections by channel, Recent events |
| Dashboard System | Server overview (RAM/CPU/Disk/Load/Uptime), Service cards with health, DB pool |
| Dashboard Manage | Instance cards with settings toggles, API keys, Restart/Logout |
| Chats | Two-panel layout, search, instance filter, message bubbles |
| Contacts | Filter bar (Instance, Search, Status), Contact cards grid with avatars |

### Features to Replicate

1. **Instance Management**
   - Per-instance settings (Auto-read, Always online, Reject calls, Ignore groups, Full sync)
   - Restart/Logout actions
   - API key display (masked with reveal)

2. **System Monitoring**
   - Server metrics (RAM, CPU, Disk, Load Average, Uptime)
   - Service health cards with memory, CPU, PID, uptime
   - Database connection pool stats

3. **Real-time Log Streaming**
   - Service filter checkboxes
   - Log level dropdown
   - Auto-scroll toggle
   - Connection status indicator

### v1 Screenshots (for reference)

Screenshots captured during analysis:
- `v1-dashboard-overview.png` - Main dashboard with stats
- `v1-instances.png` - Instance details tab
- `v1-manage.png` - WhatsApp management with settings
- `v1-system.png` - System monitoring
- `v1-sidebar.png` - Navigation sidebar
- `v1-chats-list.png` - Chat list view
- `v1-chat-view.png` - Conversation view
- `v1-contacts.png` - Contacts page

---

## Notes

The API already supports everything we need. This is purely a UI effort to surface existing capabilities:

| Feature | API Support | Current UI | Target UI |
|---------|-------------|------------|-----------|
| Pagination | Cursor-based with hasMore | limit=50, no more | Infinite scroll |
| Search | Full-text on multiple fields | Basic input | Debounced with filters |
| Filters | Date range, types, channels | Instance only | Full filter bar |
| Contacts | Person CRUD, identity linking | None | Full contacts page |
| Settings | CRUD with history | List only | Edit + history |
| Theme | N/A | Dark only | Light/dark toggle |
