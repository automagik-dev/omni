---
title: "UI Reuse Strategy"
created: 2025-01-29
updated: 2026-02-09
tags: [migration, ui, react]
status: current
---

# UI Reuse Strategy

> The Omni v1 React dashboard is mature and well-tested. We'll reuse it with minimal changes by adapting the API client layer.

> Related: [[plan|Migration Plan]], [[components|UI Components]], [[v1-compatibility-layer|V1 Compatibility Layer]]

## Important UI Features to Preserve

The current UI has critical operational features that MUST work in v2:

1. **Instance Management** - Start, stop, restart instances (WhatsApp QR codes, Discord bots)
2. **Service Management** - Start/stop/restart backend services (API, NATS, etc.)
3. **Real-Time Logs** - Live streaming logs from all backend services
4. **Onboarding Wizard** - Guided setup for new installations
5. **Media Processing Config** - Configure Groq/Gemini/OpenAI API keys

## Current UI Stack (v1)

```
resources/ui/
├── src/
│   ├── pages/                    # Page components
│   │   ├── Dashboard.tsx         # Overview + real-time logs
│   │   ├── Instances.tsx         # Instance CRUD + QR codes
│   │   ├── InstanceSettings.tsx  # Per-instance config
│   │   ├── Contacts.tsx
│   │   ├── Chats.tsx
│   │   ├── Users.tsx
│   │   ├── AccessRules.tsx
│   │   ├── BatchJobs.tsx         # Media reprocessing
│   │   ├── Settings.tsx          # Global settings + API keys
│   │   └── Mcp.tsx
│   │
│   ├── components/               # Reusable components
│   │   ├── dashboard/
│   │   ├── instances/
│   │   ├── ui/                   # shadcn/ui components
│   │   └── ...
│   │
│   ├── lib/
│   │   ├── api.ts               # API client ← MAIN CHANGE
│   │   ├── types.ts             # TypeScript types
│   │   └── utils.ts
│   │
│   ├── contexts/                 # React contexts
│   │   └── OnboardingContext.tsx
│   │
│   └── App.tsx
│
├── package.json
└── vite.config.ts
```

## Migration Strategy: API Client Abstraction

### Step 1: Create API Client Interface

```typescript
// packages/ui/src/lib/api/types.ts

export interface OmniApiClient {
  // Instances
  instances: {
    list(params?: InstanceListParams): Promise<PaginatedResponse<Instance>>;
    get(id: string): Promise<Instance>;
    create(data: CreateInstanceData): Promise<Instance>;
    update(id: string, data: UpdateInstanceData): Promise<Instance>;
    delete(id: string): Promise<void>;
    getStatus(id: string): Promise<ConnectionStatus>;
    getQrCode(id: string): Promise<QrCodeResponse>;
    restart(id: string): Promise<ConnectionStatus>;
    logout(id: string): Promise<void>;
  };

  // Messages
  messages: {
    send(params: SendMessageParams): Promise<SendResult>;
    sendMedia(params: SendMediaParams): Promise<SendResult>;
    sendReaction(params: ReactionParams): Promise<void>;
  };

  // Events (new in v2)
  events: {
    list(params?: EventListParams): Promise<PaginatedResponse<Event>>;
    get(id: string): Promise<Event>;
    timeline(personId: string, params?: TimelineParams): Promise<PaginatedResponse<TimelineEvent>>;
  };

  // Persons (new in v2, replaces users)
  persons: {
    search(query: string): Promise<Person[]>;
    get(id: string): Promise<Person>;
    getPresence(id: string): Promise<PersonPresence>;
    link(identityA: string, identityB: string): Promise<Person>;
    unlink(identityId: string, reason: string): Promise<UnlinkResult>;
  };

  // Access Rules
  access: {
    listRules(params?: RuleListParams): Promise<AccessRule[]>;
    createRule(data: CreateRuleData): Promise<AccessRule>;
    updateRule(id: string, data: UpdateRuleData): Promise<AccessRule>;
    deleteRule(id: string): Promise<void>;
  };

  // Settings
  settings: {
    list(): Promise<Setting[]>;
    get(key: string): Promise<Setting>;
    set(key: string, value: any): Promise<Setting>;
  };

  // Batch Jobs
  batchJobs: {
    list(): Promise<BatchJob[]>;
    get(id: string): Promise<BatchJob>;
    create(params: CreateBatchJobParams): Promise<BatchJob>;
    cancel(id: string): Promise<void>;
  };
}
```

### Step 2: Implement v1 Adapter (Current Behavior)

