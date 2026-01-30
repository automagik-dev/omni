# WISH: Channel Integration

> Wire up channel plugins to the API so instances can actually connect, show QR codes, and receive messages.

**Status:** REVIEW
**Created:** 2026-01-30
**Author:** WISH Agent
**Beads:** omni-v2-d2x

---

## Context

We have all the pieces but they're not connected:
- `channel-sdk` shipped with discovery (scanner, loader, ChannelRegistry)
- `channel-whatsapp` implements BaseChannelPlugin with full Baileys integration
- API has instance routes but they're stubbed with TODOs

**Current state:**
- `POST /instances` creates DB record only
- `GET /instances/:id/qr` returns `null`
- `POST /instances/:id/connect` just sets `isActive: true` in DB
- No channel plugins are loaded at runtime

**What we need:**
- API loads channel plugins on startup
- Creating an instance starts the channel plugin
- QR code is retrievable via API (and printed to terminal for dev)
- Connection status reflects actual Baileys state
- Incoming messages trigger events (but we're NOT sending yet - user testing with personal number)

---

## Alignment

| ID | Type | Description |
|----|------|-------------|
| **ASM-1** | Assumption | `channel-whatsapp` plugin is correctly implemented |
| **ASM-2** | Assumption | `channel-sdk` discovery/loader works |
| **ASM-3** | Assumption | NATS is running for event publishing |
| **DEC-1** | Decision | Load plugins on API startup via scanner/loader |
| **DEC-2** | Decision | ChannelRegistry singleton in service context |
| **DEC-3** | Decision | QR printed to terminal in dev mode (+ available via API) |
| **DEC-4** | Decision | Receive-only for now - no outbound message sending in this wish |
| **DEC-5** | Decision | Instance auto-connects on create (no separate connect step for MVP) |
| **RISK-1** | Risk | User connecting personal WhatsApp - ensure no accidental sends |
| **RISK-2** | Risk | Baileys may have issues - need graceful error handling |

---

## Scope

### IN SCOPE

- API loads channel plugins on startup
- ChannelRegistry available in service context
- Instance creation triggers `plugin.connect()`
- QR code emitted to terminal (dev) and stored for API retrieval
- `GET /instances/:id/qr` returns actual QR code
- `GET /instances/:id/status` returns actual connection state
- `POST /instances/:id/disconnect` calls `plugin.disconnect()`
- Incoming messages emit `message.received` events
- Basic error handling for connection failures

### OUT OF SCOPE

- Outbound message sending (defer - safety for personal number testing)
- Media download/storage (defer)
- Reconnection logic testing (defer)
- Multiple simultaneous instances (test with one first)
- WebSocket real-time updates (events go to NATS, not WS yet)

---

## Execution Group A: Plugin Loading & Registry

**Goal:** API discovers and loads channel plugins on startup.

**Deliverables:**
- [ ] `packages/api/src/plugins/loader.ts` - Load channel plugins using channel-sdk scanner/loader
- [ ] `packages/api/src/plugins/registry.ts` - Global ChannelRegistry instance
- [ ] `packages/api/src/plugins/context.ts` - Create PluginContext for each plugin
- [ ] `packages/api/src/plugins/index.ts` - Export plugin infrastructure
- [ ] Update `packages/api/src/index.ts` to load plugins on startup
- [ ] Inject registry into service context

**Acceptance Criteria:**
- [ ] API startup logs "Discovered channel: whatsapp-baileys"
- [ ] ChannelRegistry accessible via `c.get('services').channels`
- [ ] Plugin receives valid PluginContext (eventBus, storage, logger, config, db)

**Validation:**
```bash
make dev-api
# Should see: "Discovered channel: whatsapp-baileys"
# Should see: "WhatsApp plugin ready"
```

---

## Execution Group B: Instance Lifecycle

**Goal:** Instance creation/deletion triggers actual plugin connect/disconnect.

**Deliverables:**
- [ ] Update `packages/api/src/services/instances.ts` to call plugin on create
- [ ] Update instance routes to use actual plugin methods
- [ ] QR code storage (in-memory or PluginStorage) for API retrieval
- [ ] QR code terminal printing in dev mode
- [ ] Connection status tracking from plugin state

**Instance Creation Flow:**
```
POST /instances { name, channel: "whatsapp-baileys" }
  → Create DB record
  → Get plugin from registry
  → Call plugin.connect(instanceId, config)
  → Plugin emits instance.qr_code event
  → QR stored and printed to terminal
  → Return instance with status: "awaiting_qr"
```

**Acceptance Criteria:**
- [ ] `POST /instances` with `channel: "whatsapp-baileys"` triggers Baileys connection
- [ ] QR code printed to terminal within 5 seconds
- [ ] `GET /instances/:id/qr` returns the QR code string
- [ ] Scanning QR with phone triggers `instance.connected` event
- [ ] `GET /instances/:id/status` shows `connected` after scan
- [ ] `DELETE /instances/:id` calls `plugin.disconnect()`

**Validation:**
```bash
# Terminal 1: Start API
make dev-api

# Terminal 2: Create instance
curl -X POST http://localhost:8881/api/v2/instances \
  -H "x-api-key: test-key" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-whatsapp", "channel": "whatsapp-baileys"}'

# Check terminal 1 for QR code
# Scan with phone

# Check status
curl http://localhost:8881/api/v2/instances/{id}/status \
  -H "x-api-key: test-key"
# Should show: { "state": "connected", "profileName": "..." }
```

---

## Execution Group C: Message Reception

**Goal:** Incoming WhatsApp messages emit events (receive-only, no sending).

**Deliverables:**
- [ ] Verify message handlers in channel-whatsapp emit correct events
- [ ] Add logging for received messages
- [ ] Simple test: send message TO the connected number, verify event logged

**Acceptance Criteria:**
- [ ] Sending a WhatsApp message TO the connected number triggers `message.received` event
- [ ] Event contains: externalId, chatId, from, content
- [ ] Event logged in API console
- [ ] NO outbound messages sent (safety check)

**Validation:**
```bash
# With instance connected:
# 1. Send a WhatsApp message FROM another phone TO the connected number
# 2. Check API logs for "message.received" event
# 3. Verify no messages sent back
```

---

## Technical Design

### Plugin Loading Flow

```typescript
// packages/api/src/plugins/loader.ts
import { scanChannelPackages, loadChannelPlugin, ChannelRegistry } from '@omni/channel-sdk';

export async function loadChannelPlugins(
  packagesDir: string,
  context: PluginContext
): Promise<ChannelRegistry> {
  const registry = new ChannelRegistry();

  const paths = await scanChannelPackages(packagesDir);

  for (const path of paths) {
    const plugin = await loadChannelPlugin(path);
    if (plugin) {
      await plugin.initialize(context);
      registry.register(plugin);
      console.log(`Discovered channel: ${plugin.id}`);
    }
  }

  return registry;
}
```

### QR Code Handling

```typescript
// In WhatsApp plugin connection handler
sock.ev.on('connection.update', async (update) => {
  if (update.qr) {
    // Emit event for storage/API
    await this.emitQrCode(instanceId, update.qr, new Date(Date.now() + 60000));

    // Print to terminal in dev mode
    if (process.env.NODE_ENV === 'development') {
      const qrcode = await import('qrcode-terminal');
      qrcode.generate(update.qr, { small: true });
    }
  }
});
```

### Service Integration

```typescript
// packages/api/src/services/instances.ts
async create(data: CreateInstanceInput): Promise<Instance> {
  // 1. Create DB record
  const instance = await this.db.insert(instances).values({...}).returning();

  // 2. Get channel plugin
  const plugin = this.channelRegistry.get(data.channel);
  if (!plugin) throw new Error(`Unknown channel: ${data.channel}`);

  // 3. Connect
  await plugin.connect(instance.id, {
    instanceId: instance.id,
    credentials: {},
    options: {},
  });

  return instance;
}
```

---

## Safety Notes

**IMPORTANT:** User is connecting personal WhatsApp number for testing.

1. **No sending** - This wish explicitly excludes outbound message sending
2. **Receive only** - We verify message reception via events
3. **Easy disconnect** - Ensure disconnect works cleanly
4. **No auto-responses** - No agent/bot logic triggers

---

## Dependencies

**Internal:**
- `@omni/channel-sdk` - ChannelRegistry, scanner, loader
- `@omni/channel-whatsapp` - WhatsApp plugin
- `@omni/core` - EventBus, types

**NPM:**
- `qrcode-terminal` - Terminal QR display (dev dependency)

---

## Depends On

- `channel-sdk` (SHIPPED)
- `channel-whatsapp` (SHIPPED)
- `nats-events` (SHIPPED)
- `api-setup` (SHIPPED)

## Enables

- Actual WhatsApp connectivity
- End-to-end message flow testing
- Foundation for message sending (next wish)
- Validation that all pieces work together
