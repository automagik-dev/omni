---
title: "V1 API Compatibility Layer"
created: 2025-01-29
updated: 2026-02-09
tags: [api, v1, migration, compatibility]
status: current
---

# V1 API Compatibility Layer

> Complete mapping of v1 API endpoints to v2 implementation for seamless UI migration.

> Related: [[endpoints|API Endpoints]], [[design|API Design]], [[plan|Migration Plan]]

## Overview

The v1 compatibility layer allows the existing React UI to work with v2 backend during migration. All v1 endpoints are thin wrappers that:

1. Accept v1 request format
2. Transform to v2 format
3. Call v2 implementation
4. Transform response back to v1 format

## Endpoint Mapping

### Instances (`/api/v1/instances`)

| V1 Endpoint | V2 Endpoint | Transform Notes |
|-------------|-------------|-----------------|
| `GET /api/v1/instances` | `GET /api/v2/instances` | Add `channel_type` → `channel` mapping |
| `GET /api/v1/instances/:name` | `GET /api/v2/instances/:name` | Same |
| `POST /api/v1/instances` | `POST /api/v2/instances` | Transform field names |
| `PUT /api/v1/instances/:name` | `PATCH /api/v2/instances/:name` | Transform field names |
| `DELETE /api/v1/instances/:name` | `DELETE /api/v2/instances/:name` | Same |
| `GET /api/v1/instances/:name/qr` | `GET /api/v2/instances/:name/qr` | Same |
| `GET /api/v1/instances/:name/status` | `GET /api/v2/instances/:name/status` | Same |
| `POST /api/v1/instances/:name/restart` | `POST /api/v2/instances/:name/restart` | Same |
| `POST /api/v1/instances/:name/logout` | `POST /api/v2/instances/:name/logout` | Same |
| `POST /api/v1/instances/:name/connect` | `POST /api/v2/instances/:name/connect` | Same |
| `POST /api/v1/instances/:name/disconnect` | `POST /api/v2/instances/:name/disconnect` | Same |
| `PUT /api/v1/instances/:name/profile` | `PATCH /api/v2/instances/:name/profile` | Same |
| `POST /api/v1/instances/discover` | `POST /api/v2/instances/discover` | Same |
| `GET /api/v1/instances/supported-channels` | `GET /api/v2/channels` | Different response format |

#### Instance Field Mapping

```typescript
// V1 → V2 field mapping
const instanceFieldMap = {
  // WhatsApp fields (v1 Evolution → v2 Baileys)
  'evolution_url': null,           // Removed (no Evolution in v2)
  'evolution_key': null,           // Removed
  'whatsapp_web_url': null,        // Removed (built-in Baileys)
  'whatsapp_web_key': null,        // Removed
  'whatsapp_instance': 'name',     // Use instance name directly

  // Channel type
  'channel_type': 'channel',       // 'whatsapp' → 'whatsapp-baileys'

  // Agent fields (unchanged)
  'agent_api_url': 'agentApiUrl',
  'agent_api_key': 'agentApiKey',
  'agent_id': 'agentId',
  'agent_type': 'agentType',
  'agent_timeout': 'agentTimeout',
  'agent_stream_mode': 'agentStreamMode',
  'agent_provider_id': 'agentProviderId',

  // Profile (unchanged)
  'profile_name': 'profileName',
  'profile_pic_url': 'profilePicUrl',
  'owner_jid': 'ownerIdentifier',

  // Processing config (unchanged, just camelCase)
  'enable_auto_split': 'enableAutoSplit',
  'disable_username_prefix': 'disableUsernamePrefix',
  'process_media_on_blocked': 'processMediaOnBlocked',
  'message_debounce_mode': 'messageDebounceMode',
  'message_debounce_min_ms': 'messageDebounceMinMs',
  'message_debounce_max_ms': 'messageDebounceMaxMs',
  'message_split_delay_mode': 'messageSplitDelayMode',
  'message_split_delay_fixed_ms': 'messageSplitDelayFixedMs',
  'message_split_delay_min_ms': 'messageSplitDelayMinMs',
  'message_split_delay_max_ms': 'messageSplitDelayMaxMs',
};

// Channel type mapping
const channelTypeMap = {
  'whatsapp': 'whatsapp-baileys',
  'discord': 'discord',
  'slack': 'slack',
  'telegram': 'telegram',
};
```

