# WISH: Omni V1 API Wrapper

**Status:** DRAFT
**Beads:** omni-8g3
**Priority:** P1

## Context

Omni v1 has an established REST API that the v1 UI and external integrations depend on. To enable gradual migration, v2 needs to provide a compatibility layer that proxies v1 API calls to the v2 backend.

**V1 Reference Files:**
- `/home/cezar/dev/omni/src/api/app.py` - Main app with all routes
- `/home/cezar/dev/omni/src/api/routes/` - All route definitions
- `/home/cezar/dev/omni/resources/ui/src/lib/api.ts` - UI API client (shows all endpoints used)

## Problem Statement

V2 cannot be adopted incrementally because:
1. The v1 UI depends on v1 API endpoints
2. External integrations use v1 API
3. The API structure differs between v1 and v2

A wrapper allows the v1 UI to work with v2 backend during migration.

## Scope

### IN SCOPE

1. **Core Instance Endpoints**
   - `GET /api/v1/instances` - List instances
   - `GET /api/v1/instances/:name` - Get instance
   - `POST /api/v1/instances` - Create instance
   - `PUT /api/v1/instances/:name` - Update instance
   - `DELETE /api/v1/instances/:name` - Delete instance
   - `GET /api/v1/instances/:name/status` - Instance status
   - `POST /api/v1/instances/:name/connect` - Connect instance
   - `POST /api/v1/instances/:name/disconnect` - Disconnect instance

2. **Messaging Endpoints**
   - `POST /api/v1/instance/:name/send-text` - Send text message
   - `POST /api/v1/instance/:name/send-media` - Send media
   - `POST /api/v1/instance/:name/send-audio` - Send audio
   - `POST /api/v1/instance/:name/send-tts` - Send TTS (via TTS wish)
   - `POST /api/v1/instance/:name/send-reaction` - Send reaction

3. **Omni Abstraction Endpoints**
   - `GET /api/v1/omni/chats/:instance` - List chats
   - `GET /api/v1/omni/contacts/:instance` - List contacts
   - `GET /api/v1/omni/messages/:instance` - List messages
   - `GET /api/v1/omni/message/:instance/:messageId` - Get message

4. **Settings Endpoints**
   - `GET /api/v1/settings` - Get all settings
   - `GET /api/v1/settings/:key` - Get setting
   - `PUT /api/v1/settings/:key` - Update setting

5. **Batch Jobs Endpoints** (via batch wish)
   - `POST /api/v1/batch-jobs` - Create job
   - `GET /api/v1/batch-jobs/:id/status` - Job status
   - `GET /api/v1/batch-jobs/:id/details` - Job details

6. **Media Content Endpoints**
   - `GET /api/v1/media-content` - List processed media
   - `GET /api/v1/media-content/:id` - Get media content

7. **Access Control Endpoints**
   - `GET /api/v1/access-rules/:instance` - List rules
   - `POST /api/v1/access-rules/:instance` - Create rule
   - `DELETE /api/v1/access-rules/:instance/:id` - Delete rule

### OUT OF SCOPE

- Traces/analytics endpoints (v2 has different event model)
- Webhook registration (handled differently in v2)
- Admin endpoints (user management)
- Complete feature parity (focus on UI-critical endpoints)

## Technical Design

### Wrapper Architecture

```
V1 UI Request
     ↓
V2 API Server (Hono)
     ↓
V1 Compatibility Router (/api/v1/*)
     ↓
Transform Request (v1 → v2 format)
     ↓
Call V2 Service/Route
     ↓
Transform Response (v2 → v1 format)
     ↓
Return V1-compatible Response
```

### Router Structure

```typescript
// packages/api/src/routes/v1-compat/index.ts

import { Hono } from 'hono';
import { instancesRouter } from './instances';
import { messagesRouter } from './messages';
import { omniRouter } from './omni';
import { settingsRouter } from './settings';
import { batchJobsRouter } from './batch-jobs';
import { mediaContentRouter } from './media-content';
import { accessRouter } from './access';

export const v1CompatRouter = new Hono()
  .route('/instances', instancesRouter)
  .route('/instance', messagesRouter) // Note: v1 uses /instance/:name/send-*
  .route('/omni', omniRouter)
  .route('/settings', settingsRouter)
  .route('/batch-jobs', batchJobsRouter)
  .route('/media-content', mediaContentRouter)
  .route('/access-rules', accessRouter);

// Mount at /api/v1
app.route('/api/v1', v1CompatRouter);
```

### Request/Response Transformers

```typescript
// packages/api/src/routes/v1-compat/transformers.ts

// V1 uses different field names and structures
export function transformV1InstanceToV2(v1Instance: V1Instance): V2Instance {
  return {
    id: v1Instance.name, // v1 uses name as ID
    name: v1Instance.name,
    channelType: v1Instance.channel_type,
    // ... map other fields
  };
}

export function transformV2InstanceToV1(v2Instance: V2Instance): V1Instance {
  return {
    name: v2Instance.id,
    channel_type: v2Instance.channelType,
    // ... map other fields
  };
}

// Similar transformers for messages, chats, contacts, etc.
```

### Example Route Implementation

```typescript
// packages/api/src/routes/v1-compat/instances.ts

import { Hono } from 'hono';
import { instancesService } from '../../services/instances';
import { transformV2InstanceToV1 } from './transformers';

export const instancesRouter = new Hono()
  .get('/', async (c) => {
    const instances = await instancesService.list();
    return c.json(instances.map(transformV2InstanceToV1));
  })
  .get('/:name', async (c) => {
    const instance = await instancesService.get(c.req.param('name'));
    if (!instance) {
      return c.json({ error: 'Instance not found' }, 404);
    }
    return c.json(transformV2InstanceToV1(instance));
  })
  // ... other endpoints
```

## Implementation Groups

### Group 1: Foundation
- [ ] Create v1-compat router structure
- [ ] Create base transformers module
- [ ] Mount at /api/v1

### Group 2: Instance Endpoints
- [ ] Implement instance CRUD endpoints
- [ ] Implement connect/disconnect endpoints
- [ ] Implement status endpoint

### Group 3: Messaging Endpoints
- [ ] Implement send-text endpoint
- [ ] Implement send-media endpoint
- [ ] Implement send-audio endpoint
- [ ] Implement send-reaction endpoint

### Group 4: Omni Endpoints
- [ ] Implement chats endpoint
- [ ] Implement contacts endpoint
- [ ] Implement messages endpoint

### Group 5: Supporting Endpoints
- [ ] Implement settings endpoints
- [ ] Implement access rules endpoints
- [ ] Implement media content endpoints

### Group 6: Testing
- [ ] Integration tests with v1 API client
- [ ] Verify v1 UI works with v2 backend

## Success Criteria

- [ ] V1 UI can connect to v2 backend
- [ ] All critical v1 endpoints are supported
- [ ] Response formats match v1 exactly
- [ ] No breaking changes for v1 clients

## Dependencies

- All core v2 services must be implemented
- TTS endpoint (send-tts wish)
- Batch jobs (media-processing-batch wish)
