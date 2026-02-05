# WISH: UI Foundation

> Fresh admin dashboard for V2 using TypeScript SDK.

**Status:** DRAFT
**Created:** 2026-02-04
**Updated:** 2026-02-05
**Author:** WISH Agent
**Beads:** omni-0yx
**Priority:** P1

---

## Context

V2 needs an admin dashboard built from scratch - not a port of V1. The UI will use the TypeScript SDK (`@omni/sdk`) for all API interactions, providing type-safety end-to-end.

**Key decisions:**
- Fresh build, not V1 copy
- Use `@omni/sdk` instead of raw fetch
- Ops-focused: logs, service management, monitoring
- Messaging: instances, chats, messages, events

**Tech Stack:**
- React 18 + TypeScript
- Vite (build tool)
- Tailwind CSS + shadcn/ui
- TanStack Query (data fetching with SDK)
- React Router v6

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | SDK has all necessary methods |
| **ASM-2** | Assumption | API supports log streaming |
| **DEC-1** | Decision | Fresh UI, not V1 port |
| **DEC-2** | Decision | Use @omni/sdk for all API calls |
| **DEC-3** | Decision | Include ops/admin features (logs, service mgmt) |

---

## Scope

### IN SCOPE

#### 1. Core Messaging
- **Instances**: List, create, edit, delete, connect/disconnect, QR code
- **Chats**: List conversations, view messages, search
- **Messages**: Send text/media, view history
- **Contacts/Persons**: List, search, view details

#### 2. Ops & Admin
- **Logs Viewer**: Real-time logs from API, WhatsApp, Discord (filterable by source, level)
- **Instance Management**: Restart instance, logout, view status
- **Service Management**: Restart API service, health check, system status
- **Events**: Query event stream with filters

#### 3. Configuration
- **Settings**: System settings management
- **API Keys**: View/manage API keys (if exposed)

#### 4. Infrastructure
- **Authentication**: API key login, session management
- **SDK Integration**: TanStack Query + SDK pattern
- **Build**: Vite production build, static serving

### OUT OF SCOPE

- Real-time WebSocket updates (use polling/refetch initially)
- Mobile-first design (desktop admin focus)
- V1 feature parity (only what V2 needs)
- User management (single admin for now)

---

## Impact Analysis

### Packages Affected

| Package | Changes | Notes |
|---------|---------|-------|
| apps/ui | New package | Fresh React app |
| api | Static serving | Serve UI dist |
| sdk | Consumer | UI uses SDK |

---

## Technical Design

### Directory Structure

```
apps/
└── ui/
    ├── src/
    │   ├── components/
    │   │   ├── ui/           # shadcn components
    │   │   ├── layout/       # Shell, Sidebar, Header
    │   │   ├── instances/    # Instance-related components
    │   │   ├── chats/        # Chat components
    │   │   ├── logs/         # Log viewer components
    │   │   └── common/       # Shared components
    │   ├── pages/
    │   │   ├── Dashboard.tsx
    │   │   ├── Instances.tsx
    │   │   ├── InstanceDetail.tsx
    │   │   ├── Chats.tsx
    │   │   ├── ChatView.tsx
    │   │   ├── Events.tsx
    │   │   ├── Logs.tsx
    │   │   ├── Settings.tsx
    │   │   └── Login.tsx
    │   ├── hooks/
    │   │   ├── useInstances.ts
    │   │   ├── useChats.ts
    │   │   ├── useLogs.ts
    │   │   └── useAuth.ts
    │   ├── lib/
    │   │   ├── sdk.ts        # SDK client singleton
    │   │   ├── query.ts      # TanStack Query config
    │   │   └── utils.ts
    │   ├── App.tsx
    │   └── main.tsx
    ├── index.html
    ├── vite.config.ts
    ├── tailwind.config.js
    ├── tsconfig.json
    └── package.json
```

### SDK Integration Pattern

```typescript
// src/lib/sdk.ts
import { OmniClient } from '@omni/sdk';

let client: OmniClient | null = null;

export function getClient(): OmniClient {
  if (!client) {
    const apiKey = localStorage.getItem('apiKey');
    if (!apiKey) throw new Error('Not authenticated');

    client = new OmniClient({
      baseUrl: import.meta.env.VITE_API_URL || '/api/v2',
      apiKey,
    });
  }
  return client;
}

export function setApiKey(apiKey: string) {
  localStorage.setItem('apiKey', apiKey);
  client = null; // Reset to recreate with new key
}
```

### TanStack Query + SDK

```typescript
// src/hooks/useInstances.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getClient } from '../lib/sdk';

export function useInstances() {
  return useQuery({
    queryKey: ['instances'],
    queryFn: () => getClient().instances.list(),
  });
}

export function useInstance(id: string) {
  return useQuery({
    queryKey: ['instances', id],
    queryFn: () => getClient().instances.get(id),
  });
}

export function useCreateInstance() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateInstanceInput) =>
      getClient().instances.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['instances'] });
    },
  });
}

export function useRestartInstance() {
  return useMutation({
    mutationFn: (id: string) => getClient().instances.restart(id),
  });
}
```

### Logs Viewer

```typescript
// src/hooks/useLogs.ts
import { useQuery } from '@tanstack/react-query';
import { getClient } from '../lib/sdk';

interface LogFilter {
  source?: 'api' | 'whatsapp' | 'discord' | 'all';
  level?: 'debug' | 'info' | 'warn' | 'error';
  instanceId?: string;
  since?: Date;
  limit?: number;
}

export function useLogs(filter: LogFilter) {
  return useQuery({
    queryKey: ['logs', filter],
    queryFn: () => getClient().logs.list(filter),
    refetchInterval: 5000, // Poll every 5s for new logs
  });
}
```