---

### Messages (`/api/v1/{instance}/send-*`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `POST /api/v1/:instance/send-text` | `POST /api/v2/messages/text` | Add `instanceId` to body |
| `POST /api/v1/:instance/send-media` | `POST /api/v2/messages/media` | Same |
| `POST /api/v1/:instance/send-audio` | `POST /api/v2/messages/audio` | Same |
| `POST /api/v1/:instance/send-sticker` | `POST /api/v2/messages/sticker` | Same |
| `POST /api/v1/:instance/send-contact` | `POST /api/v2/messages/contact` | Same |
| `POST /api/v1/:instance/send-reaction` | `POST /api/v2/messages/reaction` | Same |
| `POST /api/v1/:instance/fetch-profile` | `GET /api/v2/instances/:id/contacts/:contactId` | Different approach |
| `POST /api/v1/:instance/update-profile-picture` | `PATCH /api/v2/instances/:id/profile` | Same |

#### Message Request Transformation

```typescript
// V1 send-text request
interface V1SendTextRequest {
  recipientId: string;    // Phone number or chat ID
  message: string;
  mentions?: string[];    // Phone numbers to mention
  mentionMode?: 'explicit' | 'auto';
  quotedMessageId?: string;
}

// V2 send-text request
interface V2SendTextRequest {
  instanceId: string;     // From URL param in v1
  to: string;             // = recipientId
  content: string;        // = message
  mentions?: string[];
  replyTo?: string;       // = quotedMessageId
}

// Transform function
function transformSendText(instanceName: string, v1: V1SendTextRequest): V2SendTextRequest {
  return {
    instanceId: instanceName,
    to: v1.recipientId,
    content: v1.message,
    mentions: v1.mentions,
    replyTo: v1.quotedMessageId,
  };
}
```

---

### Users → Persons (`/api/v1/users`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/users` | `GET /api/v2/persons` | Response field mapping |
| `GET /api/v1/users/:id` | `GET /api/v2/persons/:id` | Same |
| `POST /api/v1/users/:id/link` | `POST /api/v2/persons/:id/identities` | Different structure |
| `POST /api/v1/users/:id/merge` | `POST /api/v2/persons/:id/merge` | Same |
| `DELETE /api/v1/users/:id` | `DELETE /api/v2/persons/:id` | Same |

#### User → Person Field Mapping

```typescript
// V1 User
interface V1User {
  id: string;
  phone_number: string;
  whatsapp_jid: string;
  discord_user_id?: string;
  discord_username?: string;
  display_name?: string;
  instance_name: string;
  channel_type: string;
  last_seen_at: string;
  message_count: number;
  external_ids: Array<{
    provider: string;
    external_id: string;
  }>;
}

// V2 Person with identities
interface V2Person {
  id: string;
  displayName?: string;
  primaryPhone?: string;
  primaryEmail?: string;
  avatarUrl?: string;
  createdAt: string;
  updatedAt: string;
  identities: Array<{
    id: string;
    channel: string;
    instanceId: string;
    platformUserId: string;
    platformUsername?: string;
    messageCount: number;
    lastSeenAt?: string;
  }>;
}

// Transform V2 Person → V1 User (for backward compat response)
function personToUser(person: V2Person, instanceName?: string): V1User {
  // Find the primary identity (first WhatsApp, or first identity)
  const primaryIdentity = person.identities.find(i =>
    i.channel.startsWith('whatsapp') && (!instanceName || i.instanceId === instanceName)
  ) || person.identities[0];

  return {
    id: person.id,
    phone_number: person.primaryPhone || '',
    whatsapp_jid: primaryIdentity?.platformUserId || '',
    discord_user_id: person.identities.find(i => i.channel === 'discord')?.platformUserId,
    discord_username: person.identities.find(i => i.channel === 'discord')?.platformUsername,
    display_name: person.displayName,
    instance_name: primaryIdentity?.instanceId || '',
    channel_type: primaryIdentity?.channel.replace('-baileys', '').replace('-cloud', '') || 'whatsapp',
    last_seen_at: primaryIdentity?.lastSeenAt || person.updatedAt,
    message_count: primaryIdentity?.messageCount || 0,
    external_ids: person.identities.map(i => ({
      provider: i.channel,
      external_id: i.platformUserId,
    })),
  };
}
```

