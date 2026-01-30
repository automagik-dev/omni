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
  baseUrl: 'http://localhost:8881',
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
```

### Messages

```typescript
// Send a text message
await omni.messages.send({
  instanceId: 'instance-uuid',
  to: '1234567890',
  text: 'Hello!',
  replyTo: 'optional-message-id', // for replies
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
  AccessRule,
  Setting,
  Provider,
  HealthResponse,
  PaginationMeta,
  Channel,
  PaginatedResponse,
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
