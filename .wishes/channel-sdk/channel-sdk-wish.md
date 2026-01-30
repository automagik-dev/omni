# WISH: Channel SDK

> Plugin SDK for building channel integrations with full lifecycle management, multi-instance support, and event publishing helpers.

**Status:** DRAFT
**Created:** 2026-01-29
**Updated:** 2026-01-30
**Author:** WISH Agent
**Beads:** omni-v2-5v7

---

## Context

The Channel SDK defines how channels plug into Omni. Every channel (WhatsApp, Discord, Slack, etc.) implements this interface. The SDK handles lifecycle, health checks, and event publishing with proper hierarchical subjects.

**Multi-Instance Architecture:** Each channel type can have multiple instances (e.g., 3 WhatsApp accounts, 2 Discord bots). The SDK provides helpers for publishing events with the correct `{eventType}.{channelType}.{instanceId}` hierarchy.

**What nats-events shipped:**
- `EventBus` interface with `publish()`, `publishGeneric()`, `subscribe()`, `subscribePattern()`
- `buildSubject()`, `buildSubscribePattern()`, `parseSubject()` from `@omni/core/events/nats`
- Event payload types: `MessageReceivedPayload`, `InstanceConnectedPayload`, etc.
- 17 core event types in `EventPayloadMap`

**Existing in @omni/core:**
- Basic `ChannelPlugin` interface in `types/channel.ts` (needs enhancement)
- `ChannelType`, `ContentType`, `MessageContent` types
- Event types and payload interfaces

Reference: `docs/architecture/plugin-system.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | `nats-events` wish shipped (EventBus, subjects, payloads available) |
| **ASM-2** | Assumption | `@omni/core/types/channel.ts` has basic ChannelPlugin interface |
| **DEC-1** | Decision | Full lifecycle: initialize → connect → ready → disconnect → destroy |
| **DEC-2** | Decision | Auto-discovery of `packages/channel-*` |
| **DEC-3** | Decision | `BaseChannelPlugin` base class with event helpers |
| **DEC-4** | Decision | `PluginContext` provides eventBus, storage, logger, config, db |
| **DEC-5** | Decision | Use `instance.*` events for instance lifecycle (not `channel.*`) |
| **DEC-6** | Decision | SDK re-exports subject builders from `@omni/core/events/nats` |
| **DEC-7** | Decision | Event emitter helpers map to existing `EventPayloadMap` types |

---

## Scope

### IN SCOPE

- `packages/channel-sdk/` package
- `ChannelPlugin` interface with full lifecycle (extends existing basic interface)
- `ChannelCapabilities` declaration (what a channel can do)
- `PluginContext` with all dependencies
- `BaseChannelPlugin` base class with event publishing helpers
- `ChannelRegistry` for plugin management
- **Event emitter helpers** (emitMessageReceived, emitInstanceConnected, etc.)
- **Re-export subject builders** from `@omni/core/events/nats`
- Auto-discovery mechanism
- Per-plugin health checks
- Typing indicator helpers (`sendTyping`)
- Instance state management

### OUT OF SCOPE

- Specific channel implementations (separate wishes)
- Hot-reload in dev mode (future enhancement)
- EventBus implementation (shipped in `nats-events`)
- New event types (use existing from `@omni/core/events/types`)

---

## Event Publishing Pattern

Channels publish events using hierarchical subjects for multi-instance filtering.

**BaseChannelPlugin provides these helpers:**

```typescript
// Emits: message.received.{this.id}.{instanceId}
// Payload type: MessageReceivedPayload from @omni/core
protected async emitMessageReceived(params: {
  instanceId: string;
  externalId: string;
  chatId: string;
  from: string;
  content: { type: ContentType; text?: string; mediaUrl?: string; mimeType?: string };
  replyToId?: string;
  rawPayload?: Record<string, unknown>;
}): Promise<void>;

// Emits: instance.connected.{this.id}.{instanceId}
// Payload type: InstanceConnectedPayload from @omni/core
protected async emitInstanceConnected(
  instanceId: string,
  metadata?: { profileName?: string; profilePicUrl?: string; ownerIdentifier?: string }
): Promise<void>;

// Emits: instance.disconnected.{this.id}.{instanceId}
// Payload type: InstanceDisconnectedPayload from @omni/core
protected async emitInstanceDisconnected(
  instanceId: string,
  reason?: string,
  willReconnect?: boolean
): Promise<void>;

