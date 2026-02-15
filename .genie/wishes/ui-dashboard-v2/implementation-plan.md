# UI Dashboard V2 - Implementation Plan

> Detailed execution plan for the UI Dashboard V2 wish

**Wish:** `.wishes/ui-dashboard-v2/ui-dashboard-v2-wish.md`
**Beads:** omni-2j8
**Created:** 2026-02-05

---

## Current State Analysis

### What Exists (Good Foundation)
- Layout shell with sidebar navigation (6 nav items)
- Auth system (API key based, localStorage)
- Data hooks for instances, chats, events, logs
- Dashboard with stats cards + recent events list
- Instances page with full CRUD + connection actions
- Events page with filters + expandable JSON
- UI components: Button, Card, Badge, Input, Spinner
- Tailwind v4 + OKLCH colors + dark theme
- React Router with all routes configured
- React Query with centralized cache keys

### What's Missing
- Collapsible sidebar
- Status bar footer with service health
- Theme toggle (light mode)
- Infinite scroll (hooks use simple queries)
- Chat view (stub only)
- Users/Contacts pages (don't exist)
- Settings page (stub only)
- Instance detail page (stub only)
- Many UI components (Dialog, Tabs, Select, Progress, Skeleton)

---

## Execution Strategy

Given the scope, I recommend executing in **phases within each group** to have working features incrementally rather than doing all foundation work first.

### Phase Order

```
Phase 1: Core Layout & Theme (Group A partial)
  → Collapsible sidebar, status footer, theme toggle
  → Result: New shell layout visible immediately

Phase 2: Chat View Complete (Group A + B partial)
  → Two-panel chat layout
  → Infinite scroll for messages
  → Message ordering fix
  → Pause/Resume agent feature
  → Result: Fully functional chat experience

Phase 3: Dashboard Enhancement (Group A + B partial)
  → Dashboard tabs (Overview, Instances, System)
  → Infinite scroll for events
  → Instance detail page with tabs
  → Result: Complete dashboard

Phase 4: Users & Contacts (Group C)
  → New /users page with identity management
  → Merge users functionality
  → /contacts page
  → Result: Identity management complete

Phase 5: Settings & Polish (Group C + polish)
  → Enhanced settings with categories
  → Edit modal with history
  → Visual polish pass
  → Result: Feature complete
```

---

## Group A: Layout & Design System

### A1. Collapsible Sidebar (Priority: HIGH)

**Files to modify:**
- `apps/ui/src/components/layout/Sidebar.tsx` - Add collapse state
- `apps/ui/src/components/layout/Shell.tsx` - Handle sidebar width

**Implementation:**
```typescript
// Sidebar.tsx
const [collapsed, setCollapsed] = useState(false);
// - Store in localStorage for persistence
// - Toggle button at bottom
// - When collapsed: show only icons, hide text
// - Hover to reveal tooltips
```

**Components needed:**
- Tooltip component (for collapsed nav items)

**Estimate:** ~50 lines changed

---

### A2. Status Bar Footer (Priority: HIGH)

**Files to create:**
- `apps/ui/src/components/layout/StatusBar.tsx`
- `apps/ui/src/components/layout/ServiceStatus.tsx`

**Implementation:**
```typescript
// StatusBar.tsx - Fixed footer
// - Flex row of ServiceStatus components
// - Right side: time, version

// ServiceStatus.tsx - Single service indicator
// - Props: name, status ('healthy'|'degraded'|'down'), latency?
// - Green/yellow/red dot
// - Latency in parentheses if available
```

**Data source:**
- Use existing `useSystemHealth()` hook
- Add API endpoint if needed for per-service health

**Estimate:** ~80 lines new

---

### A3. Theme System (Priority: HIGH)

**Files to create:**
- `apps/ui/src/context/ThemeContext.tsx`
- `apps/ui/src/components/ui/theme-toggle.tsx`

**Files to modify:**
- `apps/ui/src/index.css` - Add light theme colors
- `apps/ui/src/App.tsx` - Wrap with ThemeProvider
- `apps/ui/src/components/layout/Header.tsx` - Add toggle button

**Implementation:**
```typescript
// ThemeContext.tsx
type Theme = 'light' | 'dark' | 'system';
// - Read from localStorage on mount
// - Apply class to document.documentElement
// - Respect prefers-color-scheme if 'system'

// theme-toggle.tsx
// - Sun/Moon icons
// - Click to cycle: light → dark → system
```

**CSS changes:**
```css
/* index.css - already has dark theme, add light variant */
@theme {
  /* Light theme colors - need to be added */
  --color-background-light: oklch(0.98 0 0);
  --color-foreground-light: oklch(0.15 0 0);
  /* ... */
}
```

**Estimate:** ~120 lines new

---

### A4. UI Components - shadcn-based (Priority: MEDIUM)

**Components to add:**
1. `dialog.tsx` - Modal dialog (Radix Dialog)
2. `tabs.tsx` - Tab navigation (Radix Tabs)
3. `select.tsx` - Dropdown select (Radix Select)
4. `progress.tsx` - Progress bar
5. `skeleton.tsx` - Loading skeleton
6. `empty-state.tsx` - Empty content placeholder
7. `tooltip.tsx` - Hover tooltip (Radix Tooltip)

**Approach:**
- Use shadcn CLI to scaffold where possible
- Adapt for Tailwind v4 (may need manual tweaks)
- Follow existing CVA pattern from button.tsx

**Estimate:** ~400 lines new (across all components)

---

## Group B: Data Layer - Pagination & Search

### B1. Infinite Query Hooks (Priority: HIGH)

**Files to modify:**
- `apps/ui/src/hooks/useChats.ts` - Add `useInfiniteChats`
- `apps/ui/src/hooks/useEvents.ts` - Create with `useInfiniteEvents`
- Add new: `apps/ui/src/hooks/useMessages.ts` - `useInfiniteMessages`

**Implementation pattern:**
```typescript
export function useInfiniteChats(params?: Omit<ListChatsParams, 'cursor'>) {
  return useInfiniteQuery({
    queryKey: queryKeys.chats.list(params),
    queryFn: async ({ pageParam }) => {
      const client = getClient();
      return client.chats.list({ ...params, cursor: pageParam });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.pagination?.hasMore ? lastPage.pagination.cursor : undefined,
  });
}
```

**Estimate:** ~100 lines changed/new

---

### B2. Search Hook with Debounce (Priority: MEDIUM)

**Files to create:**
- `apps/ui/src/hooks/useSearch.ts`
- `apps/ui/src/components/common/SearchInput.tsx`

**Implementation:**
```typescript
// useSearch.ts - Generic debounced search
export function useSearch<T>(
  searchFn: (query: string) => Promise<T>,
  options?: { delay?: number }
) {
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, options?.delay ?? 300);
  // ... useQuery with debouncedQuery
}

// SearchInput.tsx
// - Input with search icon
// - Clear button when has value
// - Loading indicator during search
```

**Estimate:** ~80 lines new

---

### B3. Filter Components (Priority: MEDIUM)

**Files to create:**
- `apps/ui/src/components/common/DateRangePicker.tsx`
- `apps/ui/src/components/common/MultiFilter.tsx`

**Implementation:**
- DateRangePicker: Two date inputs with preset options (Today, This week, etc.)
- MultiFilter: Chip-based multi-select for types, channels, etc.

**Estimate:** ~150 lines new

---

### B4. Chat View Complete (Priority: HIGH)

**Files to modify/create:**
- `apps/ui/src/pages/Chats.tsx` - Two-panel layout
- `apps/ui/src/pages/ChatView.tsx` - Full implementation
- `apps/ui/src/components/chats/ChatList.tsx` - Left panel
- `apps/ui/src/components/chats/ChatListItem.tsx` - Single chat row
- `apps/ui/src/components/chats/ChatPanel.tsx` - Right panel
- `apps/ui/src/components/chats/MessageBubble.tsx` - Message display
- `apps/ui/src/components/chats/MessageInput.tsx` - Send input
- `apps/ui/src/components/chats/ChatHeader.tsx` - With Pause/Resume

**Key features:**
1. Two-panel responsive layout (list | conversation)
2. Chat list with: avatar, name, preview, time, unread badge
3. Message list with: bubbles, timestamps, read status
4. Correct chronological order (reverse API response)
5. Infinite scroll for older messages
6. Message input with send button
7. **Pause/Resume Agent** button in header

**Estimate:** ~500 lines new

---

## Group C: Features - Users, Contacts, Settings

### C1. Users Page (Priority: MEDIUM)

**Files to create:**
- `apps/ui/src/pages/Users.tsx`
- `apps/ui/src/components/users/UserCard.tsx`
- `apps/ui/src/components/users/UserDetailModal.tsx`
- `apps/ui/src/components/users/MergeUsersModal.tsx`
- `apps/ui/src/hooks/useUsers.ts`

**Features:**
1. User list with filters (search, channel, instance)
2. User cards showing: name, channel, message count, last seen
3. "Potential matches" indicator
4. Detail modal with activity stats
5. Merge users dialog for identity linking
6. Delete user action

**API hooks needed:**
```typescript
useUsers(params?)
useUser(id)
useMergeUsers()
useDeleteUser()
```

**Estimate:** ~400 lines new

---

### C2. Contacts Page (Priority: LOW)

**Files to create:**
- `apps/ui/src/pages/Contacts.tsx`
- `apps/ui/src/components/contacts/ContactCard.tsx`
- `apps/ui/src/components/contacts/ContactFilters.tsx`

**Features:**
1. Contact cards grid
2. Filter bar (instance, search, status)
3. Basic contact info display

**Note:** This is simpler than Users - mainly display, no complex actions.

**Estimate:** ~150 lines new

---

### C3. Settings Page Enhanced (Priority: MEDIUM)

**Files to modify/create:**
- `apps/ui/src/pages/Settings.tsx` - Full implementation
- `apps/ui/src/components/settings/SettingRow.tsx`
- `apps/ui/src/components/settings/SettingCategory.tsx`
- `apps/ui/src/components/settings/EditSettingModal.tsx`
- `apps/ui/src/components/settings/SettingHistory.tsx`
- `apps/ui/src/hooks/useSettings.ts`

**Features:**
1. Settings grouped by category
2. Each setting: label, value (masked if secret), edit button
3. Edit modal with change reason
4. History view per setting

**Estimate:** ~300 lines new

---

### C4. Instance Detail Page (Priority: MEDIUM)

**Files to modify:**
- `apps/ui/src/pages/InstanceDetail.tsx` - Full implementation

**Features (5 tabs like v1):**
1. **Connection**: Profile, QR code, Restart/Logout
2. **Agent**: AI configuration (if applicable)
3. **Messages**: Debounce settings
4. **Behavior**: Toggle switches
5. **Webhooks**: Integration info

**Estimate:** ~350 lines new

---

## Dependency Order

```
1. ThemeContext (no deps)
2. UI Components: Tooltip, Dialog, Tabs, Select, Progress, Skeleton
3. Collapsible Sidebar (needs Tooltip)
4. Status Bar Footer (no deps)
5. Infinite Query Hooks (no deps)
6. SearchInput (no deps)
7. Chat components (needs infinite hooks)
8. Dashboard tabs (needs Tabs component)
9. Users page (needs Dialog, infinite hooks)
10. Settings page (needs Dialog)
11. Instance Detail (needs Tabs)
12. Contacts page (simplest, last)
```

---

## Estimated Effort

| Group | Component | New Lines | Modified Lines |
|-------|-----------|-----------|----------------|
| A | Collapsible Sidebar | 30 | 40 |
| A | Status Bar | 80 | 10 |
| A | Theme System | 120 | 30 |
| A | UI Components | 400 | 0 |
| B | Infinite Hooks | 60 | 40 |
| B | Search Hook | 80 | 0 |
| B | Filters | 150 | 0 |
| B | Chat View | 500 | 50 |
| C | Users Page | 400 | 0 |
| C | Contacts Page | 150 | 0 |
| C | Settings Page | 300 | 20 |
| C | Instance Detail | 350 | 0 |
| **Total** | | **~2,620** | **~190** |

---

## Risk Mitigation

### RISK-1: shadcn + Tailwind v4
- **Mitigation:** Test each shadcn component individually
- **Fallback:** Write components from scratch using Radix primitives

### RISK-2: Infinite scroll performance
- **Mitigation:** Keep initial page size at 50
- **Fallback:** Add react-virtual later if needed

### RISK-3: Theme toggle CSS conflicts
- **Mitigation:** Use CSS custom properties throughout
- **Test:** Both themes before moving on

---

## Validation Checkpoints

After each phase, verify:

1. **Phase 1 (Layout):**
   - [ ] Sidebar collapses/expands
   - [ ] Theme toggle persists
   - [ ] Status footer shows service health

2. **Phase 2 (Chat):**
   - [ ] Chat list loads with infinite scroll
   - [ ] Messages in correct order (oldest first)
   - [ ] Can send messages
   - [ ] Pause/Resume agent works

3. **Phase 3 (Dashboard):**
   - [ ] Dashboard tabs work
   - [ ] Events infinite scroll
   - [ ] Instance detail tabs work

4. **Phase 4 (Users):**
   - [ ] Users page shows list
   - [ ] Can view user detail
   - [ ] Merge users works

5. **Phase 5 (Settings):**
   - [ ] Settings by category
   - [ ] Edit setting works
   - [ ] History shows changes

---

## Ready to Execute

This plan is ready for `/forge` execution. Recommend:
- **Inline mode** for Phase 1-2 (core functionality)
- **Spawn mode** for Phase 3-5 if time constrained

Run `make check` after each phase to catch issues early.
