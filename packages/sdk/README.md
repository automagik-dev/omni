# @omni/sdk

> TypeScript SDK for the Omni v2 API

Auto-generated from OpenAPI spec with type-safe wrapper and full IDE autocomplete.

## Installation

```bash
bun add @omni/sdk
```

## Quick Start

```typescript
import { createOmniClient } from '@omni/sdk';

const omni = createOmniClient({
  baseUrl: 'http://localhost:8882',
  apiKey: 'your-api-key',
});

// List instances with full autocomplete
const { items, meta } = await omni.instances.list();
console.log(`Found ${items.length} instances`);

// Create an instance
const instance = await omni.instances.create({
  name: 'My WhatsApp',
  channel: 'whatsapp-baileys',
});

// Send a message
await omni.messages.send({
  instanceId: instance.id!,
  to: '1234567890',
  text: 'Hello from Omni SDK!',
});
```

## API Reference

### Authentication

```typescript
// Validate the current API key
const auth = await omni.auth.validate();
console.log(auth.valid);     // true
console.log(auth.keyName);   // 'primary' or custom name
console.log(auth.scopes);    // ['*'] or specific scopes
```

### Instances

```typescript
// List all instances
const { items, meta } = await omni.instances.list({
  channel: 'whatsapp-baileys',
  status: 'active',
  limit: 50,
  cursor: 'abc123',
});

// Get a single instance
const instance = await omni.instances.get('uuid');

// Create an instance
const instance = await omni.instances.create({
  name: 'My Instance',
  channel: 'whatsapp-baileys', // or 'whatsapp-cloud', 'discord', 'slack', 'telegram'
  agentProviderId: 'optional-provider-uuid',
  agentId: 'default',
});

// Update an instance
await omni.instances.update('uuid', { name: 'New Name' });

// Delete an instance
await omni.instances.delete('uuid');

// Get instance status
const status = await omni.instances.status('uuid');
console.log(status.state, status.isConnected);

// Get QR code (WhatsApp)
const qr = await omni.instances.qr('uuid');
console.log(qr.qr); // Base64 QR image

// Connect/disconnect/restart
await omni.instances.connect('uuid');
await omni.instances.disconnect('uuid');
await omni.instances.restart('uuid', true /* forceNewQr */);

// Request pairing code (WhatsApp)
const pair = await omni.instances.pair('uuid', { phoneNumber: '+1234567890' });
console.log(pair.code);

// Logout (clear session)
await omni.instances.logout('uuid');

// Sync profile immediately
const profile = await omni.instances.syncProfile('uuid');
console.log(profile.profile?.name);

// Start a sync job (messages, contacts, groups, or all)
const job = await omni.instances.startSync('uuid', {
  type: 'messages',      // 'profile' | 'messages' | 'contacts' | 'groups' | 'all'
  depth: '30d',          // '7d' | '30d' | '90d' | '1y' | 'all'
  channelId: 'optional', // For specific chat/channel
  downloadMedia: true,   // Download media files
});
console.log(job.jobId);

// List sync jobs
const { items } = await omni.instances.listSyncs('uuid', {
  status: 'running', // Filter by status
  limit: 20,
});

// Get sync job status
const status = await omni.instances.getSyncStatus('uuid', job.jobId);
console.log(status.status, status.progressPercent);
```

### Chats

```typescript
// List chats
const { items, meta } = await omni.chats.list({
  instanceId: 'uuid',
  channel: 'whatsapp-baileys',
  chatType: 'dm',
  search: 'john',
  includeArchived: false,
  limit: 50,
});

// Get a chat
const chat = await omni.chats.get('chat-uuid');

// Create a chat
const chat = await omni.chats.create({
  instanceId: 'uuid',
  externalId: 'external-chat-id',
  chatType: 'dm',
  channel: 'whatsapp-baileys',
  name: 'Chat Name',
});

// Update a chat
await omni.chats.update('chat-uuid', { name: 'New Name' });

// Archive/unarchive
await omni.chats.archive('chat-uuid');
await omni.chats.unarchive('chat-uuid');

// Get messages
const messages = await omni.chats.getMessages('chat-uuid', {
  limit: 50,
  before: 'cursor',
});

// Participants
const participants = await omni.chats.listParticipants('chat-uuid');
await omni.chats.addParticipant('chat-uuid', { platformUserId: '123' });
await omni.chats.removeParticipant('chat-uuid', '123');

// Delete a chat
await omni.chats.delete('chat-uuid');
```