// Emits: instance.qr_code.{this.id}.{instanceId}
// Payload type: InstanceQrCodePayload from @omni/core
protected async emitQrCode(
  instanceId: string,
  qrCode: string,
  expiresAt: Date
): Promise<void>;

// Emits: media.received.{this.id}.{instanceId}
// Payload type: MediaReceivedPayload from @omni/core
protected async emitMediaReceived(params: {
  instanceId: string;
  eventId: string;
  mediaId: string;
  mimeType: string;
  size: number;
  url: string;
  duration?: number;
}): Promise<void>;

// Emits: message.sent.{this.id}.{instanceId}
// Payload type: MessageSentPayload from @omni/core
protected async emitMessageSent(params: {
  instanceId: string;
  externalId: string;
  chatId: string;
  to: string;
  content: { type: ContentType; text?: string; mediaUrl?: string };
  replyToId?: string;
}): Promise<void>;

// Emits: message.failed.{this.id}.{instanceId}
// Payload type: MessageFailedPayload from @omni/core
protected async emitMessageFailed(params: {
  instanceId: string;
  externalId?: string;
  chatId: string;
  error: string;
  errorCode?: string;
  retryable: boolean;
}): Promise<void>;
```

**Subject builders (re-exported from @omni/core):**

```typescript
import { buildSubject, buildSubscribePattern, parseSubject } from '@omni/channel-sdk';

// Build full subject for publishing
buildSubject('message.received', 'whatsapp-baileys', 'wa-001')
// → 'message.received.whatsapp-baileys.wa-001'

// Build pattern for subscribing
buildSubscribePattern({ eventType: 'message.received', channelType: 'whatsapp-baileys' })
// → 'message.received.whatsapp-baileys.>'
```

---

## Execution Group A: Core Interfaces & Types

**Goal:** Define the enhanced plugin interface, capabilities, and context types.

**Deliverables:**
- [ ] `packages/channel-sdk/package.json`
- [ ] `packages/channel-sdk/tsconfig.json`
- [ ] `packages/channel-sdk/src/types/plugin.ts` - Enhanced ChannelPlugin interface
- [ ] `packages/channel-sdk/src/types/capabilities.ts` - ChannelCapabilities
- [ ] `packages/channel-sdk/src/types/context.ts` - PluginContext
- [ ] `packages/channel-sdk/src/types/instance.ts` - InstanceConfig, ConnectionStatus
- [ ] `packages/channel-sdk/src/types/messaging.ts` - OutgoingMessage, SendResult
- [ ] `packages/channel-sdk/src/types/index.ts` - Re-exports

**Enhanced ChannelPlugin Interface:**
```typescript
import type { EventBus } from '@omni/core/events';
import type { ChannelType } from '@omni/core/types/channel';

interface ChannelPlugin {
  // Identity
  readonly id: ChannelType;
  readonly name: string;
  readonly version: string;
  readonly capabilities: ChannelCapabilities;

  // Lifecycle
  initialize(context: PluginContext): Promise<void>;
  destroy(): Promise<void>;

  // Instance management
  connect(instanceId: string, config: InstanceConfig): Promise<void>;
  disconnect(instanceId: string): Promise<void>;
  getStatus(instanceId: string): Promise<ConnectionStatus>;

  // Messaging
  sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult>;
  sendTyping?(instanceId: string, chatId: string, duration?: number): Promise<void>;

  // Health
  getHealth(): Promise<HealthStatus>;
}
```

**PluginContext:**
```typescript
interface PluginContext {
  eventBus: EventBus;
  storage: PluginStorage;
  logger: Logger;
  config: GlobalConfig;
  db: Database;
}
```

**Acceptance Criteria:**
- [ ] ChannelPlugin interface has: initialize, destroy, connect, disconnect, sendMessage, getStatus
- [ ] ChannelCapabilities declares: canSendText, canSendMedia, canSendReaction, canSendTyping, etc.
- [ ] PluginContext provides: eventBus, storage, logger, config, db
- [ ] Types are compatible with `@omni/core` event payloads
- [ ] Types are exported and usable by channel implementations

**Validation:**
```bash
cd packages/channel-sdk && bun run build
bun run typecheck
```

---

## Execution Group B: Base Implementation & Event Helpers

**Goal:** Provide reusable base class with event publishing helpers that use existing @omni/core types.

**Deliverables:**
- [ ] `packages/channel-sdk/src/base/BaseChannelPlugin.ts` - Abstract base class
- [ ] `packages/channel-sdk/src/base/ChannelRegistry.ts` - Plugin registry
- [ ] `packages/channel-sdk/src/base/HealthChecker.ts` - Health check runner
- [ ] `packages/channel-sdk/src/base/InstanceManager.ts` - Instance state tracking
- [ ] `packages/channel-sdk/src/helpers/events.ts` - Event emitter helpers
- [ ] `packages/channel-sdk/src/helpers/typing.ts` - Typing indicator helpers
- [ ] `packages/channel-sdk/src/helpers/message.ts` - Message formatting helpers
- [ ] `packages/channel-sdk/src/index.ts` - Main exports + re-exports from @omni/core

**BaseChannelPlugin Implementation:**
```typescript
import { buildSubject } from '@omni/core/events/nats';
import type { EventBus, MessageReceivedPayload, InstanceConnectedPayload } from '@omni/core/events';

