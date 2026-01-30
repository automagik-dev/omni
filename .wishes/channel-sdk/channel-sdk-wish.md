# WISH: Channel SDK

> Plugin SDK for building channel integrations with full lifecycle management, multi-instance support, and event publishing helpers.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-5v7

---

## Context

The Channel SDK defines how channels plug into Omni. Every channel (WhatsApp, Discord, Slack, etc.) implements this interface. The SDK handles lifecycle, health checks, and event publishing with proper hierarchical subjects.

**Multi-Instance Architecture:** Each channel type can have multiple instances (e.g., 3 WhatsApp accounts, 2 Discord bots). The SDK must make it easy to publish events with the correct `{channelType}.{instanceId}` hierarchy.

Reference: `docs/architecture/plugin-system.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | EventBus interface available from `@omni/core` |
| **DEC-1** | Decision | Full lifecycle: initialize → connect → ready → disconnect → destroy |
| **DEC-2** | Decision | Auto-discovery of `packages/channel-*` |
| **DEC-3** | Decision | BaseChannelPlugin base class with event helpers |
| **DEC-4** | Decision | PluginContext provides eventBus, storage, logger, config, db |
| **DEC-5** | Decision | Use `instance.*` events for instance lifecycle (not `channel.*`) |
| **DEC-6** | Decision | SDK provides subject builders for hierarchical patterns |

---

## Scope

### IN SCOPE

- `packages/channel-sdk/` package
- `ChannelPlugin` interface with full lifecycle
- `ChannelCapabilities` declaration (what a channel can do)
- `PluginContext` with all dependencies
- `BaseChannelPlugin` base class with event publishing helpers
- `ChannelRegistry` for plugin management
- **Subject builder helpers** for hierarchical event subjects
- **Event emitter helpers** (emitMessageReceived, emitInstanceConnected, etc.)
- Auto-discovery mechanism
- Per-plugin health checks
- Typing indicator helpers (`sendTyping`)
- Presence helpers

### OUT OF SCOPE

- Specific channel implementations (separate wishes)
- Hot-reload in dev mode (future enhancement)
- EventBus implementation (see `nats-events` wish)

---

## Event Publishing Pattern

Channels publish events using hierarchical subjects for multi-instance filtering:

```typescript
// Subject pattern: {event}.{channelType}.{instanceId}

// When a WhatsApp instance wa-001 receives a message:
await this.emitMessageReceived({
  instanceId: 'wa-001',
  // ... payload
});
// → Publishes to subject: message.received.whatsapp.wa-001

// When a Discord instance dc-002 connects:
await this.emitInstanceConnected({
  instanceId: 'dc-002',
  // ... payload
});
// → Publishes to subject: instance.connected.discord.dc-002
```

### Event Types Used by Channels

| Event | Subject Pattern | When |
|-------|-----------------|------|
| `message.received` | `message.received.{channel}.{instance}` | Incoming message |
| `message.sent` | `message.sent.{channel}.{instance}` | Outgoing message delivered |
| `message.failed` | `message.failed.{channel}.{instance}` | Send failed |
| `instance.connected` | `instance.connected.{channel}.{instance}` | Instance connected |
| `instance.disconnected` | `instance.disconnected.{channel}.{instance}` | Instance disconnected |
| `instance.qr_requested` | `instance.qr_requested.{channel}.{instance}` | QR code needed (WhatsApp) |
| `media.received` | `media.received.{channel}.{instance}` | Media attachment received |

---

## Execution Group A: Core Interfaces

**Goal:** Define the plugin interface, capabilities, and event types.

**Deliverables:**
- [ ] `packages/channel-sdk/package.json`
- [ ] `packages/channel-sdk/tsconfig.json`
- [ ] `packages/channel-sdk/src/types/plugin.ts` - ChannelPlugin interface
- [ ] `packages/channel-sdk/src/types/capabilities.ts` - ChannelCapabilities
- [ ] `packages/channel-sdk/src/types/context.ts` - PluginContext
- [ ] `packages/channel-sdk/src/types/events.ts` - Channel event payload types
- [ ] `packages/channel-sdk/src/types/index.ts` - Re-exports

**Acceptance Criteria:**
- [ ] ChannelPlugin interface has: initialize, connect, disconnect, destroy, sendMessage, sendTyping
- [ ] ChannelCapabilities declares: canSendText, canSendMedia, canSendReaction, canSendTyping, etc.
- [ ] PluginContext provides: eventBus, storage, logger, config, db
- [ ] Event payload types match `@omni/core` event definitions
- [ ] Types are exported and usable by channel implementations

**Validation:**
```bash
cd packages/channel-sdk && bun run build
bun run typecheck
```

---

## Execution Group B: Base Implementation & Event Helpers

**Goal:** Provide reusable base class with event publishing helpers.

**Deliverables:**
- [ ] `packages/channel-sdk/src/base/BaseChannelPlugin.ts` - Abstract base class
- [ ] `packages/channel-sdk/src/base/ChannelRegistry.ts` - Plugin registry
- [ ] `packages/channel-sdk/src/base/HealthChecker.ts` - Health check runner
- [ ] `packages/channel-sdk/src/helpers/events.ts` - Event emitter helpers
- [ ] `packages/channel-sdk/src/helpers/subjects.ts` - Subject builder helpers
- [ ] `packages/channel-sdk/src/helpers/typing.ts` - Typing indicator helpers
- [ ] `packages/channel-sdk/src/helpers/presence.ts` - Presence helpers
- [ ] `packages/channel-sdk/src/helpers/message.ts` - Message formatting helpers
- [ ] `packages/channel-sdk/src/index.ts` - Main exports

**Event Emitter Helpers:**
```typescript
// BaseChannelPlugin provides these helpers:

