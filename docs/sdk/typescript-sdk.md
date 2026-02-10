---
title: "TypeScript SDK"
created: 2025-01-29
updated: 2026-02-09
tags: [sdk, typescript]
status: current
---

# TypeScript SDK

> The official TypeScript SDK for Omni v2 - type-safe, modern, and designed for both Node.js and edge runtimes.

> Related: [[auto-generation|SDK Auto-Generation]], [[endpoints|API Endpoints]]

## Installation

```bash
# npm
npm install @omni/sdk

# pnpm
pnpm add @omni/sdk

# bun
bun add @omni/sdk
```

## Quick Start

```typescript
import { OmniClient } from '@omni/sdk';

const omni = new OmniClient({
  apiKey: process.env.OMNI_API_KEY,
  baseUrl: 'https://api.example.com',  // Optional, defaults to localhost
});

// Send a message
const result = await omni.messages.send({
  instanceId: 'my-whatsapp-instance',
  to: '+1234567890',
  text: 'Hello from the SDK!',
});

console.log('Message sent:', result.externalMessageId);
```

## Configuration

```typescript
import { OmniClient } from '@omni/sdk';

const omni = new OmniClient({
  // Required
  apiKey: 'sk-omni-...',

  // Optional
  baseUrl: 'https://api.example.com',  // Default: http://localhost:8882
  timeout: 30000,                       // Request timeout in ms (default: 30000)
  retries: 3,                           // Number of retries (default: 3)
  retryDelay: 1000,                     // Initial retry delay (default: 1000)

  // Advanced
  fetch: customFetch,                   // Custom fetch implementation
  headers: {                            // Additional headers
    'X-Custom-Header': 'value',
  },
});
```

## Resources

### Instances

```typescript
// List instances
const instances = await omni.instances.list({
  channel: ['whatsapp-baileys'],  // Optional filter
  status: ['active'],
  limit: 50,
});

for (const instance of instances.items) {
  console.log(instance.name, instance.status);
}

// Get instance
const instance = await omni.instances.get('instance-id');

// Create instance
const newInstance = await omni.instances.create({
  name: 'my-whatsapp',
  channel: 'whatsapp-baileys',
  agent: {
    apiUrl: 'https://my-agent.example.com/api',
    timeout: 60000,
  },
  messaging: {
    debounceMode: 'disabled',
    enableAutoSplit: true,
  },
  media: {
    processAudio: true,
    processImages: true,
    processVideo: true,
    processDocuments: true,
  },
});

// Update instance
await omni.instances.update('instance-id', {
  agent: { timeout: 90000 },
});

// Delete instance
await omni.instances.delete('instance-id');

// Get status
const status = await omni.instances.getStatus('instance-id');
console.log(status.status); // 'connected' | 'disconnected' | 'connecting'

// Get QR code (WhatsApp)
const qr = await omni.instances.getQrCode('instance-id');
console.log(qr.qr);        // Base64 QR code
console.log(qr.expiresAt); // Expiration time

// Restart
await omni.instances.restart('instance-id');

// Logout
await omni.instances.logout('instance-id');
```

### Messages

```typescript
// Send text message
const result = await omni.messages.send({
  instanceId: 'my-instance',
  to: '+1234567890',
  text: 'Hello!',
  replyTo: 'message-id-to-reply-to',  // Optional
});

console.log(result.messageId);
console.log(result.externalMessageId);

// Send image
await omni.messages.sendMedia({
  instanceId: 'my-instance',
  to: '+1234567890',
  mediaType: 'image',
  mediaUrl: 'https://example.com/image.jpg',
  caption: 'Check out this image!',
});

// Send document
await omni.messages.sendMedia({
  instanceId: 'my-instance',
  to: '+1234567890',
  mediaType: 'document',
  mediaBase64: base64Content,
  filename: 'report.pdf',
});

// Send voice note
await omni.messages.sendMedia({
  instanceId: 'my-instance',
  to: '+1234567890',
  mediaType: 'audio',
  mediaUrl: 'https://example.com/voice.ogg',
  voiceNote: true,
});

// Send reaction
await omni.messages.sendReaction({
  instanceId: 'my-instance',
  to: '+1234567890',
  messageId: 'target-message-id',
  emoji: '👍',
});
```

### Events