### Messages

```typescript
// Send a text message
const result = await omni.messages.send({
  instanceId: 'instance-uuid',
  to: '1234567890',
  text: 'Hello!',
  replyTo: 'optional-message-id',
});
console.log(result.messageId);

// Send media
await omni.messages.sendMedia({
  instanceId: 'uuid',
  to: '1234567890',
  type: 'image', // 'image' | 'audio' | 'video' | 'document'
  url: 'https://example.com/image.jpg',
  caption: 'Check this out!',
});

// Send reaction
await omni.messages.sendReaction({
  instanceId: 'uuid',
  to: '1234567890',
  messageId: 'msg-id',
  emoji: '👍',
});

// Send sticker
await omni.messages.sendSticker({
  instanceId: 'uuid',
  to: '1234567890',
  url: 'https://example.com/sticker.webp',
});

// Send contact
await omni.messages.sendContact({
  instanceId: 'uuid',
  to: '1234567890',
  contact: { name: 'John', phone: '+1234567890' },
});

// Send location
await omni.messages.sendLocation({
  instanceId: 'uuid',
  to: '1234567890',
  latitude: 37.7749,
  longitude: -122.4194,
  name: 'San Francisco',
});

// Discord-specific: Send poll
await omni.messages.sendPoll({
  instanceId: 'uuid',
  to: 'channel-id',
  question: 'Favorite color?',
  answers: ['Red', 'Blue', 'Green'],
  durationHours: 24,
});

// Discord-specific: Send embed
await omni.messages.sendEmbed({
  instanceId: 'uuid',
  to: 'channel-id',
  title: 'My Embed',
  description: 'Some content',
  color: 0x00ff00,
  fields: [{ name: 'Field', value: 'Value', inline: true }],
});
```

### Events

```typescript
// List events with filters
const { items, meta } = await omni.events.list({
  channel: 'whatsapp-baileys',
  instanceId: 'uuid',
  eventType: 'message.received',
  since: '2024-01-01T00:00:00Z',
  until: '2024-01-31T23:59:59Z',
  search: 'hello',
  limit: 100,
  cursor: 'abc123',
});
```

### Persons

```typescript
// Search for persons
const persons = await omni.persons.search({
  search: 'john',
  limit: 20,
});
```

### Access Rules

```typescript
// List access rules
const rules = await omni.access.listRules({
  instanceId: 'uuid',
  type: 'allow', // or 'deny'
});

// Create an access rule
await omni.access.createRule({
  ruleType: 'allow',
  instanceId: 'uuid',
  phonePattern: '+1*',
  priority: 10,
});
```

### Settings

```typescript
// List settings
const settings = await omni.settings.list({
  category: 'general',
});
```

### Providers

```typescript
// List AI providers
const providers = await omni.providers.list({
  active: true,
});
```

### Logs

```typescript
// Get recent logs
const { items, meta } = await omni.logs.recent({
  modules: 'api,whatsapp:*',
  level: 'info', // 'debug' | 'info' | 'warn' | 'error'
  limit: 100,
});
```

### Automations

```typescript
// List automations
const automations = await omni.automations.list({ enabled: true });

// Get an automation
const automation = await omni.automations.get('uuid');

// Create an automation
const automation = await omni.automations.create({
  name: 'Auto-reply',
  triggerEventType: 'message.received',
  triggerConditions: [
    { field: 'payload.content.text', operator: 'contains', value: 'hello' },
  ],
  actions: [
    {
      type: 'send_message',
      config: { contentTemplate: 'Hi there!' },
    },
  ],
  enabled: true,
});

// Enable/disable
await omni.automations.enable('uuid');
await omni.automations.disable('uuid');

// Test (dry run)
const result = await omni.automations.test('uuid', {
  event: { type: 'message.received', payload: { content: { text: 'hello' } } },
});
console.log(result.matched);

// Get logs
const { items } = await omni.automations.getLogs('uuid');

// Delete
await omni.automations.delete('uuid');
```

### Dead Letters