// Emits: message.received.{this.id}.{instanceId}
protected async emitMessageReceived(params: {
  instanceId: string;
  externalMessageId: string;
  sender: SenderInfo;
  content: MessageContent;
  // ...
}): Promise<void>;

// Emits: instance.connected.{this.id}.{instanceId}
protected async emitInstanceConnected(
  instanceId: string,
  metadata?: ConnectionMetadata
): Promise<void>;

// Emits: instance.disconnected.{this.id}.{instanceId}
protected async emitInstanceDisconnected(
  instanceId: string,
  reason: DisconnectReason,
  error?: string
): Promise<void>;

// Emits: instance.qr_requested.{this.id}.{instanceId}
protected async emitQrCode(
  instanceId: string,
  qrCode: string,
  expiresAt?: Date
): Promise<void>;

// Emits: media.received.{this.id}.{instanceId}
protected async emitMediaReceived(params: {
  instanceId: string;
  messageId: string;
  media: MediaInfo;
}): Promise<void>;
```

**Subject Builder Helpers:**
```typescript
// packages/channel-sdk/src/helpers/subjects.ts

export function buildChannelSubject(
  eventType: string,
  channelType: ChannelType,
  instanceId: string
): string {
  return `${eventType}.${channelType}.${instanceId}`;
}

// Used internally by BaseChannelPlugin
// Channels don't call this directly - they use emitX() helpers
```

**Acceptance Criteria:**
- [ ] BaseChannelPlugin handles common lifecycle (logging, event subscription)
- [ ] Event helpers automatically build hierarchical subjects
- [ ] Event helpers include proper metadata (correlationId, timestamp, source)
- [ ] ChannelRegistry can register, get, list plugins
- [ ] Health checks run on interval and report status
- [ ] `sendTyping` helper abstracts channel-specific typing
- [ ] Presence helper normalizes presence across channels

**Validation:**
```bash
bun test packages/channel-sdk
```

---

## Execution Group C: Auto-Discovery

**Goal:** Automatically discover and load channel plugins.

**Deliverables:**
- [ ] `packages/channel-sdk/src/discovery/scanner.ts` - Scan for channel-* packages
- [ ] `packages/channel-sdk/src/discovery/loader.ts` - Dynamic import plugins
- [ ] `packages/channel-sdk/src/discovery/validator.ts` - Validate plugin structure
- [ ] Integration with API startup

**Acceptance Criteria:**
- [ ] Scanner finds all `packages/channel-*` directories
- [ ] Loader imports plugins dynamically
- [ ] Invalid plugins are logged but don't crash startup
- [ ] Plugins are registered in ChannelRegistry on startup
- [ ] Each plugin's channel type is validated

**Validation:**
```bash
# Create a mock channel, verify it's discovered
mkdir -p packages/channel-mock
# ... create minimal plugin
bun run packages/api/src/index.ts
# Should log: "Discovered channel: mock"
```

---

## Technical Design

### File Structure

```
packages/channel-sdk/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Main exports
│   ├── types/
│   │   ├── index.ts
│   │   ├── plugin.ts               # ChannelPlugin interface
│   │   ├── capabilities.ts         # ChannelCapabilities
│   │   ├── context.ts              # PluginContext
│   │   └── events.ts               # Event payload types
│   ├── base/
│   │   ├── BaseChannelPlugin.ts    # Abstract base class
│   │   ├── ChannelRegistry.ts      # Plugin registry
│   │   └── HealthChecker.ts        # Health monitoring
│   ├── helpers/
│   │   ├── events.ts               # Event emitter helpers
│   │   ├── subjects.ts             # Subject builders
│   │   ├── typing.ts               # Typing indicators
│   │   ├── presence.ts             # Presence normalization
│   │   └── message.ts              # Message formatting
│   └── discovery/
│       ├── scanner.ts              # Package scanner
│       ├── loader.ts               # Dynamic loader
│       └── validator.ts            # Plugin validator
└── test/
    ├── base.test.ts
    └── helpers.test.ts