abstract class BaseChannelPlugin implements ChannelPlugin {
  abstract readonly id: ChannelType;
  // ...

  protected eventBus!: EventBus;
  protected logger!: Logger;
  protected instances = new Map<string, InstanceState>();

  async initialize(context: PluginContext): Promise<void> {
    this.eventBus = context.eventBus;
    this.logger = context.logger.child({ plugin: this.id });
    // ...
    await this.onInitialize(context);
  }

  /**
   * Emit message.received event with hierarchical subject.
   * Uses MessageReceivedPayload type from @omni/core
   */
  protected async emitMessageReceived(params: EmitMessageReceivedParams): Promise<void> {
    const subject = buildSubject('message.received', this.id, params.instanceId);

    await this.eventBus.publish('message.received', {
      externalId: params.externalId,
      chatId: params.chatId,
      from: params.from,
      content: params.content,
      replyToId: params.replyToId,
      rawPayload: params.rawPayload,
    } satisfies MessageReceivedPayload, {
      subject,
      instanceId: params.instanceId,
      channelType: this.id,
    });
  }

  /**
   * Emit instance.connected event.
   * Uses InstanceConnectedPayload type from @omni/core
   */
  protected async emitInstanceConnected(
    instanceId: string,
    metadata?: { profileName?: string; profilePicUrl?: string; ownerIdentifier?: string }
  ): Promise<void> {
    const subject = buildSubject('instance.connected', this.id, instanceId);

    await this.eventBus.publish('instance.connected', {
      instanceId,
      channelType: this.id,
      profileName: metadata?.profileName,
      profilePicUrl: metadata?.profilePicUrl,
      ownerIdentifier: metadata?.ownerIdentifier,
    } satisfies InstanceConnectedPayload, { subject });
  }

  // ... more helpers matching EventPayloadMap types
}
```

**Re-exports in index.ts:**
```typescript
// Re-export subject builders for channel developers
export { buildSubject, buildSubscribePattern, parseSubject } from '@omni/core/events/nats';

// Re-export event types for reference
export type {
  MessageReceivedPayload,
  MessageSentPayload,
  InstanceConnectedPayload,
  InstanceDisconnectedPayload,
  InstanceQrCodePayload,
  MediaReceivedPayload,
} from '@omni/core/events';
```

**Acceptance Criteria:**
- [ ] BaseChannelPlugin handles common lifecycle (logging, instance tracking)
- [ ] Event helpers automatically build hierarchical subjects using `buildSubject()`
- [ ] Event helpers produce payloads matching `EventPayloadMap` types (compile-time verified)
- [ ] Event helpers include proper metadata (correlationId, timestamp, source)
- [ ] ChannelRegistry can register, get, list plugins
- [ ] Health checks run on interval and report status
- [ ] InstanceManager tracks connection state per instance
- [ ] Re-exports make subject builders available to channel implementations

**Validation:**
```bash
bun test packages/channel-sdk
```

---

## Execution Group C: Auto-Discovery & Integration

**Goal:** Automatically discover and load channel plugins at startup.

**Deliverables:**
- [ ] `packages/channel-sdk/src/discovery/scanner.ts` - Scan for channel-* packages
- [ ] `packages/channel-sdk/src/discovery/loader.ts` - Dynamic import plugins
- [ ] `packages/channel-sdk/src/discovery/validator.ts` - Validate plugin structure
- [ ] Integration hook for API startup

**Scanner:**
```typescript
import { readdir } from 'fs/promises';
import { join } from 'path';