---

### Providers (`/api/v1/providers`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/providers` | `GET /api/v2/providers` | Same |
| `GET /api/v1/providers/:id` | `GET /api/v2/providers/:id` | Same |
| `POST /api/v1/providers` | `POST /api/v2/providers` | Add `schema` field detection |
| `PUT /api/v1/providers/:id` | `PATCH /api/v2/providers/:id` | Same |
| `DELETE /api/v1/providers/:id` | `DELETE /api/v2/providers/:id` | Same |
| `POST /api/v1/providers/:id/health` | `POST /api/v2/providers/:id/health` | Same |
| `GET /api/v1/providers/:id/agents` | `GET /api/v2/providers/:id/agents` | Same |
| `GET /api/v1/providers/:id/teams` | `GET /api/v2/providers/:id/teams` | Same |

#### Provider Field Mapping

```typescript
// V1 Provider (no schema field)
interface V1Provider {
  id: number;                    // Integer ID
  name: string;
  api_url: string;
  api_key: string;
  description?: string;
  is_active: boolean;
  last_health_check?: string;
  last_health_status?: string;
}

// V2 Provider (with schema)
interface V2Provider {
  id: string;                    // UUID
  name: string;
  schema: 'openai' | 'anthropic' | 'agno' | 'custom';
  baseUrl: string;
  apiKey: string;
  schemaConfig?: object;
  description?: string;
  isActive: boolean;
  lastHealthCheck?: string;
  lastHealthStatus?: string;
}

// Auto-detect schema from URL
function detectSchema(apiUrl: string): string {
  if (apiUrl.includes('openai.com')) return 'openai';
  if (apiUrl.includes('anthropic.com')) return 'anthropic';
  return 'agno'; // Default for v1 compatibility
}

// Transform V1 → V2
function v1ToV2Provider(v1: V1Provider): Partial<V2Provider> {
  return {
    name: v1.name,
    schema: detectSchema(v1.api_url),
    baseUrl: v1.api_url,
    apiKey: v1.api_key,
    description: v1.description,
    isActive: v1.is_active,
  };
}

// Transform V2 → V1 (for response)
function v2ToV1Provider(v2: V2Provider): V1Provider {
  return {
    id: parseInt(v2.id.slice(0, 8), 16) % 1000000, // Fake integer ID
    name: v2.name,
    api_url: v2.baseUrl,
    api_key: v2.apiKey,
    description: v2.description,
    is_active: v2.isActive,
    last_health_check: v2.lastHealthCheck,
    last_health_status: v2.lastHealthStatus,
  };
}
```

---

### Settings (`/api/v1/settings`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/settings` | `GET /api/v2/settings` | Same |
| `GET /api/v1/settings/:key` | `GET /api/v2/settings/:key` | Same |
| `POST /api/v1/settings` | `POST /api/v2/settings` | Same |
| `PUT /api/v1/settings/:key` | `PATCH /api/v2/settings/:key` | Same |
| `DELETE /api/v1/settings/:key` | `DELETE /api/v2/settings/:key` | Same |
| `GET /api/v1/settings/:key/history` | `GET /api/v2/settings/:key/history` | Same |

---

### Access Rules (`/api/v1/access`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/access/rules` | `GET /api/v2/access/rules` | Same |
| `POST /api/v1/access/rules` | `POST /api/v2/access/rules` | Same |
| `DELETE /api/v1/access/rules/:id` | `DELETE /api/v2/access/rules/:id` | Same |

