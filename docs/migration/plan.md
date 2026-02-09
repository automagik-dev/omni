---
title: "Migration Plan: v1 to v2"
created: 2025-01-29
updated: 2026-02-09
tags: [migration, planning]
status: current
---

# Migration Plan: v1 to v2

> A phased approach to migrating from Omni v1 (Python/Evolution) to v2 (TypeScript/Baileys) with zero downtime.

> Related: [[v1-features-analysis|V1 Features Analysis]], [[ui-reuse|UI Reuse Strategy]], [[v1-compatibility-layer|V1 Compatibility Layer]]

## Migration Strategy: Strangler Fig Pattern

Rather than a big-bang migration, we'll gradually replace v1 components:

```
Phase 1: Run v2 alongside v1
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌─────────────┐         ┌─────────────┐                    │
│  │   Omni v1   │◄───────►│   Omni v2   │                    │
│  │  (Python)   │  proxy  │ (TypeScript)│                    │
│  └──────┬──────┘         └──────┬──────┘                    │
│         │                       │                            │
│         ▼                       ▼                            │
│  ┌─────────────┐         ┌─────────────┐                    │
│  │ PostgreSQL  │◄───────►│ PostgreSQL  │                    │
│  │   (v1 DB)   │  sync   │   (v2 DB)   │                    │
│  └─────────────┘         └─────────────┘                    │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Phase 2: New instances on v2, migrate old
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌─────────────┐                                            │
│  │   Omni v1   │  (legacy instances only)                   │
│  └──────┬──────┘                                            │
│         │         ┌─────────────┐                           │
│         └────────►│   Omni v2   │  (all new + migrated)     │
│                   └─────────────┘                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘

Phase 3: v1 deprecated
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│                   ┌─────────────┐                           │
│                   │   Omni v2   │  (all instances)          │
│                   └─────────────┘                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Phase 1: Foundation (Weeks 1-4)

### Goals
- v2 core running alongside v1
- Event system operational
- Identity graph populated from v1 data
- API compatibility layer for v1 endpoints

### Tasks

#### Week 1: Project Setup
- [ ] Initialize monorepo structure
- [ ] Set up Turborepo, TypeScript, ESLint
- [ ] Configure CI/CD pipelines
- [ ] Set up development environment
- [ ] Deploy NATS JetStream (can coexist with v1)

#### Week 2: Core Services
- [ ] Implement EventBus with NATS
- [ ] Create database schema (Drizzle)
- [ ] Implement IdentityService
- [ ] Write data migration scripts (v1 → v2 schema)

#### Week 3: API Layer
- [ ] Set up Hono HTTP server
- [ ] Implement authentication middleware
- [ ] Create v1-compatible endpoint wrappers
- [ ] Set up tRPC router

#### Week 4: Data Migration
- [ ] Migrate instances from v1 to v2 schema
- [ ] Migrate users → persons + platform_identities
- [ ] Migrate message_traces → omni_events
- [ ] Validate data integrity

### Data Migration Scripts

```typescript
// scripts/migrate-users.ts

import { v1Database, v2Database } from './connections';

async function migrateUsers() {
  const v1Users = await v1Database.query('SELECT * FROM users');

  for (const user of v1Users) {
    // Create person
    const [person] = await v2Database.insert(persons).values({
      displayName: user.name,
      primaryPhone: user.phone_number,
      metadata: { migratedFrom: 'v1', v1Id: user.id },
    }).returning();

    // Create platform identity for WhatsApp
    await v2Database.insert(platformIdentities).values({
      personId: person.id,
      channel: 'whatsapp-baileys',
      platformUserId: user.phone_number.replace(/[^0-9]/g, ''),
      platformUsername: user.name,
      profileData: {
        phone: user.phone_number,
        name: user.name,
      },
      lastSeenAt: user.last_seen_at,
      messageCount: user.message_count,
      linkedBy: 'initial',
      confidence: 1.0,
    });

    // Migrate external IDs
    const externalIds = await v1Database.query(
      'SELECT * FROM user_external_ids WHERE user_id = $1',
      [user.id]
    );

    for (const extId of externalIds) {
      await v2Database.insert(platformIdentities).values({
        personId: person.id,
        channel: mapChannelType(extId.channel),
        platformUserId: extId.external_id,
        instanceId: extId.instance_id,
        profileData: extId.metadata ?? {},
        linkedBy: 'initial',
        confidence: 1.0,
      });
    }
  }
}
```

```typescript
// scripts/migrate-traces.ts