export async function scanChannelPackages(packagesDir: string): Promise<string[]> {
  const entries = await readdir(packagesDir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory() && e.name.startsWith('channel-') && e.name !== 'channel-sdk')
    .map(e => join(packagesDir, e.name));
}
```

**Loader:**
```typescript
export async function loadChannelPlugin(path: string): Promise<ChannelPlugin | null> {
  try {
    const module = await import(path);
    const PluginClass = module.default ?? module.plugin;

    if (!PluginClass) {
      logger.warn(`No plugin export found in ${path}`);
      return null;
    }

    const plugin: ChannelPlugin = typeof PluginClass === 'function'
      ? new PluginClass()
      : PluginClass;

    validatePluginInterface(plugin);
    return plugin;
  } catch (error) {
    logger.error(`Failed to load plugin: ${path}`, error);
    return null;
  }
}
```

**Acceptance Criteria:**
- [ ] Scanner finds all `packages/channel-*` directories (excluding channel-sdk)
- [ ] Loader imports plugins dynamically (supports default export and named export)
- [ ] Invalid plugins are logged but don't crash startup
- [ ] Plugins are registered in ChannelRegistry on startup
- [ ] Each plugin's channel type is validated against `CHANNEL_TYPES`
- [ ] Integration with API startup loads plugins before routes are registered

**Validation:**
```bash
# Create a mock channel, verify it's discovered
mkdir -p packages/channel-mock/src
echo 'export default { id: "mock", name: "Mock", version: "0.1.0", capabilities: {} }' > packages/channel-mock/src/index.ts
bun run packages/api/src/index.ts
# Should log: "Discovered channel: mock"
rm -rf packages/channel-mock
```

---

## Technical Design

### File Structure

```
packages/channel-sdk/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Main exports + re-exports from @omni/core
│   ├── types/
│   │   ├── index.ts
│   │   ├── plugin.ts               # ChannelPlugin interface (enhanced)
│   │   ├── capabilities.ts         # ChannelCapabilities
│   │   ├── context.ts              # PluginContext
│   │   ├── instance.ts             # InstanceConfig, ConnectionStatus
│   │   └── messaging.ts            # OutgoingMessage, SendResult
│   ├── base/
│   │   ├── BaseChannelPlugin.ts    # Abstract base class
│   │   ├── ChannelRegistry.ts      # Plugin registry
│   │   ├── HealthChecker.ts        # Health monitoring
│   │   └── InstanceManager.ts      # Instance state tracking
│   ├── helpers/
│   │   ├── events.ts               # Event emitter param types
│   │   ├── typing.ts               # Typing indicators
│   │   └── message.ts              # Message formatting
│   └── discovery/
│       ├── scanner.ts              # Package scanner
│       ├── loader.ts               # Dynamic loader
│       └── validator.ts            # Plugin validator
└── test/
    ├── base.test.ts
    ├── helpers.test.ts
    └── discovery.test.ts
```

### Relationship with @omni/core

```
@omni/core
├── types/channel.ts      # ChannelType, ContentType, basic ChannelPlugin
├── events/types.ts       # EventPayloadMap, MessageReceivedPayload, etc.
├── events/bus.ts         # EventBus interface
└── events/nats/          # buildSubject, buildSubscribePattern

@omni/channel-sdk
├── types/                # Enhanced ChannelPlugin, PluginContext, Capabilities
├── base/                 # BaseChannelPlugin with event helpers
├── helpers/              # Param types for emit helpers
└── discovery/            # Auto-loading infrastructure

Re-exports from channel-sdk:
  - buildSubject, buildSubscribePattern, parseSubject (from @omni/core)
  - Event payload types (from @omni/core)
```

---

## Dependencies

**NPM:**
- (none - pure TypeScript)

**Internal:**
- `@omni/core` - EventBus interface, event types, subject builders, ChannelType

---

## Depends On

- `nats-events` wish (SHIPPED) - EventBus, subject builders, event payload types

## Enables

- `channel-whatsapp`
- `channel-discord`
- All future channel implementations

---

## Migration Notes

When implementing channels:

1. **Extend BaseChannelPlugin** instead of implementing `ChannelPlugin` directly
2. **Use emitX() helpers** - they build correct subjects and ensure type-safe payloads:
   ```typescript
   // Good - uses helper
   await this.emitMessageReceived({ instanceId, externalId, chatId, from, content });

   // Avoid - manual publish requires more boilerplate
   await this.eventBus.publish('message.received', payload, { subject });
   ```
3. **Import subject builders from channel-sdk** for consistency:
   ```typescript
   import { buildSubject, buildSubscribePattern } from '@omni/channel-sdk';
   ```
4. **instanceId and channelType** are always included automatically by helpers