---

### Traces → Events (`/api/v1/traces`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/traces` | `GET /api/v2/events` | Field mapping |
| `GET /api/v1/traces/:id` | `GET /api/v2/events/:id` | Same |
| `GET /api/v1/traces/:id/payloads` | `GET /api/v2/events/:id` | Payloads are inline in v2 |
| `GET /api/v1/traces/analytics/summary` | `GET /api/v2/events/analytics/summary` | Same |
| `GET /api/v1/traces/phone/:phone` | `GET /api/v2/events?phone=:phone` | Query param in v2 |
| `DELETE /api/v1/traces/cleanup` | `DELETE /api/v2/events/cleanup` | Same |

#### Trace → Event Field Mapping

```typescript
// V1 Trace
interface V1Trace {
  trace_id: string;
  instance_name: string;
  whatsapp_message_id: string;
  sender_phone: string;
  sender_name?: string;
  message_type: string;
  has_media: boolean;
  has_quoted_message: boolean;
  status: string;
  error_message?: string;
  error_stage?: string;
  received_at: string;
  completed_at?: string;
  processing_time_ms?: number;
}

// V2 Event
interface V2Event {
  id: string;
  externalId: string;
  channel: string;
  instanceId: string;
  personId?: string;
  eventType: string;
  direction: string;
  contentType?: string;
  textContent?: string;
  status: string;
  errorMessage?: string;
  errorStage?: string;
  receivedAt: string;
  processedAt?: string;
  processingTimeMs?: number;
  rawPayload?: object;
  agentRequest?: object;
  agentResponse?: object;
}

// Transform V2 Event → V1 Trace (for backward compat)
function eventToTrace(event: V2Event, person?: V2Person): V1Trace {
  return {
    trace_id: event.id,
    instance_name: event.instanceId,
    whatsapp_message_id: event.externalId,
    sender_phone: person?.primaryPhone || '',
    sender_name: person?.displayName,
    message_type: event.contentType || 'text',
    has_media: ['audio', 'image', 'video', 'document', 'sticker'].includes(event.contentType || ''),
    has_quoted_message: !!event.rawPayload?.quotedMessage,
    status: event.status,
    error_message: event.errorMessage,
    error_stage: event.errorStage,
    received_at: event.receivedAt,
    completed_at: event.processedAt,
    processing_time_ms: event.processingTimeMs,
  };
}
```

---

### Media Content & Batch Jobs (`/api/v1/media-content`, `/api/v1/batch-jobs`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/media-content` | `GET /api/v2/media` | Same |
| `GET /api/v1/media-content/:id` | `GET /api/v2/media/:id` | Same |
| `POST /api/v1/media-content/reprocess-batch` | `POST /api/v2/batch-jobs` | Different body structure |
| `GET /api/v1/batch-jobs` | `GET /api/v2/batch-jobs` | Same |
| `GET /api/v1/batch-jobs/:id` | `GET /api/v2/batch-jobs/:id` | Same |
| `GET /api/v1/batch-jobs/:id/details` | `GET /api/v2/batch-jobs/:id/items` | Same |
| `DELETE /api/v1/batch-jobs/:id` | `DELETE /api/v2/batch-jobs/:id` | Same |

---

