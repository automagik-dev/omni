---
title: "API Endpoints Reference"
created: 2025-01-29
updated: 2026-09-10
tags: [api, endpoints, reference]
status: current
---

# API Endpoints Reference

> v2 is the primary API. All routes are mounted under `/api/v2/`.

> Related: [[design|API Design]], [[internal|Internal API]], [[overview|Architecture Overview]]

## Route Modules

All v2 routes are defined in `packages/api/src/routes/v2/` and mounted in `index.ts`:

| Module | Mount Point | Description |
|--------|-------------|-------------|
| `a2a` | `/a2a` | A2A discovery: authenticated multi-agent catalog + Agent Card resolution |
| `agents` | `/agents` | First-class agent entities, event manifests, identity links |
| `agent-state` | `/agent-state` | Ephemeral agent state machine (SSE streams + one-shot get/set) |
| `agent-tasks` | `/agent-tasks` | Persistent agent task history |
| `auth` | `/auth` | API key validation |
| `instances` | `/instances` | Instance CRUD, connection, sync, profile, groups |
| `logs` | `/logs` | System log streaming |
| `messages` | `/messages` | Message CRUD, send operations, TTS, presence |
| `scheduled-messages` | `/scheduled-messages` | Deferred sends (platform-native or local sweeper) |
| `slack` | `/slack` | Slack-only: DM open + full-text message search |
| `event-schemas` | `/` (routes at `/events/schemas`) | Event schema registry (draft-07 JSON Schema, validated at publish gates) |
| `event-consumers` | `/` (routes at `/events/consumers`) | Durable pull consumers with Postgres journal cursors |
| `events` | `/events` | Event queries, analytics, timeline, causality traces |
| `journeys` | `/journeys` | Message journey tracing (per-correlation traces + aggregate metrics) |
| `persons` | `/persons` | Identity search, presence, linking |
| `access` | `/access` | Access control rules |
| `settings` | `/settings` | Server settings management |
| `providers` | `/providers` | AI agent provider management |
| `dead-letters` | `/dead-letters` | Failed event management |
| `event-ops` | `/event-ops` | Event replay, metrics |
| `processed-events` | `/processed-events` | Placeholder reserving the path (clean 404 until #411 lands) |
| `metrics` | `/metrics` | System metrics |
| `conversations` | `/conversations` | Cross-channel conversation continuity |
| `chats` | `/chats` | Chat CRUD, participants, archive/pin/mute |
| `channel-harness` | `/channels/harness` | E2E agent-test harness driving/inspection (auth-required, unlike channel webhooks) |
| `media` | `/media` | Media file serving |
| `batch-jobs` | `/batch-jobs` | Batch operations |
| `keys` | `/keys` | API key management |
| `context` | `/context` | Per-API-key conversation context (active instance/chat/message) |
| `turns` | `/turns` | Turn lifecycle for turn-based agents (close, admin list/stats) |
| `trust` | `/trust` | Host fingerprint trust registration (idempotent handshake) |
| `voice` | `/voice` | Voice session management (join/leave/sessions, any VoiceCapable channel) |
| `follow-up` | `/follow-up` | Idle-chat follow-up config at agent/instance/chat scopes |
| `handoffs` | `/handoffs` | Handoff audit log |
| `whatsapp-business` | `/instances` (routes at `/instances/:id/whatsapp-business/*`) | WhatsApp Cloud (Meta) connection lifecycle, profile, analytics |
| `templates` | `/` (routes at `/instances/:id/whatsapp-templates/*`) | WhatsApp Cloud HSM template management |
| `whatsapp-flows` | `/` (routes at `/instances/:id/whatsapp-flows/*`) | WhatsApp Flows management + send |
| `payloads` | `/` | Event payload storage and config |
| `webhooks` | `/` | Webhook sources, ingress, heartbeats, event triggers |
| `automations` | `/automations` + `/` | Event-driven automation workflows (root mount for `/automation-logs`, `/automation-metrics`) |
| `agent-routes` | `/` (routes at `/instances/:instanceId/routes`, `/routes/metrics`) | Agent routing configuration |
| `platform-tenants` | `/platform` (mounted in `app.ts`, only when `OMNI_MULTITENANCY_ENABLED=true`) | Tenant lifecycle control plane (platform-class credentials only) |

---

## Authentication

### Auth

```yaml
POST /api/v2/auth/validate
  # Validates the current API key
  Response: { valid: true, key: { id, name, scopes, instanceIds } }
```

---

## Instances

Source: `packages/api/src/routes/v2/instances.ts`

### CRUD

```yaml
GET    /api/v2/instances                      # List instances
  Query: channel, status, limit (1-100), cursor

GET    /api/v2/instances/supported-channels    # List available channel types

GET    /api/v2/instances/:id                   # Get instance by ID

POST   /api/v2/instances                      # Create instance
  Body: name, channel, agentProviderId?, agentId?, agentType?,
        agentTimeout?, agentStreamMode?, agentReplyFilter?,
        agentSessionStrategy?, agentPrefixSenderName?,
        enableAutoSplit?, isDefault?, token?, ttsVoiceId?, ttsModelId?

  Note: `agentReplyFilter` defaults to `null`, which means **reply to all**
  inbound messages (see #371). Set `{ mode: 'filtered', conditions: {...} }`
  to restrict agent responses to DMs / mentions / replies / name matches.

PATCH  /api/v2/instances/:id                  # Update instance
  Body: (same as create, all optional)

DELETE /api/v2/instances/:id                  # Delete instance
```

### Connection Management

```yaml
GET    /api/v2/instances/:id/status           # Get connection status
GET    /api/v2/instances/:id/qr               # Get QR code (WhatsApp only)
POST   /api/v2/instances/:id/pair             # Request pairing code (WhatsApp)
  Body: { phoneNumber: string }
POST   /api/v2/instances/:id/connect          # Connect instance
  Body: { token?, forceNewQr? }
POST   /api/v2/instances/:id/disconnect       # Disconnect instance
POST   /api/v2/instances/:id/restart          # Restart instance
  Query: forceNewQr?
POST   /api/v2/instances/:id/logout           # Logout (clear session)
```

### Sync

```yaml
POST   /api/v2/instances/:id/sync             # Start sync job
  Body: { type: profile|messages|contacts|groups|all, depth?, channelId?, downloadMedia? }
POST   /api/v2/instances/:id/sync/profile     # Sync profile immediately
GET    /api/v2/instances/:id/sync             # List sync jobs for instance
  Query: status?, limit?
GET    /api/v2/instances/:id/sync/:jobId      # Get sync job status
```

### Profile Management

```yaml
PUT    /api/v2/instances/:id/profile/name     # Update display name
  Body: { name: string }
PUT    /api/v2/instances/:id/profile/status   # Update bio/status
  Body: { status: string }
PUT    /api/v2/instances/:id/profile/picture  # Update profile picture
  Body: { base64: string, mimeType? }
DELETE /api/v2/instances/:id/profile/picture  # Remove profile picture
```

### Contacts & Groups

```yaml
GET    /api/v2/instances/:id/contacts         # List contacts
  Query: limit?, cursor?, guildId? (required for Discord)
GET    /api/v2/instances/:id/groups           # List groups
  Query: limit?, cursor?
POST   /api/v2/instances/:id/groups           # Create group (WhatsApp)
  Body: { subject, participants[] }
GET    /api/v2/instances/:id/users/:userId/profile  # Fetch user profile
```

### Group Operations

```yaml
GET    /api/v2/instances/:id/groups/:groupJid/invite         # Get invite code
POST   /api/v2/instances/:id/groups/:groupJid/invite/revoke  # Revoke invite
POST   /api/v2/instances/:id/groups/join                     # Join group
  Body: { code: string }
PUT    /api/v2/instances/:id/groups/:groupJid/picture        # Update group picture
  Body: { base64, mimeType? }
```

### WhatsApp-Specific

```yaml
POST   /api/v2/instances/:id/check-number    # Check if phones are on WhatsApp
  Body: { phones: string[] }
POST   /api/v2/instances/:id/block           # Block a contact
  Body: { contactId }
DELETE /api/v2/instances/:id/block           # Unblock a contact
  Body: { contactId }
GET    /api/v2/instances/:id/blocklist       # Get blocked contacts
GET    /api/v2/instances/:id/privacy         # Get privacy settings
POST   /api/v2/instances/:id/calls/reject    # Reject incoming call
  Body: { callId, callFrom }
```

---

## Messages

Source: `packages/api/src/routes/v2/messages.ts`

### Message CRUD

```yaml
GET    /api/v2/messages                       # List messages
  Query: chatId?, source?, messageType?, status?, hasMedia?,
         senderPersonId?, externalId?, since?, until?, search?, limit (1-100), cursor?

GET    /api/v2/messages/by-external           # Find by external ID
  Query: chatId, externalId

GET    /api/v2/messages/:id                   # Get message by ID

POST   /api/v2/messages                       # Create message record
  Body: chatId, externalId, source, messageType, textContent?,
        platformTimestamp, sender fields, media fields, reply fields, rawPayload?

PATCH  /api/v2/messages/:id                   # Update message
  Body: textContent?, transcription?, imageDescription?,
        videoDescription?, documentExtraction?, mediaUrl?, mediaLocalPath?, mediaMetadata?

DELETE /api/v2/messages/:id                   # Mark as deleted
  Query: latestEventId?
```

### Message Operations

```yaml
POST   /api/v2/messages/:id/edit              # Record edit
  Body: { newText, editedAt, editedBy?, latestEventId? }

POST   /api/v2/messages/:id/reactions         # Add reaction
  Body: { emoji, platformUserId, personId?, displayName?, isCustomEmoji?, customEmojiId? }

DELETE /api/v2/messages/:id/reactions         # Remove reaction
  Body: { platformUserId, emoji }

PATCH  /api/v2/messages/:id/delivery-status   # Update delivery status
  Body: { status: pending|sent|delivered|read|failed }

PATCH  /api/v2/messages/:id/transcription     # Update transcription
PATCH  /api/v2/messages/:id/image-description # Update image description
PATCH  /api/v2/messages/:id/video-description # Update video description
PATCH  /api/v2/messages/:id/document-extraction # Update document extraction
```

### Send Operations

```yaml
POST   /api/v2/messages/send                  # Send text message
  Body: { instanceId, to, text, replyTo?, threadId?, mentions?[] }
  Note: `threadId` targets a thread/topic (e.g. Telegram forum topic, Slack thread_ts)

POST   /api/v2/messages/send/media            # Send media
  Body: { instanceId, to, type: image|audio|video|document,
          url?, base64?, filename?, caption?, voiceNote?, threadId? }

POST   /api/v2/messages/send/reaction         # Send reaction
  Body: { instanceId, to, messageId, emoji }

POST   /api/v2/messages/send/sticker          # Send sticker
  Body: { instanceId, to, url?, base64? }

POST   /api/v2/messages/send/contact          # Send contact card
  Body: { instanceId, to, contact: { name, phone?, email?, organization? } }

POST   /api/v2/messages/send/location         # Send location
  Body: { instanceId, to, latitude, longitude, name?, address? }

POST   /api/v2/messages/send/tts              # Send TTS voice note (ElevenLabs)
  Body: { instanceId, to, text, voiceId?, modelId?, stability?,
          similarityBoost?, presenceDelay? }
  Note: Also available GET /api/v2/messages/tts/voices for voice listing

POST   /api/v2/messages/send/forward          # Forward a message (WhatsApp)
  Body: { instanceId, to, messageId, fromChatId }

POST   /api/v2/messages/send/presence         # Send typing/recording indicator
  Body: { instanceId, to, type: typing|recording|paused, duration?, threadId? }

POST   /api/v2/messages/send/poll             # Send poll (Discord)
  Body: { instanceId, to, question, answers[], durationHours?, multiSelect?, replyTo? }

POST   /api/v2/messages/send/embed            # Send embed (Discord)
  Body: { instanceId, to, title?, description?, color?, url?, timestamp?,
          footer?, author?, thumbnail?, image?, fields[], replyTo? }
```

### Edit/Delete via Channel

```yaml
POST   /api/v2/messages/edit-channel          # Edit message on platform
  Body: { instanceId, channelId, messageId, text }

POST   /api/v2/messages/delete-channel        # Delete message on platform
  Body: { instanceId, channelId, messageId, fromMe? }
```

### Read Receipts

```yaml
POST   /api/v2/messages/:id/read             # Mark single message as read
  Body: { instanceId }

POST   /api/v2/messages/read                 # Batch mark as read
  Body: { instanceId, chatId, messageIds[] }
```

### Star/Unstar (WhatsApp)

```yaml
POST   /api/v2/messages/:id/star             # Star a message
  Body: { instanceId, channelId, fromMe? }

DELETE /api/v2/messages/:id/star             # Unstar a message
  Body: { instanceId, channelId, fromMe? }
```

### Permalink

```yaml
GET    /api/v2/messages/:id/permalink        # Resolve a stable deep link to the message
  Query: instanceId, channelId
  Response: { messageId, permalink, cached }
  Note: Resolved lazily via the channel plugin and cached on the message row.
        400 if the channel cannot resolve permalinks.
```

> Message-level **pin** state is populated from inbound platform events only —
> there is no invokable pin endpoint (chat-level pin lives under `/chats/:id/pin`).

---

## Scheduled Messages

Source: `packages/api/src/routes/v2/scheduled-messages.ts`

Deferred sends. The server picks the delivery mode from the channel's
`canScheduleMessage` capability: platform-native scheduling where the channel
supports it (Slack, text-only), otherwise Omni's local sweeper (15s cron).
Callers do not choose the mode.

```yaml
POST   /api/v2/scheduled-messages             # Schedule a message for later
  Body: { instanceId, chatId, content, sendAt, threadId?, isThreadBroadcast? }
  Note: `content` is OutgoingContent (e.g. { type: 'text', text: '...' });
        `sendAt` is an ISO-8601 datetime

GET    /api/v2/scheduled-messages             # List pending scheduled messages
  Query: instanceId, limit (1-500, default 100)
  Note: Only messages scheduled through Omni are listed

GET    /api/v2/scheduled-messages/:id         # Get scheduled message

DELETE /api/v2/scheduled-messages/:id         # Cancel a pending scheduled message
```

---

## Chats

Source: `packages/api/src/routes/v2/chats.ts`

### Chat CRUD

```yaml
GET    /api/v2/chats                          # List chats
  Query: instanceId?, channel?, chatType?, search?, includeArchived?, limit?, cursor?

GET    /api/v2/chats/by-external              # Find by external ID
  Query: instanceId, externalId

GET    /api/v2/chats/:id                      # Get chat by ID

POST   /api/v2/chats                          # Create chat record
  Body: { instanceId, externalId, chatType, channel, name?, description?,
          avatarUrl?, canonicalId?, parentChatId?, settings?, platformMetadata? }

PATCH  /api/v2/chats/:id                      # Update chat
DELETE /api/v2/chats/:id                      # Delete chat (soft)
```

### Chat Actions

```yaml
POST   /api/v2/chats/:id/archive             # Archive chat
  Body: { instanceId? }   # If provided, also archives on platform

POST   /api/v2/chats/:id/unarchive           # Unarchive chat
  Body: { instanceId? }

POST   /api/v2/chats/:id/pin                 # Pin chat
  Body: { instanceId }

POST   /api/v2/chats/:id/unpin              # Unpin chat
  Body: { instanceId }

POST   /api/v2/chats/:id/mute               # Mute chat
  Body: { instanceId, duration? }

POST   /api/v2/chats/:id/unmute             # Unmute chat
  Body: { instanceId }

POST   /api/v2/chats/:id/read               # Mark entire chat as read
  Body: { instanceId }

POST   /api/v2/chats/:id/disappearing       # Set disappearing messages
  Body: { instanceId, duration: off|24h|7d|90d }
```

### Participants

```yaml
GET    /api/v2/chats/:id/participants        # List participants
POST   /api/v2/chats/:id/participants        # Add participant
  Body: { platformUserId, displayName?, avatarUrl?, role?, personId?, platformIdentityId? }
DELETE /api/v2/chats/:id/participants/:platformUserId  # Remove participant
PATCH  /api/v2/chats/:id/participants/:platformUserId/role  # Update role
  Body: { role }
```

### Chat Messages

```yaml
GET    /api/v2/chats/:id/messages            # Get messages for chat
  Query: limit?, before?, after?
```

---

## Events

Source: `packages/api/src/routes/v2/events.ts`

```yaml
GET    /api/v2/events                         # List events
  Query: channel[], instanceId?, personId?, chatId?, eventType[], excludeEventType[],
         contentType[], direction?, since?, until?, search?, limit?, cursor?
  Note: eventType/excludeEventType are comma-separated; trailing-* prefix globs.
        Exclusion wins over inclusion (`custom.*` minus `custom.chat.*`).

GET    /api/v2/events/analytics               # Get analytics summary
  Query: since?, until?, instanceId?, granularity? (hourly|daily), allTime?
  Response: { ..., totalCostUsd, messageTypes, errorStages, instances, byChannel, byDirection, timeline? }
  Note: totalCostUsd = sum of `metadata.agentUsage.costUsd` over events in range
        (stamped on the event that woke an agent — see event-system.md).

GET    /api/v2/events/types                   # Inventory of observed event types
  Query: since?
  Response: { items[{ eventType, count, lastSeen, schemaVersion, schemaEnabled,
                      consumers[], automations[] }], meta: { since } }
  Note: schemaVersion/schemaEnabled are null for unregistered types; consumers =
        durable consumer names, automations = enabled automations triggered by the type.

GET    /api/v2/events/timeline/:personId      # Person timeline
  Query: channels[]?, since?, until?, limit?, cursor?

POST   /api/v2/events/search                  # Search events
  Body: { query?, filters?, format?, limit? }

GET    /api/v2/events/:id                     # Get event by ID

GET    /api/v2/events/:id/trace               # Walk the causality chain around an event
  Response: { event, ancestors[], descendants[{ event, depth }], truncated }
  Note: Walks causation_id ancestors up to the root ingress event, then
        breadth-first through descendants (children = events whose
        causation_id is this id). Instance access is gated on the focus event.

GET    /api/v2/events/by-sender/:senderId     # Events by sender
  Query: limit?, instanceId?
```

---

## Event Schemas

Source: `packages/api/src/routes/v2/event-schemas.ts`

Registry of draft-07 JSON Schemas per event type. Global (not tenant-scoped).
Validation is enforced at the publish gates — webhook ingress and the
automation `emit_event` action. Unregistered types pass through unless the
webhook source sets `strictSchemas` (failures dead-letter as
`schema_not_registered`) or `OMNI_STRICT_EMIT_EVENT_SCHEMAS=true` is set for
`emit_event`.

> Runbook examples: [[../runbooks/github-webhook-source|GitHub webhook source]],
> [[../runbooks/clickup-webhook-source|ClickUp webhook source]]

```yaml
GET    /api/v2/events/schemas                 # List registered schemas
  Query: enabled?

GET    /api/v2/events/schemas/:eventType      # Get schema for an event type

POST   /api/v2/events/schemas                 # Register or revise a schema
  Body: { eventType, schema, description?, enabled? }
  Note: Revising an existing type bumps `version`. Revisions must be
        additive-optional; an incompatible replacement is refused with 409.
```

---

## Durable Event Consumers

Source: `packages/api/src/routes/v2/event-consumers.ts`

Named pull consumers over the Postgres event journal — cursors over
`omni_events.journal_seq`, delivered at-least-once. These are **not** NATS
JetStream consumers. `lag` = journal head − cursor.

> Runbook: [[../runbooks/durable-consumers|Durable consumers]]

```yaml
GET    /api/v2/events/consumers               # List consumers (filter, cursor, live lag)

POST   /api/v2/events/consumers               # Register a consumer
  Body: { name, eventType, excludeTypes[]? (max 20), filters[]?, from? }
  Note: Initial cursor 'now' = journal head (default), 'beginning' = full replay.
        excludeTypes use the same glob syntax as eventType and win over it;
        the stored value is echoed back as `excludeTypes` (null = none).

GET    /api/v2/events/consumers/:name         # Get consumer + cursor position + lag

DELETE /api/v2/events/consumers/:name         # Delete registration + cursor (journal untouched)

POST   /api/v2/events/consumers/:name/pull    # Pull events after the stored cursor
  Query: limit (1-500, default 100), waitMs (0-30000; long-poll wait for new events)
  Note: Returns events in journal_seq order plus the highest SCANNED
        journal_seq as `cursor` (not the last matching event's seq)

POST   /api/v2/events/consumers/:name/ack     # Advance the cursor (monotonic)
  Body: { cursor }
  Note: Equal cursor = no-op; lower than stored = 400
```

---

## Event Operations

Source: `packages/api/src/routes/v2/event-ops.ts`

```yaml
GET    /api/v2/event-ops/metrics              # Event processing metrics
POST   /api/v2/event-ops/replay               # Start replay job
GET    /api/v2/event-ops/replay               # List replay jobs
GET    /api/v2/event-ops/replay/:id           # Get replay status
DELETE /api/v2/event-ops/replay/:id           # Cancel replay
POST   /api/v2/event-ops/scheduled            # Trigger scheduled processing
```

---

## Event Payloads

Source: `packages/api/src/routes/v2/payloads.ts`

```yaml
GET    /api/v2/events/:eventId/payloads       # Get all payloads for event
GET    /api/v2/events/:eventId/payloads/:stage # Get payload by stage
DELETE /api/v2/events/:eventId/payloads       # Delete payloads
  Body: { stages?: string[] }

GET    /api/v2/payload-config                 # Get payload capture config
PUT    /api/v2/payload-config/:eventType      # Update capture config
GET    /api/v2/payload-stats                  # Get payload storage stats
```

---

## Persons

Source: `packages/api/src/routes/v2/persons.ts`

```yaml
GET    /api/v2/persons                        # Search persons
  Query: search?, limit?

GET    /api/v2/persons/:id                    # Get person

GET    /api/v2/persons/:id/presence           # Get cross-channel presence

GET    /api/v2/persons/:id/timeline           # Get person timeline
  Query: channels[]?, since?, until?, limit?

POST   /api/v2/persons/link                   # Link identities
  Body: { identityA, identityB }

POST   /api/v2/persons/unlink                # Unlink identity
  Body: { identityId, reason }

POST   /api/v2/persons/merge                 # Merge two persons
  Body: { sourcePersonId, targetPersonId, reason? }
```

---

## Access Rules

Source: `packages/api/src/routes/v2/access.ts`

```yaml
GET    /api/v2/access/rules                   # List rules
  Query: instanceId?, type?

GET    /api/v2/access/rules/:id               # Get rule

POST   /api/v2/access/rules                   # Create rule
  Body: { instanceId?, type, criteria, priority, action }

PATCH  /api/v2/access/rules/:id               # Update rule

DELETE /api/v2/access/rules/:id               # Delete rule

POST   /api/v2/access/check                   # Check access
  Body: { instanceId, platformUserId, channel }
```

---

## API Keys

Source: `packages/api/src/routes/v2/keys.ts`

Requires `keys:read` or `keys:write` scope.

```yaml
GET    /api/v2/keys                           # List API keys
  Query: limit?, cursor?

GET    /api/v2/keys/:id                       # Get key details

POST   /api/v2/keys                           # Create API key
  Body: { name, scopes?, instanceIds?, expiresAt? }
  Response: includes `key` field (shown only once!)

PATCH  /api/v2/keys/:id                       # Update key
  Body: { name?, scopes?, instanceIds?, expiresAt? }

POST   /api/v2/keys/:id/revoke               # Revoke key
  Body: { reason? }

DELETE /api/v2/keys/:id                       # Delete key

GET    /api/v2/keys/:id/audit                 # Get key audit log
  Query: since?, until?, limit?
```

---

## Settings

Source: `packages/api/src/routes/v2/settings.ts`

```yaml
GET    /api/v2/settings                       # List settings
  Query: category?

GET    /api/v2/settings/:key                  # Get setting

PUT    /api/v2/settings/:key                  # Set setting
  Body: { value, reason? }

PATCH  /api/v2/settings                       # Bulk update
  Body: { settings: Record<string, any>, reason? }

DELETE /api/v2/settings/:key                  # Delete setting

GET    /api/v2/settings/:key/history          # Get change history
  Query: limit?, since?
```

---

## Providers

Source: `packages/api/src/routes/v2/providers.ts`

```yaml
GET    /api/v2/providers                      # List providers
  Query: limit?, cursor?

GET    /api/v2/providers/:id                  # Get provider

POST   /api/v2/providers                      # Create provider

PATCH  /api/v2/providers/:id                  # Update provider

DELETE /api/v2/providers/:id                  # Delete provider

POST   /api/v2/providers/:id/health           # Health check

GET    /api/v2/providers/:id/agents           # List agents
GET    /api/v2/providers/:id/teams            # List teams
GET    /api/v2/providers/:id/workflows        # List workflows
```

---

## Agent Manifests

Source: `packages/api/src/routes/v2/agents.ts`

An agent's event manifest declares what it consumes and publishes:
`{ accepts: [{ event, filter? }], publishes: [{ event }] }` — exact event
types only, no globs. `publishes` is enforced at emit time (violations are
dead-lettered as `publish_not_declared`); `accepts` compiles into managed
automations.

> Runbook: [[../runbooks/agent-publish-governance|Agent publish governance]]

```yaml
GET    /api/v2/agents/:id/manifest            # Get the agent's event manifest

PUT    /api/v2/agents/:id/manifest            # Replace the manifest (full replacement)
  Body: { accepts: [{ event, filter? }], publishes: [{ event }] }
  Note: Publishes system.agent.manifest.updated
```

---

## Automations

Source: `packages/api/src/routes/v2/automations.ts`

```yaml
GET    /api/v2/automations                    # List automations
  Query: instanceId?, enabled?, limit?, cursor?

GET    /api/v2/automations/:id                # Get automation

POST   /api/v2/automations                    # Create automation
  Note: Body accepts `transactionalEmissions` (default false) — buffer the
        run's emit_event publishes and flush them in order only when every
        action succeeded; a failed run publishes zero events.

PATCH  /api/v2/automations/:id                # Update automation
  Body: (same as create, all optional — including transactionalEmissions)

DELETE /api/v2/automations/:id                # Delete automation

POST   /api/v2/automations/:id/enable         # Enable automation
POST   /api/v2/automations/:id/disable        # Disable automation
POST   /api/v2/automations/:id/test           # Dry run: verdicts, no side effects
  Body: { event?: { type, payload }, eventId? }   (exactly one)
  Response: { matched, triggerMatched, conditionsMatched, conditionLogic,
              conditions[{ field, operator, expected, actual, resolved, matched }],
              actions[{ type, wouldExecute, config }] }
  Note: eventId loads a REAL omni_events row — rawPayload as payload, envelope
        metadata merged for conditions. Nothing executes, no execution log.
        `resolved: false` = the condition's dot path found nothing.

POST   /api/v2/automations/:id/execute        # Execute (actually runs the actions)
  Body: { event?: { type, payload }, eventId? }   (exactly one)

GET    /api/v2/automation-logs                 # Get automation execution logs
  Query: automationId?, limit?

GET    /api/v2/automation-metrics              # Get automation metrics
```

---

## Webhooks

Source: `packages/api/src/routes/v2/webhooks.ts`

> Runbook examples: [[../runbooks/github-webhook-source|GitHub webhook source]],
> [[../runbooks/clickup-webhook-source|ClickUp webhook source]]

### Webhook Sources (Inbound)

```yaml
GET    /api/v2/webhook-sources                # List webhook sources
  Query: limit?, cursor?

GET    /api/v2/webhook-sources/:id            # Get source details

POST   /api/v2/webhook-sources                # Create webhook source
  Body: name, description?, enabled?,
        signatureConfig?      # { algorithm: hmac-sha256|hmac-sha1|token-match, header, prefix? }
        signatureSecret?      # Write-only — never echoed back (responses expose hasSignatureSecret)
        idempotencyKeyTemplate?  # Default "{source}:{sha256(body)}"
        eventTypeMapping?     # { source: "header", header } or { source: "body", path }
        strictSchemas?        # Require a registered schema; else dead-letter schema_not_registered
        expectedIntervalSeconds?  # Declared connector cadence for liveness detection

  Note: `idempotencyKeyTemplate` placeholders — {source}, {sha256(body)},
        {headers.<name>}, {payload.<dot.path>} (dot paths support numeric
        array indices). Dedup runs via a unique idempotency key on
        omni_events; a duplicate delivery returns 200 { duplicate: true }.
  Note: `eventTypeMapping` derives the published type as custom.<source>.<event>.
  Note: `signatureConfig` and `signatureSecret` are paired — a config without
        a stored secret is rejected (400).

PATCH  /api/v2/webhook-sources/:id            # Update source (same fields as create)

DELETE /api/v2/webhook-sources/:id            # Delete source
```

### Inbound Webhooks

```yaml
POST   /api/v2/webhooks/ingress/:source       # Public ingress (auth-exempt)
  Note: Verified EXCLUSIVELY by the source's signature config — signature
        verification is required. Unknown source, disabled source, and bad
        signature all collapse to 401 (no oracle for probing source names).

POST   /api/v2/webhooks/:source               # Receive webhook event (authenticated)
  Note: Same body contract as the public ingress: empty body → {}; a
        non-empty body that is not a JSON object is a 400. Unknown source is
        a 404 unless OMNI_WEBHOOK_AUTOCREATE=true.

POST   /api/v2/webhooks/:source/heartbeat     # Connector liveness heartbeat (authenticated, no body)
  Note: Resets the liveness window for sources declaring
        expectedIntervalSeconds. A missed window emits
        system.connector.stalled; recovery emits system.connector.recovered.
        Heartbeats themselves are not journaled — only the transitions are.
```

### Event Triggering

```yaml
POST   /api/v2/events/trigger                 # Trigger a custom event
  Body: { eventType (custom.*), payload, correlationId?, causationId?, instanceId? }
  Note: causationId (uuid of an existing event) parents the emission in the
        causality tree (GET /events/:id/trace) instead of creating a new root.
```

---

## Dead Letters

Source: `packages/api/src/routes/v2/dead-letters.ts`

```yaml
GET    /api/v2/dead-letters                   # List dead letters
  Query: eventType?, status?, limit?

GET    /api/v2/dead-letters/stats             # Get statistics

GET    /api/v2/dead-letters/:id               # Get dead letter details

POST   /api/v2/dead-letters/:id/retry         # Retry processing

POST   /api/v2/dead-letters/:id/resolve       # Mark as resolved
  Body: { resolution? }

POST   /api/v2/dead-letters/:id/abandon       # Abandon (stop retrying)
```

---

## Batch Jobs

Source: `packages/api/src/routes/v2/batch-jobs.ts`

```yaml
GET    /api/v2/batch-jobs                     # List batch jobs
  Query: status?, type?, limit?

GET    /api/v2/batch-jobs/:id                 # Get batch job

GET    /api/v2/batch-jobs/:id/status          # Get job status

POST   /api/v2/batch-jobs                     # Create batch job

POST   /api/v2/batch-jobs/estimate            # Estimate job scope

POST   /api/v2/batch-jobs/:id/cancel          # Cancel job
```

---

## Logs

Source: `packages/api/src/routes/v2/logs.ts`

```yaml
GET    /api/v2/logs/stream                    # SSE log stream
  Query: level?, modules?

GET    /api/v2/logs/recent                    # Get recent logs
  Query: level?, modules?, limit?
```

---

## Media

Source: `packages/api/src/routes/v2/media.ts`

```yaml
GET    /api/v2/media/:instanceId/*            # Serve media file
```

---

## Metrics

Source: `packages/api/src/routes/v2/metrics.ts`

```yaml
GET    /api/v2/metrics                        # System metrics (Prometheus format)
```

---

## Platform Tenants

Source: `packages/api/src/routes/v2/platform-tenants.ts`

Mounted at `/api/v2/platform` **only when `OMNI_MULTITENANCY_ENABLED=true`**
(otherwise the whole surface 404s). Every route requires a PLATFORM-class
credential with explicit `platform:*` scopes — tenant credentials and normal
data-plane keys are denied. Mutations take a `reason` in the body; audited
reads take an `x-platform-reason` header. Every state change writes an
append-only platform audit row.

There are intentionally **no DELETE routes** — hard tenant delete is
unavailable; `archive` is the terminal state.

```yaml
POST   /api/v2/platform/tenants                    # Create tenant
GET    /api/v2/platform/tenants                    # List tenants
  Header: x-platform-reason
GET    /api/v2/platform/tenants/:id                # Get tenant
  Header: x-platform-reason

POST   /api/v2/platform/tenants/:id/suspend        # Suspend tenant
  Body: { reason }
POST   /api/v2/platform/tenants/:id/archive        # Archive tenant (terminal)
  Body: { reason }

GET    /api/v2/platform/tenants/:id/memberships    # List memberships
  Header: x-platform-reason
POST   /api/v2/platform/tenants/:id/memberships    # Attach membership
  Body: { principalId, role, reason }

POST   /api/v2/platform/tenants/:tenantId/memberships/:id/disable  # Disable membership
  Body: { reason }
POST   /api/v2/platform/tenants/:tenantId/memberships/:id/status   # Set membership status
  Body: { status: active|disabled, reason }
POST   /api/v2/platform/tenants/:tenantId/memberships/:id/role     # Change membership role
  Body: { role, reason }

POST   /api/v2/platform/tenants/:id/keys/root      # Issue tenant root API key
  Note: The plaintext key is returned exactly once in the 201 body
```