```typescript
// List events
const events = await omni.events.list({
  channel: ['whatsapp-baileys', 'discord'],
  since: new Date('2025-01-01'),
  until: new Date(),
  contentType: ['text', 'audio'],
  limit: 100,
});

for (const event of events.items) {
  console.log(event.eventType, event.textContent);
}

// Pagination
let cursor: string | undefined;
do {
  const page = await omni.events.list({ limit: 50, cursor });
  // Process page.items
  cursor = page.meta.cursor;
} while (cursor);

// Get single event
const event = await omni.events.get('event-id');

// Get timeline for a person (cross-channel)
const timeline = await omni.events.timeline('person-id', {
  channels: ['whatsapp-baileys', 'discord'],
  since: new Date('2025-01-01'),
  limit: 100,
});

for (const event of timeline.items) {
  console.log(`[${event.channel}] ${event.content.text}`);
}

// Search events
const results = await omni.events.search({
  query: 'meeting tomorrow',
  filters: {
    personId: 'person-id',
    since: new Date('2025-01-01'),
  },
  format: 'agent',  // LLM-friendly format
});

console.log(results.summary);    // "Found 5 events about meetings"
console.log(results.asContext); // Formatted for LLM context
```

### Persons (Identity)

```typescript
// Search persons
const persons = await omni.persons.search('John');

for (const person of persons.items) {
  console.log(person.displayName, person.primaryPhone);
}

// Get person
const person = await omni.persons.get('person-id');

// Get presence (all identities across channels)
const presence = await omni.persons.getPresence('person-id');

console.log('Active channels:', presence.summary.activeChannels);
console.log('Total messages:', presence.summary.totalMessages);
console.log('Last seen:', presence.summary.lastSeenAt);

for (const identity of presence.identities) {
  console.log(`${identity.channel}: ${identity.platformUsername}`);
}

// Get conversation timeline
const timeline = await omni.persons.getTimeline('person-id', {
  channels: ['whatsapp-baileys', 'discord'],
  limit: 50,
});

// Link identities
const mergedPerson = await omni.persons.link(
  'identity-a-id',
  'identity-b-id'
);

// Unlink identity
const { person, identity } = await omni.persons.unlink(
  'identity-id',
  'Wrong person linked'
);
```

### Access Rules

```typescript
// List rules
const rules = await omni.access.listRules({
  instanceId: 'my-instance',
  type: 'deny',
});

// Create rule
const rule = await omni.access.createRule({
  instanceId: 'my-instance',  // null for global
  type: 'deny',
  criteria: {
    phonePatterns: ['+1555*'],  // Block all 555 numbers
  },
  priority: 100,
  action: {
    type: 'block',
    message: 'This number is not allowed',
  },
});

// Update rule
await omni.access.updateRule('rule-id', {
  enabled: false,
});

// Delete rule
await omni.access.deleteRule('rule-id');

// Check access
const check = await omni.access.check({
  instanceId: 'my-instance',
  platformUserId: '+15551234567',
  channel: 'whatsapp-baileys',
});

console.log(check.allowed); // true or false
console.log(check.reason);  // "Rule matched: ..."
```

### Settings

```typescript
// Get all settings
const settings = await omni.settings.list();

// Get setting
const apiKey = await omni.settings.get('GROQ_API_KEY');

// Update setting
await omni.settings.set('GROQ_API_KEY', 'gsk_...');

// Update multiple
await omni.settings.setMany({
  'GROQ_API_KEY': 'gsk_...',
  'GEMINI_API_KEY': 'AIza...',
});
```

### Channels

```typescript
// List available channels
const channels = await omni.channels.list();

for (const channel of channels.items) {
  console.log(channel.name, channel.capabilities.messaging);
}

// Get channel info
const whatsapp = await omni.channels.get('whatsapp-baileys');
console.log(whatsapp.capabilities.maxMessageLength);
```

## Real-time Events

Subscribe to real-time events via WebSocket:

```typescript
import { OmniClient, OmniEventType } from '@omni/sdk';

const omni = new OmniClient({ apiKey: '...' });

// Connect to WebSocket
const ws = omni.realtime.connect();

// Subscribe to events
ws.subscribe({
  channels: ['events', 'instances'],
  filters: {
    instanceId: 'my-instance',
  },
});

// Listen for events
ws.on('event', (event) => {
  if (event.type === 'message.received') {
    console.log('New message:', event.payload.content);
  }
});

ws.on('instance.status', (event) => {
  console.log('Instance status changed:', event.payload.status);
});

// Handle errors
ws.on('error', (error) => {
  console.error('WebSocket error:', error);
});

// Disconnect
ws.disconnect();
```