```typescript
// List failed events
const { items, meta } = await omni.deadLetters.list({
  status: 'pending', // comma-separated: pending,retrying,resolved,abandoned
  eventType: 'message.received',
  since: '2024-01-01T00:00:00Z',
  limit: 50,
});

// Get statistics
const stats = await omni.deadLetters.stats();
console.log(stats.pending, stats.resolved);

// Get details
const dl = await omni.deadLetters.get('uuid');

// Retry
await omni.deadLetters.retry('uuid');

// Resolve (mark as fixed)
await omni.deadLetters.resolve('uuid', { note: 'Fixed manually' });

// Abandon (give up)
await omni.deadLetters.abandon('uuid');
```

### Event Ops

```typescript
// Get event metrics
const metrics = await omni.eventOps.metrics();

// Start a replay session
const session = await omni.eventOps.startReplay({
  since: '2024-01-01T00:00:00Z',
  until: '2024-01-31T23:59:59Z',
  eventTypes: ['message.received'],
  instanceId: 'uuid',
  dryRun: true,
});

// List/get replay sessions
const sessions = await omni.eventOps.listReplays();
const session = await omni.eventOps.getReplay('session-id');

// Cancel a replay
await omni.eventOps.cancelReplay('session-id');
```

### Webhooks

```typescript
// List webhook sources
const sources = await omni.webhooks.listSources({ enabled: true });

// Create a webhook source
const source = await omni.webhooks.createSource({
  name: 'github',
  description: 'GitHub webhooks',
  enabled: true,
});

// Update/delete
await omni.webhooks.updateSource('uuid', { enabled: false });
await omni.webhooks.deleteSource('uuid');

// Trigger a custom event
await omni.webhooks.trigger({
  eventType: 'custom.my-event',
  payload: { foo: 'bar' },
  correlationId: 'optional-id',
});
```

### Payloads

```typescript
// List payloads for an event
const payloads = await omni.payloads.listForEvent('event-uuid');

// Get specific stage payload
const payload = await omni.payloads.getStage('event-uuid', 'webhook_raw');

// Delete payloads
await omni.payloads.delete('event-uuid', { reason: 'GDPR request' });

// Manage configs
const configs = await omni.payloads.listConfigs();
await omni.payloads.updateConfig('message.received', {
  storeWebhookRaw: true,
  retentionDays: 30,
});

// Get statistics
const stats = await omni.payloads.stats();
```

### System

```typescript
// Check health (no auth required)
const health = await omni.system.health();
console.log(health.status); // 'healthy' | 'degraded' | 'unhealthy'
```

## Error Handling

All errors are thrown as `OmniApiError`:

```typescript
import { createOmniClient, OmniApiError } from '@omni/sdk';

try {
  await omni.instances.get('non-existent-id');
} catch (error) {
  if (error instanceof OmniApiError) {
    console.log(error.code);    // 'NOT_FOUND'
    console.log(error.message); // 'Instance not found'
    console.log(error.status);  // 404
    console.log(error.details); // { id: '...' }
  }
}
```

## Advanced Usage

### Raw Client

For operations not covered by the wrapper, use the raw openapi-fetch client:

```typescript
const { data, error, response } = await omni.raw.GET('/instances/{id}', {
  params: { path: { id: 'uuid' } },
});
```

### Type Imports

All types are exported for use in your application:

```typescript
import type {
  Instance,
  Person,
  Event,
  Chat,
  Message,
  ChatParticipant,
  AccessRule,
  Setting,
  Provider,
  Automation,
  DeadLetter,
  WebhookSource,
  PayloadConfig,
  ReplaySession,
  LogEntry,
  HealthResponse,
  PaginationMeta,
  Channel,
  PaginatedResponse,
  AuthValidateResponse,
  SyncProfileResult,
  SyncJobCreated,
  SyncJobSummary,
  SyncJobStatus,
} from '@omni/sdk';
```

### Low-level Types

For advanced type manipulation, you can import the generated OpenAPI types:

```typescript
import type { paths, components, operations } from '@omni/sdk';
```

## Development

### Generate Types

```bash
bun run generate:sdk
```

### Build

```bash
bun run build
```

### Test

```bash
bun test

# Integration tests (requires running API)
RUN_INTEGRATION_TESTS=true bun test
```

## License

MIT
