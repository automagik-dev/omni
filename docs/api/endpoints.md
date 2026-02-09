---
title: "API Endpoints Reference"
created: 2025-01-29
updated: 2026-02-09
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
| `auth` | `/auth` | API key validation |
| `instances` | `/instances` | Instance CRUD, connection, sync, profile, groups |
| `logs` | `/logs` | System log streaming |
| `messages` | `/messages` | Message CRUD, send operations, TTS, presence |
| `events` | `/events` | Event queries, analytics, timeline |
| `persons` | `/persons` | Identity search, presence, linking |
| `access` | `/access` | Access control rules |
| `settings` | `/settings` | Server settings management |
| `providers` | `/providers` | AI agent provider management |
| `dead-letters` | `/dead-letters` | Failed event management |
| `event-ops` | `/event-ops` | Event replay, metrics |
| `metrics` | `/metrics` | System metrics |
| `chats` | `/chats` | Chat CRUD, participants, archive/pin/mute |
| `media` | `/media` | Media file serving |
| `batch-jobs` | `/batch-jobs` | Batch operations |
| `keys` | `/keys` | API key management |
| `payloads` | `/` | Event payload storage and config |
| `webhooks` | `/` | Webhook sources and event triggers |
| `automations` | `/automations` | Event-driven automation workflows |

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
         senderPersonId?, since?, until?, search?, limit (1-100), cursor?

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
  Body: { instanceId, to, text, replyTo?, mentions?[] }

POST   /api/v2/messages/send/media            # Send media
  Body: { instanceId, to, type: image|audio|video|document,
          url?, base64?, filename?, caption?, voiceNote? }

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
  Body: { instanceId, to, type: typing|recording|paused, duration? }

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
  Query: channel[], instanceId?, personId?, eventType[], contentType[],
         direction?, since?, until?, search?, limit?, cursor?

GET    /api/v2/events/analytics               # Get analytics summary
  Query: since?, until?, instanceId?, allTime?

GET    /api/v2/events/timeline/:personId      # Person timeline
  Query: channels[]?, since?, until?, limit?, cursor?

POST   /api/v2/events/search                  # Search events
  Body: { query?, filters?, format?, limit? }

GET    /api/v2/events/:id                     # Get event by ID

GET    /api/v2/events/by-sender/:senderId     # Events by sender
  Query: limit?, instanceId?
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

## Automations

Source: `packages/api/src/routes/v2/automations.ts`

```yaml
GET    /api/v2/automations                    # List automations
  Query: instanceId?, enabled?, limit?, cursor?

GET    /api/v2/automations/:id                # Get automation

POST   /api/v2/automations                    # Create automation

PATCH  /api/v2/automations/:id                # Update automation

DELETE /api/v2/automations/:id                # Delete automation

POST   /api/v2/automations/:id/enable         # Enable automation
POST   /api/v2/automations/:id/disable        # Disable automation
POST   /api/v2/automations/:id/test           # Test with mock event
POST   /api/v2/automations/:id/execute        # Execute with real event

GET    /api/v2/automation-logs                 # Get automation execution logs
  Query: automationId?, limit?

GET    /api/v2/automation-metrics              # Get automation metrics
```

---

## Webhooks

Source: `packages/api/src/routes/v2/webhooks.ts`

### Webhook Sources (Inbound)

```yaml
GET    /api/v2/webhook-sources                # List webhook sources
  Query: limit?, cursor?

GET    /api/v2/webhook-sources/:id            # Get source details

POST   /api/v2/webhook-sources                # Create webhook source

PATCH  /api/v2/webhook-sources/:id            # Update source

DELETE /api/v2/webhook-sources/:id            # Delete source
```

### Inbound Webhooks

```yaml
POST   /api/v2/webhooks/:source               # Receive webhook event
```

### Event Triggering

```yaml
POST   /api/v2/events/trigger                 # Trigger a custom event
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