### Chats & Contacts (`/api/v1/{instance}/chats`, `/api/v1/{instance}/contacts`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/:instance/chats` | `GET /api/v2/instances/:id/chats` | Same |
| `GET /api/v1/:instance/chats/:chatId` | `GET /api/v2/instances/:id/chats/:chatId` | Same |
| `GET /api/v1/:instance/chats/:chatId/messages` | `GET /api/v2/instances/:id/chats/:chatId/messages` | Same |
| `PATCH /api/v1/instances/:name/chats/:chatId/processing` | `PATCH /api/v2/instances/:id/chats/:chatId/processing` | Same |
| `PATCH /api/v1/instances/:name/chats/processing/bulk` | `PATCH /api/v2/instances/:id/chats/processing/bulk` | Same |
| `GET /api/v1/:instance/contacts` | `GET /api/v2/instances/:id/contacts` | Same |
| `GET /api/v1/:instance/contacts/:contactId` | `GET /api/v2/instances/:id/contacts/:contactId` | Same |
| `GET /api/v1/:instance/messages/:messageId/media` | `GET /api/v2/instances/:id/messages/:messageId/media` | Same |
| `GET /api/v1/:instance/profile-picture/:jid` | `GET /api/v2/instances/:id/profile-picture/:jid` | Same |
| `POST /api/v1/:instance/sync` | `POST /api/v2/instances/:id/sync` | Same |
| `POST /api/v1/:instance/validate-recipient` | `POST /api/v2/instances/:id/validate-recipient` | Same |

---

### Services (`/api/v1/services` - mapped from logs routes)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/logs/services` | `GET /api/v2/services` | Same |
| `GET /api/logs/status` | `GET /api/v2/services/status` | Same |
| `GET /api/logs/status/:service` | `GET /api/v2/services/:name/status` | Same |
| `POST /api/logs/restart/:service` | `POST /api/v2/services/:name/restart` | Same |
| `GET /api/logs/recent` | `GET /api/v2/logs/recent` | Same |

---

### WebSocket Logs (`/api/logs/stream` → `/api/v2/ws/logs`)

The v1 UI uses Server-Sent Events (SSE), while v2 uses WebSocket.

```typescript
// V1 compatibility: SSE endpoint that wraps WebSocket
// GET /api/logs/stream → SSE that connects to /api/v2/ws/logs internally

app.get('/api/logs/stream', (c) => {
  // Create SSE stream
  return streamSSE(c, async (stream) => {
    // Connect to v2 WebSocket internally
    const ws = new WebSocket(`ws://localhost:${port}/api/v2/ws/logs`);

    ws.onmessage = (event) => {
      // Convert WebSocket message to SSE format
      const data = JSON.parse(event.data);
      stream.writeSSE({
        event: 'log',
        data: JSON.stringify(data),
      });
    };

    ws.onopen = () => {
      stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({ status: 'connected' }),
      });

      // Subscribe to services based on query params
      const services = c.req.query('services')?.split(',') || [];
      if (services.length > 0) {
        ws.send(JSON.stringify({
          type: 'subscribe',
          services,
        }));
      }
    };

    // Keep connection alive
    await new Promise((resolve) => {
      c.req.raw.signal.addEventListener('abort', () => {
        ws.close();
        resolve(undefined);
      });
    });
  });
});
```

---

### Setup & Onboarding (`/api/v1/setup`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/setup/status` | `GET /api/v2/setup/status` | Same |
| `POST /api/v1/setup/initialize` | N/A | Not needed (env-based in v2) |
| `POST /api/v1/setup/complete` | `POST /api/v2/setup/complete` | Same |
| `GET /api/v1/setup/api-key` | `GET /api/v2/setup/api-key` | Same |
| `GET /api/v1/setup/channels/status` | `GET /api/v2/setup/channels/status` | Same |
| `POST /api/v1/setup/channels/configure` | `POST /api/v2/setup/channels/configure` | Same |
| `POST /api/v1/setup/channels/validate-discord` | `POST /api/v2/setup/channels/validate-discord` | Same |
| `GET /api/v1/setup/public-url` | N/A | Use `PUBLIC_URL` env in v2 |
| `POST /api/v1/setup/public-url` | N/A | Use `PUBLIC_URL` env in v2 |
| `GET /api/v1/setup/network-mode` | N/A | Removed in v2 |
| `POST /api/v1/setup/network-mode` | N/A | Removed in v2 |

---