## Error Handling

```typescript
import { OmniClient, OmniError, ValidationError, NotFoundError } from '@omni/sdk';

try {
  await omni.messages.send({
    instanceId: 'invalid',
    to: 'bad-number',
    text: 'Hello',
  });
} catch (error) {
  if (error instanceof ValidationError) {
    console.log('Validation failed:', error.details);
    // { field: 'to', received: 'bad-number', expected: 'E.164 format' }
  } else if (error instanceof NotFoundError) {
    console.log('Instance not found');
  } else if (error instanceof OmniError) {
    console.log('API error:', error.code, error.message);
  } else {
    throw error;
  }
}
```

## TypeScript Types

All types are exported:

```typescript
import type {
  Instance,
  InstanceConfig,
  InstanceStatus,
  Message,
  MessageContent,
  Event,
  Person,
  PlatformIdentity,
  PersonPresence,
  AccessRule,
  Setting,
  ChannelType,
  ContentType,
} from '@omni/sdk';
```

## Advanced Usage

### Custom Fetch

```typescript
import { OmniClient } from '@omni/sdk';

const omni = new OmniClient({
  apiKey: '...',
  fetch: async (url, options) => {
    // Add custom logic
    console.log('Fetching:', url);
    return fetch(url, options);
  },
});
```

### Request Interceptors

```typescript
const omni = new OmniClient({
  apiKey: '...',
  onRequest: async (request) => {
    // Modify request before sending
    request.headers['X-Request-ID'] = crypto.randomUUID();
    return request;
  },
  onResponse: async (response) => {
    // Process response
    console.log('Response status:', response.status);
    return response;
  },
});
```

### Using with tRPC

For type-safe internal use:

```typescript
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@omni/api';

const trpc = createTRPCProxyClient<AppRouter>({
  links: [
    httpBatchLink({
      url: 'http://localhost:8882/trpc',
      headers: {
        'x-api-key': process.env.OMNI_API_KEY,
      },
    }),
  ],
});

// Fully typed!
const instances = await trpc.instances.list.query({
  channel: ['whatsapp-baileys'],
});
```

## Examples

### Send Message to All WhatsApp Contacts

```typescript
import { OmniClient } from '@omni/sdk';

const omni = new OmniClient({ apiKey: process.env.OMNI_API_KEY });

async function broadcastMessage(instanceId: string, text: string) {
  // Get recent conversations
  const events = await omni.events.list({
    instanceId,
    channel: ['whatsapp-baileys'],
    eventType: ['message.received'],
    limit: 1000,
  });

  // Extract unique senders
  const senders = new Set<string>();
  for (const event of events.items) {
    senders.add(event.sender.platformUserId);
  }

  // Send to each
  for (const to of senders) {
    await omni.messages.send({ instanceId, to, text });
    // Rate limit
    await new Promise(r => setTimeout(r, 1000));
  }

  return senders.size;
}
```

### Cross-Channel Context for Agent

```typescript
import { OmniClient } from '@omni/sdk';

const omni = new OmniClient({ apiKey: process.env.OMNI_API_KEY });

async function getContextForPerson(personId: string): Promise<string> {
  // Get cross-channel timeline
  const timeline = await omni.events.timeline(personId, {
    limit: 50,
  });

  // Format for LLM
  const context = timeline.items.map(event => {
    const time = new Date(event.timestamp).toISOString();
    const channel = event.channel;
    const content = event.content.text || event.content.transcription || `[${event.content.type}]`;
    return `[${time}] (${channel}) ${event.direction === 'inbound' ? 'User' : 'Assistant'}: ${content}`;
  }).join('\n');

  return context;
}
```

### Monitor Instance Health

```typescript
import { OmniClient } from '@omni/sdk';

const omni = new OmniClient({ apiKey: process.env.OMNI_API_KEY });

async function monitorInstances() {
  const instances = await omni.instances.list();

  for (const instance of instances.items) {
    const status = await omni.instances.getStatus(instance.id);

    if (status.status !== 'connected') {
      console.log(`⚠️ ${instance.name} is ${status.status}`);

      // Try to restart
      if (status.status === 'disconnected') {
        console.log(`  Restarting...`);
        await omni.instances.restart(instance.id);
      }
    } else {
      console.log(`✅ ${instance.name} is connected`);
    }
  }
}

// Run every 5 minutes
setInterval(monitorInstances, 5 * 60 * 1000);
```