async function migrateTraces(batchSize = 1000) {
  let offset = 0;

  while (true) {
    const traces = await v1Database.query(`
      SELECT * FROM message_traces
      ORDER BY created_at
      LIMIT $1 OFFSET $2
    `, [batchSize, offset]);

    if (traces.length === 0) break;

    const events = traces.map(trace => ({
      externalId: trace.whatsapp_message_id ?? trace.id,
      channel: trace.channel_type ?? 'whatsapp-baileys',
      instanceId: await resolveInstanceId(trace.instance_name),
      personId: await resolvePersonId(trace.sender_phone),
      eventType: 'message.received',
      direction: trace.direction ?? 'inbound',
      contentType: trace.message_type ?? 'text',
      textContent: trace.message_text,
      transcription: trace.audio_transcription,
      imageDescription: trace.image_description,
      rawPayload: trace.raw_webhook_payload,
      receivedAt: trace.created_at,
      processedAt: trace.completed_at,
      metadata: {
        migratedFrom: 'v1',
        v1Id: trace.id,
        processingTimeMs: trace.processing_time_ms,
        agentLatencyMs: trace.agent_latency_ms,
      },
    }));

    await v2Database.insert(omniEvents).values(events);
    offset += batchSize;

    console.log(`Migrated ${offset} traces`);
  }
}
```

## Phase 2: Channel Plugins (Weeks 5-8)

### Goals
- WhatsApp Baileys plugin operational
- WhatsApp Cloud API plugin operational
- Discord plugin migrated
- New instances created on v2
- `@omni/channel-sdk` published to npm (enables community plugins)

### Tasks

#### Week 5: WhatsApp Baileys Plugin
- [ ] Implement Baileys plugin
- [ ] Auth state migration from Evolution
- [ ] Test message sending/receiving
- [ ] Implement media handling

#### Week 6: WhatsApp Cloud API Plugin
- [ ] Implement Cloud API plugin
- [ ] OAuth flow for onboarding
- [ ] Webhook handlers
- [ ] Message templates support

#### Week 7: Discord Plugin
- [ ] Port Discord handler to plugin architecture
- [ ] Test with existing Discord instances
- [ ] OAuth flow for new bots

#### Week 8: Plugin Validation & SDK
- [ ] Run v1 and v2 in parallel for same instances
- [ ] Compare message delivery
- [ ] Fix discrepancies
- [ ] Performance benchmarking
- [ ] Publish `@omni/channel-sdk` to npm
- [ ] Document external plugin creation guide
- [ ] Create example external plugin (Telegram)

### Auth State Migration (WhatsApp)

```typescript
// scripts/migrate-whatsapp-auth.ts

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

async function migrateWhatsAppAuth() {
  // Evolution stores auth in database
  const instances = await v1Database.query(`
    SELECT i.*, e.auth_state
    FROM instance_configs i
    LEFT JOIN evo_auth e ON e.instance_name = i.name
    WHERE i.channel_type = 'whatsapp'
  `);

  for (const instance of instances) {
    if (!instance.auth_state) {
      console.log(`No auth state for ${instance.name}, will need QR scan`);
      continue;
    }

    // Baileys uses file-based auth state
    const authDir = join('./data/auth/whatsapp', instance.id);
    mkdirSync(authDir, { recursive: true });

    // Convert Evolution auth format to Baileys format
    const baileysState = convertAuthState(instance.auth_state);

    // Write auth files
    writeFileSync(
      join(authDir, 'creds.json'),
      JSON.stringify(baileysState.creds, null, 2)
    );

    for (const [key, value] of Object.entries(baileysState.keys)) {
      writeFileSync(
        join(authDir, `${key}.json`),
        JSON.stringify(value, null, 2)
      );
    }

    console.log(`Migrated auth for ${instance.name}`);
  }
}