### MCP Server (`/api/v1/mcp`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/mcp/status` | `GET /api/v2/mcp/status` | Same |
| `POST /api/v1/mcp/start` | `POST /api/v2/mcp/start` | Same |
| `POST /api/v1/mcp/stop` | `POST /api/v2/mcp/stop` | Same |
| `POST /api/v1/mcp/install` | `POST /api/v2/mcp/install` | Same |

---

### Database Configuration (`/api/v1/database`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/database/config` | N/A | Not needed (env-based) |
| `POST /api/v1/database/test` | N/A | Not needed |
| `POST /api/v1/database/apply` | N/A | Not needed |
| `POST /api/v1/database/redis/test` | N/A | Not needed |
| `GET /api/v1/database/detect-evolution` | N/A | No Evolution in v2 |

These endpoints return stub responses for backward compatibility:

```typescript
// Stub responses for removed database config endpoints
app.get('/api/v1/database/config', () => {
  return c.json({
    runtime_config: {
      db_type: 'postgresql',
      database_url: '[configured via environment]',
    },
    saved_config: {
      db_type: 'postgresql',
    },
    requires_restart: false,
    is_locked: true, // Prevent UI from showing config options
  });
});
```

---

### Internal APIs (`/api/v1/_internal`, `/api/internal`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /_internal/evolution-key` | N/A | No Evolution in v2 |
| `GET /_internal/subprocess-config` | `GET /api/v2/internal/subprocess-config` | If still needed |
| `GET /_internal/health` | `GET /health` | Same |
| `GET /_internal/channel-startup-info` | `GET /api/v2/internal/channel-startup-info` | Same |
| `GET /api/internal/setup/status` | `GET /api/v2/setup/status` | Same |
| `POST /api/internal/setup/complete` | `POST /api/v2/setup/complete` | Same |

---

### Recovery (`/api/v1/recovery`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /api/v1/recovery/api-key` | N/A | Use CLI instead |

Stub response for UI compatibility:

```typescript
app.get('/api/v1/recovery/api-key', (c) => {
  return c.json({
    error: 'API key recovery is now done via CLI: bun run cli settings api-key --regenerate',
    help: 'Run this command on the server to regenerate your API key.',
  }, 410); // Gone
});
```

---

### Gateway/Channel Management (`/gateway`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `GET /gateway/channels` | `GET /api/v2/channels` | Different format |
| `POST /gateway/channels/:channel/start` | `POST /api/v2/services/:name/start` | Same |
| `POST /gateway/channels/:channel/stop` | `POST /api/v2/services/:name/stop` | Same |
| `POST /gateway/channels/:channel/restart` | `POST /api/v2/services/:name/restart` | Same |
| `GET /gateway/status` | `GET /api/v2/health` | Same |
| `GET /api/gateway/discord-status` | `GET /api/v2/services/discord/status` | Same |
| `GET /api/gateway/install-discord` | `POST /api/v2/services/discord/install` | POST in v2 |

---

### Sync (`/api/v1/sync`)

| V1 Endpoint | V2 Endpoint | Notes |
|-------------|-------------|-------|
| `POST /api/v1/sync` | N/A | Removed (UI-layer concern) |
| `GET /api/v1/sync` | N/A | Removed |

Stub responses:

```typescript
// Preferences sync removed - UI handles this internally
app.post('/api/v1/sync', () => c.json({ success: true }));
app.get('/api/v1/sync', () => c.json({ preferences: {} }));
```

---

## Implementation Pattern

### Compatibility Router

```typescript
// packages/api/src/routes/v1-compat/index.ts

import { Hono } from 'hono';
import { instancesV1 } from './instances';
import { usersV1 } from './users';
import { providersV1 } from './providers';
import { settingsV1 } from './settings';
import { accessV1 } from './access';
import { tracesV1 } from './traces';
import { mediaV1 } from './media';
import { setupV1 } from './setup';
import { logsV1 } from './logs';
import { mcpV1 } from './mcp';

export const v1Router = new Hono();

// Mount all v1 compatibility routes
v1Router.route('/instances', instancesV1);
v1Router.route('/users', usersV1);
v1Router.route('/providers', providersV1);
v1Router.route('/settings', settingsV1);
v1Router.route('/access', accessV1);
v1Router.route('/traces', tracesV1);
v1Router.route('/media-content', mediaV1);
v1Router.route('/batch-jobs', mediaV1);
v1Router.route('/setup', setupV1);
v1Router.route('/mcp', mcpV1);

// Legacy logs routes (different base path)
export const logsRouter = new Hono();
logsRouter.route('/', logsV1);
```