```

### ChannelPlugin Interface

```typescript
interface ChannelPlugin {
  // Identity
  readonly id: ChannelType;        // 'whatsapp', 'discord', etc.
  readonly name: string;
  readonly version: string;
  readonly capabilities: ChannelCapabilities;

  // Lifecycle
  initialize(context: PluginContext): Promise<void>;
  connect(instanceId: string, config: InstanceConfig): Promise<void>;
  disconnect(instanceId: string): Promise<void>;
  destroy(): Promise<void>;

  // Messaging
  sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult>;
  sendTyping?(instanceId: string, chatId: string, duration?: number): Promise<void>;

  // Status
  getStatus(instanceId: string): Promise<ConnectionStatus>;
  getHealth(): Promise<HealthStatus>;
}
```

### BaseChannelPlugin (Event Publishing)

```typescript
abstract class BaseChannelPlugin implements ChannelPlugin {
  abstract readonly id: ChannelType;
  // ...

  protected eventBus!: EventBus;
  protected logger!: Logger;

  /**
   * Emit message.received event with hierarchical subject.
   * Subject: message.received.{this.id}.{instanceId}
   */
  protected async emitMessageReceived(params: MessageReceivedParams): Promise<void> {
    const subject = buildChannelSubject('message.received', this.id, params.instanceId);

    await this.eventBus.publish('message.received', {
      messageId: params.messageId ?? generateId('msg'),
      externalMessageId: params.externalMessageId,
      instanceId: params.instanceId,
      channelType: this.id,
      sender: params.sender,
      content: params.content,
      conversationId: params.conversationId,
      platformTimestamp: params.timestamp,
      rawPayload: params.rawPayload,
    }, {
      subject,  // Hierarchical subject for filtering
      correlationId: generateCorrelationId(),
    });
  }

  /**
   * Emit instance.connected event.
   * Subject: instance.connected.{this.id}.{instanceId}
   */
  protected async emitInstanceConnected(
    instanceId: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    const subject = buildChannelSubject('instance.connected', this.id, instanceId);

    await this.eventBus.publish('instance.connected', {
      instanceId,
      channelType: this.id,
      profileName: metadata?.profileName,
      profilePicUrl: metadata?.profilePicUrl,
      ownerIdentifier: metadata?.ownerIdentifier,
    }, { subject });
  }

  // ... more helpers
}
```

---

## Dependencies

**NPM:**
- (none - pure TypeScript interfaces)

**Internal:**
- `@omni/core` - EventBus interface, event types, schemas

---

## Depends On

- None (can be built in parallel with `nats-events`)
- Uses EventBus interface from `@omni/core` (already exists)

## Enables

- `channel-whatsapp`
- `channel-discord`
- All future channel implementations

---

## Migration Notes

When implementing channels:
1. Extend `BaseChannelPlugin` instead of implementing `ChannelPlugin` directly
2. Use `emitMessageReceived()`, `emitInstanceConnected()` helpers (not raw eventBus.publish)
3. The helpers automatically build hierarchical subjects
4. `instanceId` and `channelType` are always included in metadata