function convertAuthState(evolutionAuth: any): BaileysAuthState {
  // Evolution and Baileys use similar formats (both based on Baileys)
  // but may have version differences
  return {
    creds: evolutionAuth.creds,
    keys: evolutionAuth.keys,
  };
}
```

## Phase 3: Feature Parity (Weeks 9-12)

### Goals
- Media processing pipeline
- Access control system
- All v1 features available in v2
- UI connected to v2 API

### Tasks

#### Week 9: Media Processing
- [ ] Implement audio processor (Groq/OpenAI)
- [ ] Implement image processor (Gemini/OpenAI)
- [ ] Implement video processor (Gemini)
- [ ] Implement document processor
- [ ] Batch reprocessing endpoint

#### Week 10: Access Control
- [ ] Implement AccessControlService
- [ ] Migrate existing rules from v1
- [ ] Rule engine with patterns
- [ ] API endpoints for rules

#### Week 11: Agent Router
- [ ] Implement MessageRouter
- [ ] Agent API client with streaming
- [ ] Message splitting logic
- [ ] Conversation history

#### Week 12: UI Integration
- [ ] Connect React UI to v2 API
- [ ] Update API client in UI
- [ ] Test all UI features
- [ ] Fix any issues

## Phase 4: Cutover (Weeks 13-16)

### Goals
- All traffic on v2
- v1 deprecated
- Documentation complete
- Monitoring operational

### Tasks

#### Week 13: SDK & CLI
- [ ] Setup SDK auto-generation pipeline (openapi-typescript, openapi-generator)
- [ ] Generate and publish TypeScript SDK to npm
- [ ] Generate Python SDK and publish to PyPI
- [ ] Generate Go SDK
- [ ] Build and publish CLI tool
- [ ] CI/CD: Auto-regenerate SDKs on schema changes

#### Week 14: Gradual Cutover
- [ ] Route 10% of traffic to v2
- [ ] Monitor for issues
- [ ] Increase to 50%
- [ ] Increase to 100%

#### Week 15: Cleanup
- [ ] Remove v1 deployment
- [ ] Archive v1 code
- [ ] Remove Evolution API
- [ ] Clean up migration artifacts

#### Week 16: Documentation
- [ ] Complete API documentation
- [ ] Migration guide for custom integrations
- [ ] Troubleshooting guide
- [ ] Announce v2 GA

## Rollback Plan

If issues occur during cutover:

```bash
# Immediate rollback (< 5 minutes)
kubectl scale deployment omni-v2 --replicas=0
kubectl scale deployment omni-v1 --replicas=3

# Or with feature flag
curl -X POST https://api/internal/feature-flags \
  -d '{"flag": "use_v2", "value": false}'
```

## Data Sync During Migration

During the parallel period, keep databases in sync:

```typescript
// packages/core/src/migration/sync.ts

export class DataSyncService {
  constructor(
    private v1Db: V1Database,
    private v2Db: V2Database,
    private eventBus: EventBus
  ) {}

  async start() {
    // Sync v1 → v2 for legacy writes
    this.pollV1Changes();

    // Sync v2 → v1 for new writes (backward compat)
    this.eventBus.subscribe('message.*', async (event) => {
      await this.syncToV1(event);
    });
  }

  private async pollV1Changes() {
    let lastSync = await this.getLastSyncTimestamp();

    setInterval(async () => {
      const changes = await this.v1Db.query(`
        SELECT * FROM message_traces
        WHERE updated_at > $1
        ORDER BY updated_at
        LIMIT 1000
      `, [lastSync]);

      for (const trace of changes) {
        await this.syncTraceToV2(trace);
        lastSync = trace.updated_at;
      }

      await this.saveLastSyncTimestamp(lastSync);
    }, 5000); // Every 5 seconds
  }
}
```

## Success Criteria

### Phase 1 Complete
- [ ] v2 API responds to health checks
- [ ] Event bus processing messages
- [ ] All v1 data migrated to v2 schema
- [ ] v1 API endpoints work via v2 (proxy)

### Phase 2 Complete
- [ ] WhatsApp messages send/receive via Baileys
- [ ] Discord messages send/receive
- [ ] New instances can be created on v2
- [ ] < 100ms latency difference from v1

### Phase 3 Complete
- [ ] All media types processed correctly
- [ ] Access rules enforced
- [ ] UI fully functional on v2
- [ ] Feature parity with v1

### Phase 4 Complete
- [ ] 0 instances on v1
- [ ] TypeScript SDK published to npm (@omni/sdk)
- [ ] Python SDK published to PyPI (omni-sdk)
- [ ] CLI published to npm (@omni/cli)
- [ ] OpenAPI spec auto-generated on build
- [ ] Documentation complete
- [ ] No Evolution API dependency

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss during migration | Run in parallel, sync both ways |
| WhatsApp auth issues | Keep Evolution running as fallback |
| Performance regression | Benchmark continuously, rollback threshold |
| API incompatibility | v1 compatibility layer, versioned API |
| Team velocity | Prioritize critical path, defer nice-to-haves |