### Service Management

```typescript
// src/hooks/useService.ts
import { useQuery, useMutation } from '@tanstack/react-query';
import { getClient } from '../lib/sdk';

export function useServiceStatus() {
  return useQuery({
    queryKey: ['service', 'status'],
    queryFn: () => getClient().status.get(),
    refetchInterval: 10000,
  });
}

export function useRestartService() {
  return useMutation({
    mutationFn: () => getClient().admin.restartService(),
  });
}
```

---

## UI Pages

### Dashboard
- Instance status cards (connected/disconnected count)
- Recent events feed
- System health indicators
- Quick actions (restart service, view logs)

### Instances
- Table with: name, channel, status, last connected
- Actions: connect, disconnect, restart, delete
- Create instance modal
- QR code display for WhatsApp pairing

### Instance Detail
- Configuration form
- Connection status with QR
- Instance-specific logs
- Actions: restart, logout, delete

### Chats
- Chat list (filterable by instance)
- Chat detail with message history
- Send message form
- Contact info sidebar

### Logs
- Real-time log stream
- Filters: source (API/WhatsApp/Discord), level, instance
- Search within logs
- Export logs

### Events
- Event stream with filters
- Event type filter
- Instance filter
- Date range picker
- Event detail modal

### Settings
- System configuration
- API key display (masked)
- Service controls

---

## Execution Group A: Project Setup

**Goal:** Create fresh React app with SDK integration.

**Deliverables:**
- [ ] Create `apps/ui/` with Vite + React + TypeScript
- [ ] Install dependencies (tailwind, shadcn, tanstack-query)
- [ ] Configure SDK integration (`lib/sdk.ts`)
- [ ] Setup TanStack Query provider
- [ ] Create app shell with sidebar navigation
- [ ] Implement auth flow (API key login)

**Acceptance Criteria:**
- [ ] `bun run dev` starts UI on port 5173
- [ ] SDK client connects to API
- [ ] Login with API key works

---

## Execution Group B: Instance Management

**Goal:** Full instance CRUD and management.

**Deliverables:**
- [ ] Instances list page with table
- [ ] Create instance modal
- [ ] Instance detail page
- [ ] Connect/disconnect/restart actions
- [ ] QR code display component
- [ ] Instance status polling

**Acceptance Criteria:**
- [ ] Can create/edit/delete instances
- [ ] Can connect WhatsApp via QR
- [ ] Status updates automatically

---

## Execution Group C: Chats & Messaging

**Goal:** View and send messages.

**Deliverables:**
- [ ] Chat list component
- [ ] Chat view with message bubbles
- [ ] Send message form (text)
- [ ] Message history with pagination
- [ ] Contact/person sidebar

**Acceptance Criteria:**
- [ ] Can view all chats for an instance
- [ ] Can view message history
- [ ] Can send text messages

---

## Execution Group D: Logs & Monitoring

**Goal:** Ops dashboard with logs and service management.

**Deliverables:**
- [ ] Logs page with real-time polling
- [ ] Log filters (source, level, instance)
- [ ] Service status component
- [ ] Restart service action
- [ ] Dashboard with health indicators

**Acceptance Criteria:**
- [ ] Can view logs from all sources
- [ ] Can filter logs
- [ ] Can restart service from UI
- [ ] Dashboard shows system health

---

## Execution Group E: Events & Polish

**Goal:** Events viewer and final polish.

**Deliverables:**
- [ ] Events list page with filters
- [ ] Event detail modal
- [ ] Settings page
- [ ] Error handling throughout
- [ ] Loading states
- [ ] Production build

**Acceptance Criteria:**
- [ ] Can query events with filters
- [ ] Error states handled gracefully
- [ ] Production build works

---

## API Requirements

The UI needs these SDK/API capabilities:

| Feature | SDK Method | API Endpoint |
|---------|-----------|--------------|
| List instances | `instances.list()` | `GET /instances` |
| Get instance | `instances.get(id)` | `GET /instances/:id` |
| Create instance | `instances.create(data)` | `POST /instances` |
| Update instance | `instances.update(id, data)` | `PATCH /instances/:id` |
| Delete instance | `instances.delete(id)` | `DELETE /instances/:id` |
| Connect instance | `instances.connect(id)` | `POST /instances/:id/connect` |
| Disconnect | `instances.disconnect(id)` | `POST /instances/:id/disconnect` |
| Restart instance | `instances.restart(id)` | `POST /instances/:id/restart` |
| Get QR | `instances.getQr(id)` | `GET /instances/:id/qr` |
| List chats | `chats.list(params)` | `GET /chats` |
| Get messages | `chats.messages(chatId)` | `GET /chats/:id/messages` |
| Send message | `messages.send(data)` | `POST /messages/send` |
| List events | `events.list(params)` | `GET /events` |
| Get logs | `logs.list(params)` | `GET /logs` |
| Service status | `status.get()` | `GET /status` |
| Restart service | `admin.restart()` | `POST /admin/restart` |

**Note:** Some endpoints may need to be added to V2 API (logs, admin/restart).

---

## Success Criteria

- [ ] UI builds and runs
- [ ] Can login with API key
- [ ] Can manage instances (CRUD + connect)
- [ ] Can view chats and messages
- [ ] Can send messages
- [ ] Can view logs from all sources
- [ ] Can restart instances and service
- [ ] Dashboard shows system health

---

## Dependencies

- `@omni/sdk` package (exists)
- API endpoints for logs (may need to add)
- API endpoint for service restart (may need to add)

## Enables

- Visual admin dashboard for V2
- Ops monitoring and management
- User-friendly instance management