### Example: Instances Compatibility

```typescript
// packages/api/src/routes/v1-compat/instances.ts

import { Hono } from 'hono';
import { instanceService } from '../../services/instance';

export const instancesV1 = new Hono();

// List instances
instancesV1.get('/', async (c) => {
  const includeStatus = c.req.query('include_status') === 'true';
  const limit = parseInt(c.req.query('limit') || '100');

  // Call v2 service
  const instances = await instanceService.list({ includeStatus, limit });

  // Transform to v1 format
  const v1Instances = instances.map(transformInstanceToV1);

  return c.json(v1Instances);
});

// Get instance
instancesV1.get('/:name', async (c) => {
  const name = c.req.param('name');

  const instance = await instanceService.getByName(name);
  if (!instance) {
    return c.json({ error: 'Instance not found' }, 404);
  }

  return c.json(transformInstanceToV1(instance));
});

// Create instance
instancesV1.post('/', async (c) => {
  const v1Body = await c.req.json();

  // Transform v1 → v2 format
  const v2Body = transformInstanceFromV1(v1Body);

  const instance = await instanceService.create(v2Body);

  return c.json(transformInstanceToV1(instance));
});

// ... more endpoints

// Transform functions
function transformInstanceToV1(instance: V2Instance): V1Instance {
  return {
    id: parseInt(instance.id.slice(0, 8), 16) % 1000000, // Fake int ID
    name: instance.name,
    channel_type: instance.channel.replace('-baileys', '').replace('-cloud', ''),
    is_active: instance.isActive,
    is_default: instance.isDefault,
    created_at: instance.createdAt,
    updated_at: instance.updatedAt,

    // WhatsApp fields (stub for removed Evolution)
    evolution_url: null,
    evolution_key: null,
    whatsapp_web_url: null,
    whatsapp_web_key: null,
    whatsapp_instance: instance.name,

    // Discord fields
    discord_bot_token: instance.discordBotToken,
    discord_client_id: instance.discordClientId,
    discord_guild_id: instance.discordGuildIds?.[0],
    discord_default_channel_id: instance.discordDefaultChannelId,
    discord_voice_enabled: instance.discordVoiceEnabled,
    discord_slash_commands_enabled: instance.discordSlashCommandsEnabled,

    // Agent fields
    agent_provider_id: instance.agentProviderId,
    agent_api_url: instance.agentApiUrl,
    agent_api_key: instance.agentApiKey,
    agent_id: instance.agentId,
    agent_type: instance.agentType,
    agent_timeout: instance.agentTimeout,
    agent_stream_mode: instance.agentStreamMode,

    // Profile
    profile_name: instance.profileName,
    profile_pic_url: instance.profilePicUrl,
    owner_jid: instance.ownerIdentifier,

    // Processing config
    enable_auto_split: instance.enableAutoSplit,
    disable_username_prefix: instance.disableUsernamePrefix,
    process_media_on_blocked: instance.processMediaOnBlocked,
    message_debounce_mode: instance.messageDebounceMode,
    message_debounce_min_ms: instance.messageDebounceMinMs,
    message_debounce_max_ms: instance.messageDebounceMaxMs,
    message_split_delay_mode: instance.messageSplitDelayMode,
    message_split_delay_fixed_ms: instance.messageSplitDelayFixedMs,
    message_split_delay_min_ms: instance.messageSplitDelayMinMs,
    message_split_delay_max_ms: instance.messageSplitDelayMaxMs,
  };
}

function transformInstanceFromV1(v1: Partial<V1Instance>): Partial<V2Instance> {
  return {
    name: v1.name,
    channel: channelTypeMap[v1.channel_type || 'whatsapp'] || 'whatsapp-baileys',
    isActive: v1.is_active,
    isDefault: v1.is_default,

    // Discord
    discordBotToken: v1.discord_bot_token,
    discordClientId: v1.discord_client_id,
    discordGuildIds: v1.discord_guild_id ? [v1.discord_guild_id] : undefined,
    discordDefaultChannelId: v1.discord_default_channel_id,
    discordVoiceEnabled: v1.discord_voice_enabled,
    discordSlashCommandsEnabled: v1.discord_slash_commands_enabled,

    // Agent
    agentProviderId: v1.agent_provider_id,
    agentApiUrl: v1.agent_api_url,
    agentApiKey: v1.agent_api_key,
    agentId: v1.agent_id,
    agentType: v1.agent_type,
    agentTimeout: v1.agent_timeout,
    agentStreamMode: v1.agent_stream_mode,

    // Processing
    enableAutoSplit: v1.enable_auto_split,
    disableUsernamePrefix: v1.disable_username_prefix,
    processMediaOnBlocked: v1.process_media_on_blocked,
    messageDebounceMode: v1.message_debounce_mode,
    messageDebounceMinMs: v1.message_debounce_min_ms,
    messageDebounceMaxMs: v1.message_debounce_max_ms,
    messageSplitDelayMode: v1.message_split_delay_mode,
    messageSplitDelayFixedMs: v1.message_split_delay_fixed_ms,
    messageSplitDelayMinMs: v1.message_split_delay_min_ms,
    messageSplitDelayMaxMs: v1.message_split_delay_max_ms,
  };
}
```