```typescript
// packages/ui/src/lib/api/v1-client.ts

import { OmniApiClient } from './types';

export function createV1Client(config: { baseUrl: string; apiKey: string }): OmniApiClient {
  const fetcher = async (path: string, options?: RequestInit) => {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.message ?? 'Request failed');
    }

    return response.json();
  };

  return {
    instances: {
      list: (params) => fetcher(`/api/v1/instances?${qs(params)}`),
      get: (id) => fetcher(`/api/v1/instances/${id}`),
      create: (data) => fetcher('/api/v1/instances', { method: 'POST', body: JSON.stringify(data) }),
      update: (id, data) => fetcher(`/api/v1/instances/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      delete: (id) => fetcher(`/api/v1/instances/${id}`, { method: 'DELETE' }),
      getStatus: (id) => fetcher(`/api/v1/instances/${id}/status`),
      getQrCode: (id) => fetcher(`/api/v1/instances/${id}/qr`),
      restart: (id) => fetcher(`/api/v1/instances/${id}/restart`, { method: 'POST' }),
      logout: (id) => fetcher(`/api/v1/instances/${id}/logout`, { method: 'POST' }),
    },

    messages: {
      send: (params) => fetcher(`/api/v1/instances/${params.instanceId}/send-text`, {
        method: 'POST',
        body: JSON.stringify({ number: params.to, text: params.text }),
      }),
      sendMedia: (params) => fetcher(`/api/v1/instances/${params.instanceId}/send-media`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),
      sendReaction: (params) => fetcher(`/api/v1/instances/${params.instanceId}/send-reaction`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),
    },

    // v1 uses "users" instead of "persons"
    persons: {
      search: async (query) => {
        const { items } = await fetcher(`/api/v1/users?search=${encodeURIComponent(query)}`);
        return items.map(mapV1UserToPerson);
      },
      get: async (id) => {
        const user = await fetcher(`/api/v1/users/${id}`);
        return mapV1UserToPerson(user);
      },
      getPresence: async (id) => {
        const user = await fetcher(`/api/v1/users/${id}`);
        const externalIds = await fetcher(`/api/v1/users/${id}/external-ids`);
        return mapV1UserToPresence(user, externalIds);
      },
      link: () => { throw new Error('Not supported in v1') },
      unlink: () => { throw new Error('Not supported in v1') },
    },

    // v1 uses "traces" instead of "events"
    events: {
      list: async (params) => {
        const { items, ...meta } = await fetcher(`/api/v1/traces?${qs(params)}`);
        return { items: items.map(mapV1TraceToEvent), meta };
      },
      get: async (id) => {
        const trace = await fetcher(`/api/v1/traces/${id}`);
        return mapV1TraceToEvent(trace);
      },
      timeline: () => { throw new Error('Not supported in v1') },
    },

    access: {
      listRules: (params) => fetcher(`/api/v1/access/rules?${qs(params)}`),
      createRule: (data) => fetcher('/api/v1/access/rules', { method: 'POST', body: JSON.stringify(data) }),
      updateRule: (id, data) => fetcher(`/api/v1/access/rules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
      deleteRule: (id) => fetcher(`/api/v1/access/rules/${id}`, { method: 'DELETE' }),
    },

    settings: {
      list: () => fetcher('/api/v1/settings'),
      get: (key) => fetcher(`/api/v1/settings/${key}`),
      set: (key, value) => fetcher(`/api/v1/settings/${key}`, { method: 'PUT', body: JSON.stringify({ value }) }),
    },

    batchJobs: {
      list: () => fetcher('/api/v1/batch-jobs'),
      get: (id) => fetcher(`/api/v1/batch-jobs/${id}`),
      create: (params) => fetcher('/api/v1/batch-jobs', { method: 'POST', body: JSON.stringify(params) }),
      cancel: (id) => fetcher(`/api/v1/batch-jobs/${id}/cancel`, { method: 'POST' }),
    },
  };
}

// Map v1 types to v2 types
function mapV1UserToPerson(user: V1User): Person {
  return {
    id: user.id,
    displayName: user.name,
    primaryPhone: user.phone_number,
    primaryEmail: user.email,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}

function mapV1TraceToEvent(trace: V1Trace): Event {
  return {
    id: trace.id,
    externalId: trace.whatsapp_message_id,
    channel: trace.channel_type ?? 'whatsapp-baileys',
    instanceId: trace.instance_id,
    eventType: 'message.received',
    contentType: trace.message_type ?? 'text',
    textContent: trace.message_text,
    transcription: trace.audio_transcription,
    receivedAt: trace.created_at,
    // ... more mappings
  };
}
```

### Step 3: Implement v2 Client

```typescript
// packages/ui/src/lib/api/v2-client.ts

import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@omni/api';
import { OmniApiClient } from './types';

export function createV2Client(config: { baseUrl: string; apiKey: string }): OmniApiClient {
  // Use tRPC for type safety
  const trpc = createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${config.baseUrl}/trpc`,
        headers: { 'x-api-key': config.apiKey },
      }),
    ],
  });

  // Also have REST fetcher for non-tRPC endpoints
  const fetcher = async (path: string, options?: RequestInit) => {
    const response = await fetch(`${config.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new ApiError(response.status, error.message ?? 'Request failed');
    }

    return response.json();
  };

  return {
    instances: {
      list: (params) => trpc.instances.list.query(params ?? {}),
      get: (id) => trpc.instances.get.query({ id }),
      create: (data) => trpc.instances.create.mutate(data),
      update: (id, data) => trpc.instances.update.mutate({ id, ...data }),
      delete: (id) => trpc.instances.delete.mutate({ id }),
      getStatus: (id) => trpc.instances.getStatus.query({ id }),
      getQrCode: (id) => trpc.instances.getQrCode.query({ id }),
      restart: (id) => trpc.instances.restart.mutate({ id }),
      logout: (id) => trpc.instances.logout.mutate({ id }),
    },

    messages: {
      send: (params) => trpc.messages.send.mutate(params),
      sendMedia: (params) => trpc.messages.sendMedia.mutate(params),
      sendReaction: (params) => trpc.messages.sendReaction.mutate(params),
    },

    events: {
      list: (params) => trpc.events.list.query(params ?? {}),
      get: (id) => trpc.events.get.query({ id }),
      timeline: (personId, params) => trpc.events.timeline.query({ personId, ...params }),
    },

    persons: {
      search: (query) => trpc.persons.search.query({ query }),
      get: (id) => trpc.persons.get.query({ id }),
      getPresence: (id) => trpc.persons.getPresence.query({ id }),
      link: (identityA, identityB) => trpc.persons.link.mutate({ identityA, identityB }),
      unlink: (identityId, reason) => trpc.persons.unlink.mutate({ identityId, reason }),
    },

    access: {
      listRules: (params) => trpc.access.listRules.query(params ?? {}),
      createRule: (data) => trpc.access.createRule.mutate(data),
      updateRule: (id, data) => trpc.access.updateRule.mutate({ id, ...data }),
      deleteRule: (id) => trpc.access.deleteRule.mutate({ id }),
    },

    settings: {
      list: () => trpc.settings.list.query(),
      get: (key) => trpc.settings.get.query({ key }),
      set: (key, value) => trpc.settings.set.mutate({ key, value }),
    },

    batchJobs: {
      list: () => trpc.batchJobs.list.query(),
      get: (id) => trpc.batchJobs.get.query({ id }),
      create: (params) => trpc.batchJobs.create.mutate(params),
      cancel: (id) => trpc.batchJobs.cancel.mutate({ id }),
    },
  };
}
```

### Step 4: Create Client Factory

```typescript
// packages/ui/src/lib/api/client.ts

import { createV1Client } from './v1-client';
import { createV2Client } from './v2-client';
import type { OmniApiClient } from './types';

export function createApiClient(config: {
  baseUrl: string;
  apiKey: string;
  version?: 'v1' | 'v2' | 'auto';
}): OmniApiClient {
  const version = config.version ?? 'auto';

  if (version === 'v1') {
    return createV1Client(config);
  }

  if (version === 'v2') {
    return createV2Client(config);
  }

  // Auto-detect: check if v2 endpoint exists
  // During migration, this allows gradual rollout
  return createAutoClient(config);
}

async function createAutoClient(config: { baseUrl: string; apiKey: string }): OmniApiClient {
  try {
    // Check if v2 is available
    const response = await fetch(`${config.baseUrl}/api/v2/health`, {
      headers: { 'x-api-key': config.apiKey },
    });

    if (response.ok) {
      console.log('Using Omni v2 API');
      return createV2Client(config);
    }
  } catch {
    // v2 not available
  }

  console.log('Using Omni v1 API');
  return createV1Client(config);
}
```

### Step 5: Update React Context

```typescript
// packages/ui/src/contexts/ApiContext.tsx

import { createContext, useContext, useMemo, ReactNode } from 'react';
import { createApiClient, OmniApiClient } from '../lib/api';

const ApiContext = createContext<OmniApiClient | null>(null);

export function ApiProvider({
  children,
  baseUrl,
  apiKey,
  version,
}: {
  children: ReactNode;
  baseUrl: string;
  apiKey: string;
  version?: 'v1' | 'v2' | 'auto';
}) {
  const client = useMemo(
    () => createApiClient({ baseUrl, apiKey, version }),
    [baseUrl, apiKey, version]
  );

  return (
    <ApiContext.Provider value={client}>
      {children}
    </ApiContext.Provider>
  );
}

export function useApi(): OmniApiClient {
  const client = useContext(ApiContext);
  if (!client) {
    throw new Error('useApi must be used within ApiProvider');
  }
  return client;
}
```

### Step 6: Update Components to Use Abstraction

```typescript
// Before (direct fetch)
const InstancesPage = () => {
  const [instances, setInstances] = useState([]);

  useEffect(() => {
    fetch('/api/v1/instances', {
      headers: { 'x-api-key': apiKey },
    })
      .then(r => r.json())
      .then(data => setInstances(data.items));
  }, []);
  // ...
};

// After (use abstraction)
const InstancesPage = () => {
  const api = useApi();

  const { data, isLoading } = useQuery({
    queryKey: ['instances'],
    queryFn: () => api.instances.list(),
  });
  // ...
};
```

## New v2-Only Features

### Person Presence View

New component for cross-channel identity:

```tsx
// packages/ui/src/components/persons/PersonPresence.tsx

export function PersonPresence({ personId }: { personId: string }) {
  const api = useApi();

  const { data: presence } = useQuery({
    queryKey: ['person-presence', personId],
    queryFn: () => api.persons.getPresence(personId),
  });

  if (!presence) return <Skeleton />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{presence.person.displayName}</CardTitle>
        <CardDescription>
          Active on {presence.summary.activeChannels.join(', ')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Identity badges */}
          <div className="flex flex-wrap gap-2">
            {presence.identities.map(identity => (
              <Badge key={identity.id} variant={getChannelVariant(identity.channel)}>
                {identity.channel}: {identity.platformUsername}
              </Badge>
            ))}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Total Messages" value={presence.summary.totalMessages} />
            <Stat label="Last Seen" value={formatRelative(presence.summary.lastSeenAt)} />
            <Stat label="First Contact" value={formatDate(presence.summary.firstSeenAt)} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

### Cross-Channel Timeline

```tsx
// packages/ui/src/components/persons/PersonTimeline.tsx

export function PersonTimeline({ personId }: { personId: string }) {
  const api = useApi();

  const { data, fetchNextPage, hasNextPage } = useInfiniteQuery({
    queryKey: ['person-timeline', personId],
    queryFn: ({ pageParam }) => api.events.timeline(personId, { cursor: pageParam }),
    getNextPageParam: (lastPage) => lastPage.meta.cursor,
  });

  const events = data?.pages.flatMap(p => p.items) ?? [];

  return (
    <div className="space-y-4">
      {events.map(event => (
        <TimelineEvent key={event.id} event={event} showChannel />
      ))}

      {hasNextPage && (
        <Button onClick={() => fetchNextPage()}>
          Load More
        </Button>
      )}
    </div>
  );
}

function TimelineEvent({ event, showChannel }: { event: Event; showChannel?: boolean }) {
  return (
    <div className="flex gap-4">
      {showChannel && (
        <ChannelIcon channel={event.channel} className="w-5 h-5" />
      )}
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            {formatTime(event.receivedAt)}
          </span>
          {event.direction === 'inbound' ? (
            <ArrowDownIcon className="w-4 h-4 text-blue-500" />
          ) : (
            <ArrowUpIcon className="w-4 h-4 text-green-500" />
          )}
        </div>
        <div className="mt-1">
          {event.textContent && <p>{event.textContent}</p>}
          {event.transcription && (
            <p className="italic text-muted-foreground">
              🎤 {event.transcription}
            </p>
          )}
          {event.contentType === 'image' && (
            <div className="mt-2">
              <ImagePreview mediaId={event.mediaId} />
              {event.imageDescription && (
                <p className="text-sm text-muted-foreground mt-1">
                  {event.imageDescription}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

## File Changes Summary

| File | Change |
|------|--------|
| `src/lib/api.ts` | Replace with new client factory |
| `src/lib/api/types.ts` | New: API interface types |
| `src/lib/api/v1-client.ts` | New: v1 adapter |
| `src/lib/api/v2-client.ts` | New: v2 client (tRPC) |
| `src/lib/api/client.ts` | New: Client factory |
| `src/contexts/ApiContext.tsx` | New: API context provider |
| `src/pages/*.tsx` | Update to use `useApi()` hook |
| `src/components/persons/*` | New: v2-only components |
| `src/App.tsx` | Wrap with `ApiProvider` |
| `package.json` | Add `@trpc/client` dependency |

## Migration Checklist

- [ ] Create API client abstraction layer
- [ ] Implement v1 adapter (maintains current behavior)
- [ ] Implement v2 client
- [ ] Update all pages to use `useApi()` hook
- [ ] Add new v2-only pages (PersonPresence, Timeline)
- [ ] Test with v1 backend
- [ ] Test with v2 backend
- [ ] Test auto-detection mode
- [ ] Update build configuration
- [ ] Deploy alongside v2 API

## Benefits

1. **No rewrite** - Existing UI code remains mostly unchanged
2. **Gradual migration** - Can switch between v1/v2 per feature
3. **Type safety** - tRPC provides full types in v2 mode
4. **New features** - v2-only features gracefully degrade on v1
5. **Easy rollback** - Just change version flag to revert

---

## Critical Features: Service Management & Real-Time Logs

These features are essential for operations and must work in v2.

### Service Management API

```typescript
// Add to API client interface
interface OmniApiClient {
  // ... existing ...

  services: {
    list(): Promise<Service[]>;
    get(name: string): Promise<Service>;
    start(name: string): Promise<ServiceStatus>;
    stop(name: string): Promise<ServiceStatus>;
    restart(name: string): Promise<ServiceStatus>;
    restartAll(): Promise<ServiceRestartResult[]>;
  };
}

interface Service {
  name: string;
  status: 'running' | 'stopped' | 'error';
  pid?: number;
  uptime?: number;
  memory?: number;
  cpu?: number;
}
```

### Real-Time Logs Hook

```typescript
// packages/ui/src/hooks/useLogs.ts

import { useEffect, useState, useCallback, useRef } from 'react';

interface LogEntry {
  service: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  timestamp: Date;
  message: string;
  metadata?: Record<string, any>;
}

interface UseLogsOptions {
  services?: string[];
  level?: 'debug' | 'info' | 'warn' | 'error';
  maxEntries?: number;
}

export function useLogs(options: UseLogsOptions = {}) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const ws = new WebSocket(`${getWsUrl()}/api/v2/ws/logs`);

    ws.onopen = () => {
      setConnected(true);

      // Subscribe with filters
      ws.send(JSON.stringify({
        type: 'subscribe',
        services: options.services ?? ['*'],
        level: options.level ?? 'info',
        tail: 100,
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      if (data.type === 'log') {
        setLogs(prev => {
          const newLogs = [...prev, {
            ...data,
            timestamp: new Date(data.timestamp),
          }];

          // Keep only last N entries
          const maxEntries = options.maxEntries ?? 1000;
          if (newLogs.length > maxEntries) {
            return newLogs.slice(-maxEntries);
          }
          return newLogs;
        });
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Reconnect after delay
      setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [options.services, options.level, options.maxEntries]);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);

  const clear = useCallback(() => {
    setLogs([]);
  }, []);

  const filter = useCallback((filterFn: (log: LogEntry) => boolean) => {
    return logs.filter(filterFn);
  }, [logs]);

  return {
    logs,
    connected,
    clear,
    filter,
  };
}
```

### Logs Panel Component

```tsx
// packages/ui/src/components/dashboard/LogsPanel.tsx

import { useLogs } from '@/hooks/useLogs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface LogsPanelProps {
  services?: string[];
  level?: 'debug' | 'info' | 'warn' | 'error';
  className?: string;
}

export function LogsPanel({ services, level, className }: LogsPanelProps) {
  const { logs, connected, clear } = useLogs({ services, level });
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new logs
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  return (
    <div className={cn('flex flex-col h-full', className)}>
      {/* Header */}
      <div className="flex items-center justify-between p-2 border-b">
        <div className="flex items-center gap-2">
          <span className="font-medium">Logs</span>
          <Badge variant={connected ? 'default' : 'destructive'}>
            {connected ? 'Connected' : 'Disconnected'}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={clear}>
          Clear
        </Button>
      </div>

      {/* Log entries */}
      <ScrollArea ref={scrollRef} className="flex-1 p-2">
        <div className="space-y-1 font-mono text-sm">
          {logs.map((log, i) => (
            <LogEntry key={i} log={log} />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

function LogEntry({ log }: { log: LogEntry }) {
  const levelColors = {
    debug: 'text-gray-500',
    info: 'text-blue-500',
    warn: 'text-yellow-500',
    error: 'text-red-500',
  };

  return (
    <div className="flex gap-2 hover:bg-muted/50 px-1 rounded">
      <span className="text-muted-foreground whitespace-nowrap">
        {format(log.timestamp, 'HH:mm:ss.SSS')}
      </span>
      <span className={cn('w-12', levelColors[log.level])}>
        {log.level.toUpperCase()}
      </span>
      <span className="text-purple-500 w-20 truncate">
        {log.service}
      </span>
      <span className="flex-1 break-all">
        {log.message}
      </span>
    </div>
  );
}
```

### Service Management Component

```tsx
// packages/ui/src/components/dashboard/ServiceManager.tsx

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from '@/contexts/ApiContext';

export function ServiceManager() {
  const api = useApi();
  const queryClient = useQueryClient();

  const { data: services, isLoading } = useQuery({
    queryKey: ['services'],
    queryFn: () => api.services.list(),
    refetchInterval: 5000, // Poll every 5 seconds
  });

  const restartMutation = useMutation({
    mutationFn: (name: string) => api.services.restart(name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  const restartAllMutation = useMutation({
    mutationFn: () => api.services.restartAll(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['services'] });
    },
  });

  if (isLoading) return <Skeleton className="h-32" />;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Services</CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={() => restartAllMutation.mutate()}
          disabled={restartAllMutation.isPending}
        >
          {restartAllMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="w-4 h-4 mr-2" />
          )}
          Restart All
        </Button>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {services?.map(service => (
            <div
              key={service.name}
              className="flex items-center justify-between p-2 border rounded"
            >
              <div className="flex items-center gap-3">
                <StatusIndicator status={service.status} />
                <span className="font-medium">{service.name}</span>
                {service.uptime && (
                  <span className="text-sm text-muted-foreground">
                    up {formatDuration(service.uptime)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {service.memory && (
                  <span className="text-sm text-muted-foreground">
                    {formatBytes(service.memory)}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => restartMutation.mutate(service.name)}
                  disabled={restartMutation.isPending}
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function StatusIndicator({ status }: { status: string }) {
  const colors = {
    running: 'bg-green-500',
    stopped: 'bg-gray-500',
    error: 'bg-red-500',
  };

  return (
    <div className={cn('w-2 h-2 rounded-full', colors[status] ?? 'bg-gray-500')} />
  );
}
```

### Real-Time Chats (Key Enhancement)

The v1 UI chats view lacks real-time updates. This is a major enhancement for v2.

```tsx
// packages/ui/src/hooks/useRealtimeChat.ts

import { useState, useEffect, useRef, useCallback } from 'react';

interface Message {
  id: string;
  externalId: string;
  sender: {
    platformUserId: string;
    displayName: string;
    profilePicture?: string;
  };
  content: {
    type: string;
    text?: string;
    mediaUrl?: string;
  };
  timestamp: string;
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  processedMedia?: {
    type: string;
    content: string;
  };
}

interface PresenceInfo {
  status: 'online' | 'offline' | 'composing' | 'recording';
  lastSeen?: string;
}

interface UseRealtimeChatOptions {
  instanceId: string;
  chatId?: string;
  includeTyping?: boolean;
  includePresence?: boolean;
}

export function useRealtimeChat(options: UseRealtimeChatOptions) {
  const { instanceId, chatId, includeTyping = true, includePresence = true } = options;

  const [messages, setMessages] = useState<Message[]>([]);
  const [typing, setTyping] = useState<Record<string, boolean>>({});
  const [presence, setPresence] = useState<Record<string, PresenceInfo>>({});
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(() => {
    const wsUrl = `${getWsUrl()}/api/v2/ws/chats/${instanceId}`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      setConnected(true);
      ws.send(JSON.stringify({
        type: 'subscribe',
        chatId,
        includeTyping,
        includePresence,
        includeReadReceipts: true,
      }));
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'message.new':
          setMessages(prev => {
            // Avoid duplicates
            if (prev.some(m => m.id === data.message.id)) return prev;
            return [...prev, data.message];
          });
          break;

        case 'message.status':
          setMessages(prev => prev.map(m =>
            m.id === data.messageId || m.externalId === data.externalId
              ? { ...m, status: data.status }
              : m
          ));
          break;

        case 'chat.typing':
          setTyping(prev => ({
            ...prev,
            [data.user.platformUserId]: data.isTyping
          }));
          // Auto-clear typing after 5 seconds
          if (data.isTyping) {
            setTimeout(() => {
              setTyping(prev => ({
                ...prev,
                [data.user.platformUserId]: false
              }));
            }, 5000);
          }
          break;

        case 'chat.presence':
          setPresence(prev => ({
            ...prev,
            [data.chatId]: {
              status: data.presence,
              lastSeen: data.lastSeen
            }
          }));
          break;

        case 'media.processed':
          setMessages(prev => prev.map(m =>
            m.id === data.messageId
              ? { ...m, processedMedia: data.result }
              : m
          ));
          break;

        case 'message.deleted':
          setMessages(prev => prev.filter(m => m.id !== data.messageId));
          break;

        case 'message.edited':
          setMessages(prev => prev.map(m =>
            m.id === data.messageId
              ? { ...m, content: data.newContent, editedAt: data.editedAt }
              : m
          ));
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 3 seconds
      setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();

    wsRef.current = ws;
  }, [instanceId, chatId, includeTyping, includePresence]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  // Clear messages when switching chats
  useEffect(() => {
    setMessages([]);
  }, [chatId]);

  return {
    messages,
    typing,
    presence,
    connected,
    isTyping: Object.values(typing).some(Boolean),
  };
}

function getWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}`;
}
```

```tsx
// packages/ui/src/components/chats/RealtimeChatView.tsx

import { useRealtimeChat } from '@/hooks/useRealtimeChat';
import { useApi } from '@/contexts/ApiContext';
import { useQuery } from '@tanstack/react-query';

interface RealtimeChatViewProps {
  instanceId: string;
  chatId: string;
}

export function RealtimeChatView({ instanceId, chatId }: RealtimeChatViewProps) {
  const api = useApi();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load initial messages from API
  const { data: initialMessages } = useQuery({
    queryKey: ['chat-messages', instanceId, chatId],
    queryFn: () => api.instances.getChatMessages(instanceId, chatId, { limit: 50 }),
  });

  // Real-time updates via WebSocket
  const { messages: realtimeMessages, typing, presence, connected, isTyping } =
    useRealtimeChat({ instanceId, chatId });

  // Merge initial + realtime messages
  const allMessages = useMemo(() => {
    const initial = initialMessages?.items ?? [];
    const merged = [...initial];

    for (const rtMsg of realtimeMessages) {
      if (!merged.some(m => m.id === rtMsg.id)) {
        merged.push(rtMsg);
      }
    }

    return merged.sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [initialMessages, realtimeMessages]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [allMessages.length]);

  const chatPresence = presence[chatId];

  return (
    <div className="flex flex-col h-full">
      {/* Header with presence */}
      <div className="flex items-center gap-2 p-4 border-b">
        <PresenceIndicator status={chatPresence?.status} />
        <span className="font-medium">{chatId}</span>
        {chatPresence?.status === 'offline' && chatPresence.lastSeen && (
          <span className="text-sm text-muted-foreground">
            Last seen {formatRelative(chatPresence.lastSeen)}
          </span>
        )}
        {!connected && (
          <Badge variant="destructive">Disconnected</Badge>
        )}
      </div>

      {/* Messages */}
      <ScrollArea ref={scrollRef} className="flex-1 p-4">
        <div className="space-y-4">
          {allMessages.map(message => (
            <ChatMessage key={message.id} message={message} />
          ))}
        </div>
      </ScrollArea>

      {/* Typing indicator */}
      {isTyping && (
        <div className="px-4 py-2 text-sm text-muted-foreground">
          <TypingIndicator />
          Someone is typing...
        </div>
      )}

      {/* Message input */}
      <MessageInput instanceId={instanceId} chatId={chatId} />
    </div>
  );
}

function ChatMessage({ message }: { message: Message }) {
  const isOutgoing = message.sender.platformUserId === 'me'; // Adjust based on your logic

  return (
    <div className={cn('flex gap-2', isOutgoing && 'flex-row-reverse')}>
      <Avatar>
        <AvatarImage src={message.sender.profilePicture} />
        <AvatarFallback>{message.sender.displayName?.[0]}</AvatarFallback>
      </Avatar>

      <div className={cn(
        'max-w-[70%] rounded-lg p-3',
        isOutgoing ? 'bg-primary text-primary-foreground' : 'bg-muted'
      )}>
        {message.content.text && <p>{message.content.text}</p>}

        {message.content.mediaUrl && (
          <img src={message.content.mediaUrl} className="rounded max-w-full" />
        )}

        {/* Show transcription if available */}
        {message.processedMedia?.type === 'transcription' && (
          <div className="mt-2 text-xs italic opacity-80 border-t pt-2">
            🎙️ {message.processedMedia.content}
          </div>
        )}

        <div className="flex items-center gap-1 mt-1 text-xs opacity-70">
          <span>{format(new Date(message.timestamp), 'HH:mm')}</span>
          {isOutgoing && <MessageStatus status={message.status} />}
        </div>
      </div>
    </div>
  );
}

function MessageStatus({ status }: { status: string }) {
  switch (status) {
    case 'pending': return <Clock className="w-3 h-3" />;
    case 'sent': return <Check className="w-3 h-3" />;
    case 'delivered': return <CheckCheck className="w-3 h-3" />;
    case 'read': return <CheckCheck className="w-3 h-3 text-blue-500" />;
    case 'failed': return <X className="w-3 h-3 text-red-500" />;
    default: return null;
  }
}

function TypingIndicator() {
  return (
    <span className="inline-flex gap-1">
      <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-2 h-2 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
    </span>
  );
}
```

### Onboarding Flow

#### V2 vs V1 Onboarding Differences

In v2, the onboarding is simplified:
- **Database configuration is removed** - v2 uses environment variables only
- **Network mode selection is removed** - just use `PUBLIC_URL` environment variable
- **Redis configuration is removed** - NATS JetStream replaces Redis

#### Onboarding State Machine

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ONBOARDING STATE MACHINE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐     ┌───────────┐     ┌─────────────────┐     ┌────────────┐ │
│  │ welcome  │────►│ api_keys  │────►│ first_instance  │────►│  connect   │ │
│  └──────────┘     └─────┬─────┘     └────────┬────────┘     └──────┬─────┘ │
│                         │                    │                      │        │
│                    [skip]                [skip]                     │        │
│                         │                    │                      │        │
│                         ▼                    ▼                      ▼        │
│                   ┌─────────────────────────────────────────────────────┐   │
│                   │                    complete                          │   │
│                   └─────────────────────────────────────────────────────┘   │
│                                                                              │
│  Back navigation: Any step can go back to previous step                      │
│  Skip: api_keys and first_instance can be skipped                           │
│  Required: welcome and complete are required                                 │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Step Configuration

```typescript
// packages/ui/src/lib/onboarding/steps.ts

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  component: React.ComponentType<StepProps>;
  skippable: boolean;
  optional: boolean;
  requiresPrevious: string[];  // Steps that must be completed first
  apiCalls: string[];          // API endpoints this step needs
}

export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Omni',
    description: 'Introduction and feature overview',
    component: WelcomeStep,
    skippable: false,
    optional: false,
    requiresPrevious: [],
    apiCalls: [],
  },
  {
    id: 'api_keys',
    title: 'Configure Media Processing',
    description: 'Set up API keys for transcription and image description',
    component: ApiKeysStep,
    skippable: true,
    optional: true,  // Can configure later in Settings
    requiresPrevious: ['welcome'],
    apiCalls: [
      'PUT /api/v2/settings/groq_api_key',
      'PUT /api/v2/settings/gemini_api_key',
      'PUT /api/v2/settings/openai_api_key',
    ],
  },
  {
    id: 'first_instance',
    title: 'Create Your First Instance',
    description: 'Set up WhatsApp or Discord connection',
    component: FirstInstanceStep,
    skippable: true,
    optional: true,  // Can create instances later
    requiresPrevious: ['welcome'],
    apiCalls: [
      'POST /api/v2/instances',
      'GET /api/v2/instances/supported-channels',
    ],
  },
  {
    id: 'connect',
    title: 'Connect Your Channel',
    description: 'Scan QR code or authenticate',
    component: ConnectStep,
    skippable: false,
    optional: false,
    requiresPrevious: ['first_instance'],
    apiCalls: [
      'GET /api/v2/instances/:id/qr',
      'GET /api/v2/instances/:id/status',
      'POST /api/v2/instances/:id/connect',
    ],
  },
  {
    id: 'test_message',
    title: 'Send a Test Message',
    description: 'Verify everything works',
    component: TestMessageStep,
    skippable: true,
    optional: true,
    requiresPrevious: ['connect'],
    apiCalls: [
      'POST /api/v2/messages',
      'POST /api/v2/instances/:id/validate-recipient',
    ],
  },
  {
    id: 'complete',
    title: 'Setup Complete',
    description: 'You\'re all set!',
    component: CompleteStep,
    skippable: false,
    optional: false,
    requiresPrevious: ['welcome'],  // Only welcome is truly required
    apiCalls: [
      'POST /api/v2/onboarding/complete',
    ],
  },
];
```

#### Onboarding API Endpoints

```yaml
# Get onboarding status
GET /api/v2/onboarding/status
Response:
  completed: boolean           # True if setup wizard was completed
  currentStep: string          # Current step ID
  completedSteps: string[]     # Steps that have been completed
  skippedSteps: string[]       # Steps that were skipped
  data:                        # Data collected during onboarding
    instanceId?: string        # Created instance ID
    channelType?: string       # Selected channel type
    apiKeysConfigured: boolean

# Complete a step
POST /api/v2/onboarding/steps/:stepId/complete
Body:
  data?: object                # Step-specific data
Response:
  success: true
  nextStep?: string            # ID of next step (null if complete)
  canSkip: boolean             # Whether next step can be skipped

# Skip a step
POST /api/v2/onboarding/steps/:stepId/skip
Response:
  success: true
  nextStep?: string

# Go back to previous step
POST /api/v2/onboarding/steps/:stepId/back
Response:
  success: true
  previousStep: string

# Skip entire onboarding
POST /api/v2/onboarding/skip
Response:
  success: true
  message: "Setup skipped. You can configure settings manually."

# Reset onboarding (for re-running wizard)
POST /api/v2/onboarding/reset
Response:
  success: true
```

#### Error Recovery States

```typescript
// packages/ui/src/hooks/useOnboarding.ts

interface OnboardingState {
  currentStep: string;
  error: string | null;
  retryCount: number;
  canRetry: boolean;
  canGoBack: boolean;
  canSkip: boolean;
}

// Error states and recovery
const ERROR_RECOVERY: Record<string, { message: string; action: string }> = {
  'INSTANCE_CREATE_FAILED': {
    message: 'Failed to create instance',
    action: 'retry',  // Show retry button
  },
  'QR_EXPIRED': {
    message: 'QR code expired',
    action: 'refresh',  // Refresh QR code
  },
  'CONNECTION_TIMEOUT': {
    message: 'Connection timed out',
    action: 'retry',
  },
  'DISCORD_TOKEN_INVALID': {
    message: 'Invalid Discord bot token',
    action: 'edit',  // Go back to edit credentials
  },
  'API_KEY_INVALID': {
    message: 'API key validation failed',
    action: 'edit',
  },
  'NETWORK_ERROR': {
    message: 'Network connection lost',
    action: 'retry',
  },
};
```

```tsx
// packages/ui/src/components/onboarding/OnboardingWizard.tsx

import { useQuery, useMutation } from '@tanstack/react-query';
import { useApi } from '@/contexts/ApiContext';

const STEPS = [
  { id: 'welcome', title: 'Welcome', component: WelcomeStep },
  { id: 'api_keys', title: 'API Keys', component: ApiKeysStep },
  { id: 'first_instance', title: 'Create Instance', component: FirstInstanceStep },
  { id: 'connect', title: 'Connect', component: ConnectStep },
  { id: 'test_message', title: 'Test', component: TestMessageStep },
  { id: 'complete', title: 'Complete', component: CompleteStep },
];

export function OnboardingWizard() {
  const api = useApi();

  const { data: status } = useQuery({
    queryKey: ['onboarding-status'],
    queryFn: () => api.onboarding.getStatus(),
  });

  const completeMutation = useMutation({
    mutationFn: ({ stepId, data }: { stepId: string; data: any }) =>
      api.onboarding.completeStep(stepId, data),
  });

  if (!status || status.completed) {
    return null; // Don't show if completed
  }

  const currentStepIndex = STEPS.findIndex(s => s.id === status.currentStep);
  const CurrentComponent = STEPS[currentStepIndex]?.component;

  return (
    <Dialog open={true}>
      <DialogContent className="max-w-2xl">
        {/* Progress indicator */}
        <div className="flex gap-2 mb-6">
          {STEPS.map((step, i) => (
            <div
              key={step.id}
              className={cn(
                'h-1 flex-1 rounded',
                i < currentStepIndex ? 'bg-primary' :
                i === currentStepIndex ? 'bg-primary/50' :
                'bg-muted'
              )}
            />
          ))}
        </div>

        {/* Current step */}
        <CurrentComponent
          status={status}
          onComplete={(data) => completeMutation.mutate({
            stepId: status.currentStep,
            data,
          })}
        />
      </DialogContent>
    </Dialog>
  );
}

function ApiKeysStep({ status, onComplete }) {
  const [keys, setKeys] = useState({
    groq: '',
    gemini: '',
    openai: '',
  });

  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>Configure Media Processing</DialogTitle>
        <DialogDescription>
          Add API keys for audio transcription and image/video description.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div>
          <Label>Groq API Key (Audio - Recommended)</Label>
          <Input
            type="password"
            value={keys.groq}
            onChange={(e) => setKeys({ ...keys, groq: e.target.value })}
            placeholder="gsk_..."
          />
          <p className="text-sm text-muted-foreground mt-1">
            Fast and affordable audio transcription
          </p>
        </div>

        <div>
          <Label>Gemini API Key (Images/Video)</Label>
          <Input
            type="password"
            value={keys.gemini}
            onChange={(e) => setKeys({ ...keys, gemini: e.target.value })}
            placeholder="AIza..."
          />
        </div>

        <div>
          <Label>OpenAI API Key (Fallback)</Label>
          <Input
            type="password"
            value={keys.openai}
            onChange={(e) => setKeys({ ...keys, openai: e.target.value })}
            placeholder="sk-..."
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={() => onComplete({})}>
          Skip for now
        </Button>
        <Button onClick={() => onComplete(keys)}>
          Continue
        </Button>
      </DialogFooter>
    </div>
  );
}
```

### Dashboard Layout with Logs

```tsx
// packages/ui/src/pages/Dashboard.tsx

export function Dashboard() {
  const [showLogs, setShowLogs] = useState(true);

  return (
    <div className="flex flex-col h-screen">
      {/* Main content */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <ServiceManager />
          <InstancesOverview />
          <EventsOverview />
          <MediaProcessingStats />
        </div>
      </div>

      {/* Logs panel (resizable) */}
      {showLogs && (
        <div className="h-64 border-t">
          <LogsPanel level="info" />
        </div>
      )}

      {/* Toggle logs */}
      <Button
        variant="ghost"
        size="sm"
        className="absolute bottom-2 right-2"
        onClick={() => setShowLogs(!showLogs)}
      >
        {showLogs ? 'Hide Logs' : 'Show Logs'}
      </Button>
    </div>
  );
}
```
