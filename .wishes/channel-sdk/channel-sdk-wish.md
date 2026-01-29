# WISH: Channel SDK

> Plugin SDK for building channel integrations with full lifecycle management, auto-discovery, and health checks.

**Status:** DRAFT
**Created:** 2026-01-29
**Author:** WISH Agent
**Beads:** omni-v2-5v7

---

## Context

The Channel SDK defines how channels plug into Omni. Every channel (WhatsApp, Discord, Slack, etc.) implements this interface. The SDK handles lifecycle, health checks, and event routing.

Reference: `docs/architecture/plugin-system.md`

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | API is running and exposes EventBus |
| **DEC-1** | Decision | Full lifecycle: initialize → connect → ready → disconnect → destroy |
| **DEC-2** | Decision | Auto-discovery of `packages/channel-*` |
| **DEC-3** | Decision | BaseChannelPlugin base class for common functionality |
| **DEC-4** | Decision | PluginContext provides eventBus, storage, logger, config, db |

---

## Scope

### IN SCOPE

- `packages/channel-sdk/` package
- `ChannelPlugin` interface with full lifecycle
- `ChannelCapabilities` declaration (what a channel can do)
- `PluginContext` with all dependencies
- `BaseChannelPlugin` base class
- `ChannelRegistry` for plugin management
- Auto-discovery mechanism
- Per-plugin health checks
- Event subscription helpers
- Typing indicator helpers (`sendTyping`)
- Presence helpers

### OUT OF SCOPE

- Specific channel implementations (separate wishes)
- Hot-reload in dev mode (future enhancement)

---

## Execution Group A: Core Interfaces

**Goal:** Define the plugin interface and capabilities.

**Deliverables:**
- [ ] `packages/channel-sdk/package.json`
- [ ] `packages/channel-sdk/tsconfig.json`
- [ ] `packages/channel-sdk/src/types/plugin.ts` - ChannelPlugin interface
- [ ] `packages/channel-sdk/src/types/capabilities.ts` - ChannelCapabilities
- [ ] `packages/channel-sdk/src/types/context.ts` - PluginContext
- [ ] `packages/channel-sdk/src/types/events.ts` - Channel event types
- [ ] `packages/channel-sdk/src/types/index.ts` - Re-exports

**Acceptance Criteria:**
- [ ] ChannelPlugin interface has: initialize, connect, disconnect, destroy, sendMessage, sendTyping
- [ ] ChannelCapabilities declares: canSendText, canSendMedia, canSendReaction, canSendTyping, etc.
- [ ] PluginContext provides: eventBus, storage, logger, config, db
- [ ] Types are exported and usable by channel implementations

**Validation:**
```bash
cd packages/channel-sdk && bun run build
bun run typecheck
```

---

## Execution Group B: Base Implementation

**Goal:** Provide reusable base class and registry.

**Deliverables:**
- [ ] `packages/channel-sdk/src/base/BaseChannelPlugin.ts` - Abstract base class
- [ ] `packages/channel-sdk/src/base/ChannelRegistry.ts` - Plugin registry
- [ ] `packages/channel-sdk/src/base/HealthChecker.ts` - Health check runner
- [ ] `packages/channel-sdk/src/helpers/typing.ts` - Typing indicator helpers
- [ ] `packages/channel-sdk/src/helpers/presence.ts` - Presence helpers
- [ ] `packages/channel-sdk/src/helpers/message.ts` - Message formatting helpers
- [ ] `packages/channel-sdk/src/index.ts` - Main exports

**Acceptance Criteria:**
- [ ] BaseChannelPlugin handles common lifecycle (logging, event subscription)
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

**Validation:**
```bash
# Create a mock channel, verify it's discovered
mkdir -p packages/channel-mock
# ... create minimal plugin
bun run packages/api/src/index.ts
# Should log: "Discovered channel: mock"
```

---

## Technical Notes

### ChannelPlugin Interface

```typescript
interface ChannelPlugin {
  id: string;
  name: string;
  version: string;
  capabilities: ChannelCapabilities;

  // Lifecycle
  initialize(context: PluginContext): Promise<void>;
  connect(instanceId: string, config: unknown): Promise<void>;
  disconnect(instanceId: string): Promise<void>;
  destroy(): Promise<void>;

  // Messaging
  sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult>;
  sendTyping(instanceId: string, chatId: string, duration?: number): Promise<void>;

  // Status
  getStatus(instanceId: string): Promise<ConnectionStatus>;
  getHealth(): Promise<HealthStatus>;
}
```

### ChannelCapabilities

```typescript
interface ChannelCapabilities {
  canSendText: boolean;
  canSendImage: boolean;
  canSendAudio: boolean;
  canSendVideo: boolean;
  canSendDocument: boolean;
  canSendSticker: boolean;
  canSendReaction: boolean;
  canSendLocation: boolean;
  canSendContact: boolean;
  canSendTyping: boolean;
  canReceivePresence: boolean;
  canEditMessage: boolean;
  canDeleteMessage: boolean;
  supportsThreads: boolean;
  supportsSlashCommands: boolean;
  maxMessageLength: number;
}
```

---

## Dependencies

- `@omni/core` - Event types, schemas
- `@omni/db` - Database client (for plugin storage)

---

## Depends On

- `api-setup` (for EventBus integration)

## Enables

- `channel-whatsapp`
- `channel-discord`
- All future channel implementations