---

## Testing Strategy

### Compatibility Test Suite

```typescript
// tests/v1-compat/instances.test.ts

import { describe, test, expect } from 'bun:test';
import { app } from '../../src/app';

describe('V1 Instance Compatibility', () => {
  test('GET /api/v1/instances returns v1 format', async () => {
    const res = await app.request('/api/v1/instances');
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(data)).toBe(true);

    // Check v1 field names
    if (data.length > 0) {
      expect(data[0]).toHaveProperty('channel_type'); // v1 uses snake_case
      expect(data[0]).toHaveProperty('is_active');
      expect(data[0]).toHaveProperty('evolution_url'); // Even if null
    }
  });

  test('POST /api/v1/instances accepts v1 format', async () => {
    const v1Instance = {
      name: 'test-instance',
      channel_type: 'whatsapp',
      agent_api_url: 'https://api.example.com',
      agent_api_key: 'test-key',
    };

    const res = await app.request('/api/v1/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(v1Instance),
    });

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.name).toBe('test-instance');
    expect(data.channel_type).toBe('whatsapp'); // Returns v1 format
  });
});
```

---

## Deprecation Timeline

| Phase | Timeline | Actions |
|-------|----------|---------|
| **Phase 1** | Weeks 1-4 | v1 compat layer implemented and tested |
| **Phase 2** | Weeks 5-8 | UI migrated to use v2 directly where possible |
| **Phase 3** | Weeks 9-12 | Deprecation warnings added to v1 endpoints |
| **Phase 4** | Weeks 13-16 | v1 endpoints removed, v2 only |

### Deprecation Warnings

```typescript
// Add deprecation header to all v1 routes
v1Router.use('*', async (c, next) => {
  await next();

  // Add deprecation header
  c.header('Deprecation', 'true');
  c.header('Sunset', 'Sat, 01 Jun 2026 00:00:00 GMT');
  c.header('Link', '</api/v2>; rel="successor-version"');
});
```

---

## Summary

This v1 compatibility layer ensures:

1. **100% UI compatibility** - All v1 endpoints map to v2
2. **Field transformation** - snake_case ↔ camelCase handled
3. **Removed features stubbed** - Database config, network mode return stubs
4. **Clear deprecation path** - Sunset headers guide migration
5. **Testable** - Each endpoint has compatibility tests
