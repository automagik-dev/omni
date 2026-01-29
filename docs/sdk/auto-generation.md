# SDK Auto-Generation

> Define schemas once, generate everything else. Zero maintenance overhead for SDKs.

## Philosophy

```
┌─────────────────────────────────────────────────────────────────┐
│                    SINGLE SOURCE OF TRUTH                        │
│                                                                  │
│   packages/core/src/schemas/     ← YOU MAINTAIN THIS ONLY       │
│                                                                  │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          │ AUTO-GENERATED ↓
                          │
          ┌───────────────┼───────────────┬───────────────┐
          ▼               ▼               ▼               ▼
   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
   │   OpenAPI   │ │  TypeScript │ │  Python SDK │ │   Go SDK    │
   │    Spec     │ │     SDK     │ │             │ │             │
   └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
          │
          ▼
   ┌─────────────┐
   │  Swagger UI │
   │  (API Docs) │
   └─────────────┘
```

## Stack

| Component | Library | Purpose |
|-----------|---------|---------|
| Schema Definition | Zod | Type-safe schemas with runtime validation |
| OpenAPI Generation | @hono/zod-openapi | Generate OpenAPI 3.1 spec from routes |
| TypeScript Types | openapi-typescript | Generate TS types from OpenAPI |
| TypeScript Client | openapi-fetch | Type-safe fetch wrapper |
| Multi-language SDKs | openapi-generator-cli | Generate Python, Go, Java, etc. |
| API Documentation | @hono/swagger-ui | Interactive API docs |

## Schema Definition (Source of Truth)

All schemas live in `packages/core/src/schemas/`:

```typescript
// packages/core/src/schemas/instances.ts

import { z } from 'zod';

// ============================================================
// ENUMS
// ============================================================

export const ChannelTypeSchema = z.enum([
  'whatsapp-baileys',
  'whatsapp-cloud',
  'discord',
  'slack',
  'telegram',
]).describe('Supported messaging channels');

export const InstanceStatusSchema = z.enum([
  'active',
  'inactive',
  'connecting',
  'error',
]).describe('Instance connection status');

export const DebounceModeSchema = z.enum([
  'disabled',
  'fixed',
  'randomized',
]).describe('Message debouncing mode');

// ============================================================
// NESTED OBJECTS
// ============================================================

export const AgentConfigSchema = z.object({
  providerId: z.string().uuid().optional()
    .describe('Reference to shared agent provider'),
  apiUrl: z.string().url().optional()
    .describe('Direct agent API URL (if not using provider)'),
  apiKey: z.string().optional()
    .describe('Agent API key (encrypted at rest)'),
  agentId: z.string().optional()
    .describe('Specific agent ID to use'),
  timeout: z.number().int().min(1000).max(300000).default(60000)
    .describe('Request timeout in milliseconds'),
  streaming: z.boolean().default(false)
    .describe('Enable streaming responses'),
}).describe('Agent API configuration');

export const MessagingConfigSchema = z.object({
  debounceMode: DebounceModeSchema.default('disabled'),
  debounceMs: z.number().int().min(0).max(30000).optional()
    .describe('Debounce delay for fixed mode (ms)'),
  debounceMinMs: z.number().int().min(0).max(30000).optional()
    .describe('Minimum delay for randomized mode (ms)'),
  debounceMaxMs: z.number().int().min(0).max(30000).optional()
    .describe('Maximum delay for randomized mode (ms)'),
  enableAutoSplit: z.boolean().default(true)
    .describe('Split messages on double newlines'),
  splitDelayMinMs: z.number().int().min(0).max(5000).default(300)
    .describe('Minimum delay between split messages'),
  splitDelayMaxMs: z.number().int().min(0).max(5000).default(1000)
    .describe('Maximum delay between split messages'),
  usernamePrefix: z.boolean().default(false)
    .describe('Prepend sender username to messages'),
}).describe('Message handling configuration');

export const MediaConfigSchema = z.object({
  processAudio: z.boolean().default(true)
    .describe('Transcribe audio messages'),
  processImages: z.boolean().default(true)
    .describe('Generate image descriptions'),
  processVideo: z.boolean().default(false)
    .describe('Generate video descriptions'),
  processDocuments: z.boolean().default(true)
    .describe('Extract text from documents'),
  processOnBlocked: z.boolean().default(false)
    .describe('Process media even if sender is blocked'),
}).describe('Media processing configuration');

// ============================================================
// MAIN SCHEMAS
// ============================================================

export const InstanceSchema = z.object({
  id: z.string().uuid()
    .describe('Unique instance identifier'),
  name: z.string().min(1).max(100)
    .describe('Human-readable instance name'),
  channel: ChannelTypeSchema,
  status: InstanceStatusSchema,

  // Timestamps
  createdAt: z.string().datetime()
    .describe('ISO 8601 creation timestamp'),
  updatedAt: z.string().datetime()
    .describe('ISO 8601 last update timestamp'),
  lastConnectedAt: z.string().datetime().nullable()
    .describe('ISO 8601 last successful connection'),

  // Nested configs
  agent: AgentConfigSchema.optional(),
  messaging: MessagingConfigSchema.optional(),
  media: MediaConfigSchema.optional(),

  // Channel-specific (opaque to SDK, handled by plugins)
  channelConfig: z.record(z.unknown()).optional()
    .describe('Channel-specific configuration'),
}).describe('Messaging instance');

export const CreateInstanceSchema = z.object({
  name: InstanceSchema.shape.name,
  channel: ChannelTypeSchema,
  agent: AgentConfigSchema.optional(),
  messaging: MessagingConfigSchema.optional(),
  media: MediaConfigSchema.optional(),
  channelConfig: z.record(z.unknown()).optional(),
}).describe('Create instance request');

export const UpdateInstanceSchema = CreateInstanceSchema.partial()
  .describe('Update instance request');

// ============================================================
// RESPONSE SCHEMAS
// ============================================================

export const ConnectionStatusSchema = z.object({
  instanceId: z.string().uuid(),
  status: InstanceStatusSchema,
  connected: z.boolean(),
  qrCode: z.string().optional()
    .describe('Base64 QR code for WhatsApp connection'),
  qrExpiresAt: z.string().datetime().optional(),
  error: z.string().optional(),
  connectedPhone: z.string().optional()
    .describe('Connected phone number (WhatsApp)'),
  connectedUser: z.string().optional()
    .describe('Connected username (Discord/Slack)'),
}).describe('Instance connection status');

export const QrCodeResponseSchema = z.object({
  qr: z.string()
    .describe('Base64 encoded QR code image'),
  expiresAt: z.string().datetime()
    .describe('QR code expiration time'),
}).describe('QR code response');

// ============================================================
// TYPE EXPORTS (derived from Zod)
// ============================================================

export type ChannelType = z.infer<typeof ChannelTypeSchema>;
export type InstanceStatus = z.infer<typeof InstanceStatusSchema>;
export type DebounceMode = z.infer<typeof DebounceModeSchema>;
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type MessagingConfig = z.infer<typeof MessagingConfigSchema>;
export type MediaConfig = z.infer<typeof MediaConfigSchema>;
export type Instance = z.infer<typeof InstanceSchema>;
export type CreateInstance = z.infer<typeof CreateInstanceSchema>;
export type UpdateInstance = z.infer<typeof UpdateInstanceSchema>;
export type ConnectionStatus = z.infer<typeof ConnectionStatusSchema>;
export type QrCodeResponse = z.infer<typeof QrCodeResponseSchema>;
```

```typescript
// packages/core/src/schemas/messages.ts

import { z } from 'zod';
import { ChannelTypeSchema } from './instances';

// ============================================================
// CONTENT TYPES
// ============================================================

export const ContentTypeSchema = z.enum([
  'text',
  'image',
  'audio',
  'video',
  'document',
  'sticker',
  'reaction',
  'poll',
  'location',
  'contact',
  'protocol',
]).describe('Message content type');

export const MediaAttachmentSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['image', 'audio', 'video', 'document', 'sticker']),
  mimeType: z.string(),
  url: z.string().url().optional(),
  filename: z.string().optional(),
  size: z.number().int().optional(),
  duration: z.number().optional()
    .describe('Duration in seconds (audio/video)'),
  dimensions: z.object({
    width: z.number().int(),
    height: z.number().int(),
  }).optional(),
  thumbnail: z.string().url().optional(),
}).describe('Media attachment');

export const MessageContentSchema = z.object({
  type: ContentTypeSchema,
  text: z.string().optional(),
  media: z.array(MediaAttachmentSchema).optional(),
  reaction: z.object({
    emoji: z.string(),
    targetMessageId: z.string(),
  }).optional(),
  poll: z.object({
    question: z.string(),
    options: z.array(z.string()),
    selectedOptions: z.array(z.string()).optional(),
  }).optional(),
  location: z.object({
    latitude: z.number(),
    longitude: z.number(),
    name: z.string().optional(),
    address: z.string().optional(),
  }).optional(),
  contact: z.object({
    name: z.string(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
  }).optional(),
}).describe('Message content');

// ============================================================
// SEND MESSAGE SCHEMAS
// ============================================================

export const SendTextMessageSchema = z.object({
  instanceId: z.string().uuid(),
  to: z.string()
    .describe('Recipient ID (phone number, Discord user ID, etc.)'),
  text: z.string().min(1).max(65536),
  replyTo: z.string().optional()
    .describe('Message ID to reply to'),
}).describe('Send text message request');

export const SendMediaMessageSchema = z.object({
  instanceId: z.string().uuid(),
  to: z.string(),
  type: z.enum(['image', 'audio', 'video', 'document']),
  url: z.string().url().optional()
    .describe('Media URL (provide url OR base64)'),
  base64: z.string().optional()
    .describe('Base64 encoded media (provide url OR base64)'),
  filename: z.string().optional(),
  caption: z.string().optional(),
  voiceNote: z.boolean().optional()
    .describe('Send audio as voice note (WhatsApp)'),
}).describe('Send media message request');

export const SendReactionSchema = z.object({
  instanceId: z.string().uuid(),
  to: z.string(),
  messageId: z.string()
    .describe('Message ID to react to'),
  emoji: z.string()
    .describe('Reaction emoji'),
}).describe('Send reaction request');

export const SendLocationSchema = z.object({
  instanceId: z.string().uuid(),
  to: z.string(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().optional(),
  address: z.string().optional(),
}).describe('Send location request');

export const SendContactSchema = z.object({
  instanceId: z.string().uuid(),
  to: z.string(),
  contact: z.object({
    name: z.string(),
    phone: z.string().optional(),
    email: z.string().email().optional(),
    organization: z.string().optional(),
  }),
}).describe('Send contact card request');

// ============================================================
// RESPONSE SCHEMAS
// ============================================================

export const MessageResultSchema = z.object({
  messageId: z.string().uuid()
    .describe('Omni internal message ID'),
  externalMessageId: z.string()
    .describe('Platform message ID'),
  status: z.enum(['pending', 'sent', 'delivered', 'read', 'failed']),
  timestamp: z.string().datetime(),
}).describe('Message send result');

// ============================================================
// TYPE EXPORTS
// ============================================================

export type ContentType = z.infer<typeof ContentTypeSchema>;
export type MediaAttachment = z.infer<typeof MediaAttachmentSchema>;
export type MessageContent = z.infer<typeof MessageContentSchema>;
export type SendTextMessage = z.infer<typeof SendTextMessageSchema>;
export type SendMediaMessage = z.infer<typeof SendMediaMessageSchema>;
export type SendReaction = z.infer<typeof SendReactionSchema>;
export type SendLocation = z.infer<typeof SendLocationSchema>;
export type SendContact = z.infer<typeof SendContactSchema>;
export type MessageResult = z.infer<typeof MessageResultSchema>;
```

```typescript
// packages/core/src/schemas/pagination.ts

import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50)
    .describe('Maximum items to return'),
  cursor: z.string().optional()
    .describe('Cursor for next page'),
}).describe('Pagination parameters');

export const PaginationMetaSchema = z.object({
  cursor: z.string().nullable()
    .describe('Cursor for next page (null if no more)'),
  hasMore: z.boolean()
    .describe('Whether more results exist'),
  total: z.number().int().optional()
    .describe('Total count (if available)'),
}).describe('Pagination metadata');

export function paginatedResponse<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    meta: PaginationMetaSchema,
  });
}

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
```

```typescript
// packages/core/src/schemas/index.ts

// Re-export everything
export * from './instances';
export * from './messages';
export * from './events';
export * from './persons';
export * from './access';
export * from './settings';
export * from './pagination';
export * from './common';
```

## API Route Definition

Routes use schemas directly, OpenAPI spec is auto-generated:

```typescript
// packages/api/src/routes/v2/instances.ts

import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  InstanceSchema,
  CreateInstanceSchema,
  UpdateInstanceSchema,
  ConnectionStatusSchema,
  QrCodeResponseSchema,
  PaginationQuerySchema,
  paginatedResponse,
  ChannelTypeSchema,
  InstanceStatusSchema,
} from '@omni/core/schemas';
import { z } from 'zod';

const app = new OpenAPIHono();

// ============================================================
// ROUTE DEFINITIONS
// ============================================================

const listInstances = createRoute({
  method: 'get',
  path: '/instances',
  tags: ['Instances'],
  summary: 'List all instances',
  description: 'Returns a paginated list of all messaging instances.',
  request: {
    query: PaginationQuerySchema.extend({
      channel: z.array(ChannelTypeSchema).optional()
        .describe('Filter by channel types'),
      status: z.array(InstanceStatusSchema).optional()
        .describe('Filter by status'),
    }),
  },
  responses: {
    200: {
      description: 'Paginated list of instances',
      content: {
        'application/json': {
          schema: paginatedResponse(InstanceSchema),
        },
      },
    },
  },
});

const getInstance = createRoute({
  method: 'get',
  path: '/instances/{id}',
  tags: ['Instances'],
  summary: 'Get instance by ID',
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Instance details',
      content: {
        'application/json': {
          schema: InstanceSchema,
        },
      },
    },
    404: {
      description: 'Instance not found',
    },
  },
});

const createInstance = createRoute({
  method: 'post',
  path: '/instances',
  tags: ['Instances'],
  summary: 'Create a new instance',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateInstanceSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Instance created',
      content: {
        'application/json': {
          schema: InstanceSchema,
        },
      },
    },
    400: {
      description: 'Invalid input',
    },
  },
});

const updateInstance = createRoute({
  method: 'patch',
  path: '/instances/{id}',
  tags: ['Instances'],
  summary: 'Update an instance',
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateInstanceSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Instance updated',
      content: {
        'application/json': {
          schema: InstanceSchema,
        },
      },
    },
  },
});

const deleteInstance = createRoute({
  method: 'delete',
  path: '/instances/{id}',
  tags: ['Instances'],
  summary: 'Delete an instance',
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Instance deleted',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true) }),
        },
      },
    },
  },
});

const getInstanceStatus = createRoute({
  method: 'get',
  path: '/instances/{id}/status',
  tags: ['Instances'],
  summary: 'Get instance connection status',
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Connection status',
      content: {
        'application/json': {
          schema: ConnectionStatusSchema,
        },
      },
    },
  },
});

const getQrCode = createRoute({
  method: 'get',
  path: '/instances/{id}/qr',
  tags: ['Instances'],
  summary: 'Get QR code for WhatsApp connection',
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'QR code',
      content: {
        'application/json': {
          schema: QrCodeResponseSchema,
        },
      },
    },
    400: {
      description: 'Instance is not a WhatsApp instance or already connected',
    },
  },
});

const connectInstance = createRoute({
  method: 'post',
  path: '/instances/{id}/connect',
  tags: ['Instances'],
  summary: 'Connect an instance',
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Connection initiated',
      content: {
        'application/json': {
          schema: ConnectionStatusSchema,
        },
      },
    },
  },
});

const restartInstance = createRoute({
  method: 'post',
  path: '/instances/{id}/restart',
  tags: ['Instances'],
  summary: 'Restart an instance connection',
  request: {
    params: z.object({
      id: z.string().uuid(),
    }),
  },
  responses: {
    200: {
      description: 'Instance restarted',
      content: {
        'application/json': {
          schema: ConnectionStatusSchema,
        },
      },
    },
  },
});

// ============================================================
// ROUTE HANDLERS
// ============================================================

app.openapi(listInstances, async (c) => {
  const query = c.req.valid('query');
  const result = await c.var.services.instances.list(query);
  return c.json(result, 200);
});

app.openapi(getInstance, async (c) => {
  const { id } = c.req.valid('param');
  const instance = await c.var.services.instances.get(id);
  if (!instance) return c.json({ error: 'Not found' }, 404);
  return c.json(instance, 200);
});

app.openapi(createInstance, async (c) => {
  const body = c.req.valid('json');
  const instance = await c.var.services.instances.create(body);
  return c.json(instance, 201);
});

app.openapi(updateInstance, async (c) => {
  const { id } = c.req.valid('param');
  const body = c.req.valid('json');
  const instance = await c.var.services.instances.update(id, body);
  return c.json(instance, 200);
});

app.openapi(deleteInstance, async (c) => {
  const { id } = c.req.valid('param');
  await c.var.services.instances.delete(id);
  return c.json({ success: true }, 200);
});

app.openapi(getInstanceStatus, async (c) => {
  const { id } = c.req.valid('param');
  const status = await c.var.services.instances.getStatus(id);
  return c.json(status, 200);
});

app.openapi(getQrCode, async (c) => {
  const { id } = c.req.valid('param');
  const qr = await c.var.services.instances.getQrCode(id);
  if (!qr) return c.json({ error: 'Not available' }, 400);
  return c.json(qr, 200);
});

app.openapi(connectInstance, async (c) => {
  const { id } = c.req.valid('param');
  const status = await c.var.services.instances.connect(id);
  return c.json(status, 200);
});

app.openapi(restartInstance, async (c) => {
  const { id } = c.req.valid('param');
  const status = await c.var.services.instances.restart(id);
  return c.json(status, 200);
});

export default app;
```

## OpenAPI Export

```typescript
// packages/api/src/openapi.ts

import { OpenAPIHono } from '@hono/zod-openapi';
import { swaggerUI } from '@hono/swagger-ui';

// Import all route modules
import instancesRouter from './routes/v2/instances';
import messagesRouter from './routes/v2/messages';
import eventsRouter from './routes/v2/events';
import personsRouter from './routes/v2/persons';
import accessRouter from './routes/v2/access';
import settingsRouter from './routes/v2/settings';
import servicesRouter from './routes/v2/services';

const app = new OpenAPIHono();

// Mount routes
app.route('/api/v2', instancesRouter);
app.route('/api/v2', messagesRouter);
app.route('/api/v2', eventsRouter);
app.route('/api/v2', personsRouter);
app.route('/api/v2', accessRouter);
app.route('/api/v2', settingsRouter);
app.route('/api/v2', servicesRouter);

// Generate OpenAPI spec
app.doc('/api/v2/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'Omni v2 API',
    version: '2.0.0',
    description: `
# Omni v2 - Universal Event-Driven Omnichannel Platform

The universal translator for AI agents to communicate across any messaging platform.

## Features

- **Multi-Channel** - WhatsApp, Discord, Slack, Telegram, and more
- **Event-Driven** - Real-time events via WebSocket and NATS
- **Identity Graph** - Unified identity across all platforms
- **Media Processing** - Audio transcription, image description
- **LLM-Native** - Built for AI agent consumption

## Authentication

All endpoints require an API key passed in the \`X-API-Key\` header:

\`\`\`
X-API-Key: sk-your-api-key
\`\`\`

## Rate Limits

- 1000 requests per minute per API key
- WebSocket connections limited to 10 per API key
    `.trim(),
    contact: {
      name: 'Omni Support',
      url: 'https://github.com/namastexlabs/omni-v2',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    { url: 'http://localhost:8881', description: 'Development' },
    { url: 'https://api.omni.example.com', description: 'Production' },
  ],
  tags: [
    { name: 'Instances', description: 'Manage messaging instances' },
    { name: 'Messages', description: 'Send and receive messages' },
    { name: 'Events', description: 'Query event history' },
    { name: 'Persons', description: 'Identity management' },
    { name: 'Access', description: 'Access control rules' },
    { name: 'Settings', description: 'Global settings' },
    { name: 'Services', description: 'Service management' },
  ],
  security: [
    { apiKey: [] },
  ],
  components: {
    securitySchemes: {
      apiKey: {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
        description: 'API key for authentication',
      },
    },
  },
});

// Swagger UI
app.get('/api/v2/docs', swaggerUI({ url: '/api/v2/openapi.json' }));

// Export for static generation
export async function generateOpenAPISpec(): Promise<string> {
  const spec = app.getOpenAPIDocument({
    openapi: '3.1.0',
    info: { title: 'Omni v2 API', version: '2.0.0' },
  });
  return JSON.stringify(spec, null, 2);
}

export default app;
```

## SDK Generation Scripts

```typescript
// scripts/generate-sdk.ts

import { $ } from 'bun';
import { generateOpenAPISpec } from '../packages/api/src/openapi';
import { writeFileSync, mkdirSync } from 'fs';

async function main() {
  console.log('🔧 Generating OpenAPI spec...');

  // Generate spec from code (no server needed)
  const spec = await generateOpenAPISpec();
  mkdirSync('dist', { recursive: true });
  writeFileSync('dist/openapi.json', spec);
  console.log('✅ OpenAPI spec generated: dist/openapi.json');

  console.log('🔧 Generating TypeScript types...');
  await $`bunx openapi-typescript dist/openapi.json -o packages/sdk/src/types.generated.ts`;
  console.log('✅ TypeScript types generated');

  console.log('🔧 Generating TypeScript client...');
  // openapi-fetch generates a type-safe client
  await $`bunx openapi-typescript dist/openapi.json -o packages/sdk/src/client.generated.ts --export-type`;
  console.log('✅ TypeScript client generated');

  console.log('✨ SDK generation complete!');
}

main().catch(console.error);
```

```bash
#!/bin/bash
# scripts/generate-all-sdks.sh

set -e

echo "🔧 Generating all SDKs..."

# Ensure OpenAPI spec exists
if [ ! -f "dist/openapi.json" ]; then
  bun run scripts/generate-sdk.ts
fi

# TypeScript (already done by generate-sdk.ts)
echo "✅ TypeScript SDK ready"

# Python
echo "🐍 Generating Python SDK..."
bunx @openapitools/openapi-generator-cli generate \
  -i dist/openapi.json \
  -g python \
  -o sdks/python \
  --additional-properties=packageName=omni,projectName=omni-sdk,packageVersion=2.0.0 \
  --skip-validate-spec

echo "✅ Python SDK generated: sdks/python"

# Go
echo "🐹 Generating Go SDK..."
bunx @openapitools/openapi-generator-cli generate \
  -i dist/openapi.json \
  -g go \
  -o sdks/go \
  --additional-properties=packageName=omni,packageVersion=2.0.0 \
  --skip-validate-spec

echo "✅ Go SDK generated: sdks/go"

# Ruby
echo "💎 Generating Ruby SDK..."
bunx @openapitools/openapi-generator-cli generate \
  -i dist/openapi.json \
  -g ruby \
  -o sdks/ruby \
  --additional-properties=gemName=omni,gemVersion=2.0.0 \
  --skip-validate-spec

echo "✅ Ruby SDK generated: sdks/ruby"

echo "✨ All SDKs generated!"
```

## TypeScript SDK Wrapper

The generated code is wrapped with a nice developer experience:

```typescript
// packages/sdk/src/index.ts

import createClient, { type Middleware } from 'openapi-fetch';
import type { paths, components } from './types.generated';

// Re-export types for consumers
export type Instance = components['schemas']['Instance'];
export type CreateInstance = components['schemas']['CreateInstance'];
export type UpdateInstance = components['schemas']['UpdateInstance'];
export type ConnectionStatus = components['schemas']['ConnectionStatus'];
export type Message = components['schemas']['Message'];
export type Event = components['schemas']['Event'];
export type Person = components['schemas']['Person'];
export type AccessRule = components['schemas']['AccessRule'];
// ... etc

export interface OmniClientConfig {
  baseUrl: string;
  apiKey: string;
  timeout?: number;
  onError?: (error: Error) => void;
}

export function createOmniClient(config: OmniClientConfig) {
  const authMiddleware: Middleware = {
    async onRequest({ request }) {
      request.headers.set('X-API-Key', config.apiKey);
      return request;
    },
  };

  const client = createClient<paths>({
    baseUrl: config.baseUrl,
  });

  client.use(authMiddleware);

  return {
    // ============================================================
    // INSTANCES
    // ============================================================
    instances: {
      list: async (params?: {
        channel?: string[];
        status?: string[];
        limit?: number;
        cursor?: string;
      }) => {
        const { data, error } = await client.GET('/api/v2/instances', {
          params: { query: params },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      get: async (id: string) => {
        const { data, error } = await client.GET('/api/v2/instances/{id}', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      create: async (data: CreateInstance) => {
        const { data: result, error } = await client.POST('/api/v2/instances', {
          body: data,
        });
        if (error) throw new Error(error.message);
        return result;
      },

      update: async (id: string, data: UpdateInstance) => {
        const { data: result, error } = await client.PATCH('/api/v2/instances/{id}', {
          params: { path: { id } },
          body: data,
        });
        if (error) throw new Error(error.message);
        return result;
      },

      delete: async (id: string) => {
        const { error } = await client.DELETE('/api/v2/instances/{id}', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
      },

      getStatus: async (id: string) => {
        const { data, error } = await client.GET('/api/v2/instances/{id}/status', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      getQrCode: async (id: string) => {
        const { data, error } = await client.GET('/api/v2/instances/{id}/qr', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      connect: async (id: string) => {
        const { data, error } = await client.POST('/api/v2/instances/{id}/connect', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      restart: async (id: string) => {
        const { data, error } = await client.POST('/api/v2/instances/{id}/restart', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
        return data;
      },
    },

    // ============================================================
    // MESSAGES
    // ============================================================
    messages: {
      send: async (data: { instanceId: string; to: string; text: string; replyTo?: string }) => {
        const { data: result, error } = await client.POST('/api/v2/messages', {
          body: data,
        });
        if (error) throw new Error(error.message);
        return result;
      },

      sendMedia: async (data: {
        instanceId: string;
        to: string;
        type: 'image' | 'audio' | 'video' | 'document';
        url?: string;
        base64?: string;
        caption?: string;
      }) => {
        const { data: result, error } = await client.POST('/api/v2/messages/media', {
          body: data,
        });
        if (error) throw new Error(error.message);
        return result;
      },

      // ... more methods
    },

    // ============================================================
    // EVENTS
    // ============================================================
    events: {
      list: async (params?: {
        instanceId?: string;
        personId?: string;
        eventType?: string[];
        since?: string;
        until?: string;
        limit?: number;
        cursor?: string;
      }) => {
        const { data, error } = await client.GET('/api/v2/events', {
          params: { query: params },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      get: async (id: string) => {
        const { data, error } = await client.GET('/api/v2/events/{id}', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      timeline: async (personId: string, params?: { channels?: string[]; since?: string; limit?: number }) => {
        const { data, error } = await client.GET('/api/v2/events/timeline/{personId}', {
          params: { path: { personId }, query: params },
        });
        if (error) throw new Error(error.message);
        return data;
      },
    },

    // ============================================================
    // PERSONS
    // ============================================================
    persons: {
      search: async (query: string, limit?: number) => {
        const { data, error } = await client.GET('/api/v2/persons', {
          params: { query: { search: query, limit } },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      get: async (id: string) => {
        const { data, error } = await client.GET('/api/v2/persons/{id}', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
        return data;
      },

      getPresence: async (id: string) => {
        const { data, error } = await client.GET('/api/v2/persons/{id}/presence', {
          params: { path: { id } },
        });
        if (error) throw new Error(error.message);
        return data;
      },
    },

    // Raw client for advanced usage
    raw: client,
  };
}

// Default export
export default createOmniClient;
```

## Usage Examples

### TypeScript SDK

```typescript
import { createOmniClient } from '@omni/sdk';

const omni = createOmniClient({
  baseUrl: 'http://localhost:8881',
  apiKey: 'sk-your-api-key',
});

// Full type safety and autocomplete!
const instances = await omni.instances.list({ channel: ['whatsapp-baileys'] });

for (const instance of instances.items) {
  console.log(instance.name, instance.status);
}

// Send a message
await omni.messages.send({
  instanceId: instances.items[0].id,
  to: '+1234567890',
  text: 'Hello from the SDK!',
});

// Get person timeline across all channels
const timeline = await omni.events.timeline('person-uuid', {
  channels: ['whatsapp-baileys', 'discord'],
  since: '2025-01-01',
});
```

### Python SDK (Auto-Generated)

```python
from omni import OmniApi, Configuration

config = Configuration(
    host="http://localhost:8881",
    api_key={"apiKey": "sk-your-api-key"}
)

api = OmniApi(config)

# List instances
instances = api.instances_api.list_instances(channel=["whatsapp-baileys"])

for instance in instances.items:
    print(f"{instance.name}: {instance.status}")

# Send message
result = api.messages_api.send_message({
    "instanceId": instances.items[0].id,
    "to": "+1234567890",
    "text": "Hello from Python!"
})
```

## Build Pipeline

```json
// package.json
{
  "scripts": {
    "build": "turbo run build",

    "generate:openapi": "bun run scripts/generate-sdk.ts",
    "generate:sdk": "bun run scripts/generate-sdk.ts",
    "generate:sdk:all": "bash scripts/generate-all-sdks.sh",

    "prepublish:sdk": "bun run generate:sdk",

    "docs:serve": "bun run --hot packages/api/src/index.ts",
    "docs:open": "open http://localhost:8881/api/v2/docs"
  }
}
```

## CI/CD Integration

```yaml
# .github/workflows/sdk.yml

name: Generate SDKs

on:
  push:
    paths:
      - 'packages/core/src/schemas/**'
      - 'packages/api/src/routes/**'
    branches: [main]

jobs:
  generate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1

      - run: bun install

      - run: bun run generate:sdk:all

      - name: Commit generated SDKs
        run: |
          git config user.name "GitHub Actions"
          git config user.email "actions@github.com"
          git add packages/sdk/src/*.generated.ts sdks/
          git commit -m "chore: regenerate SDKs" || exit 0
          git push

  publish-ts:
    needs: generate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: cd packages/sdk && bun publish --access public
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}

  publish-python:
    needs: generate
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v4
      - run: |
          cd sdks/python
          pip install build twine
          python -m build
          twine upload dist/*
        env:
          TWINE_USERNAME: __token__
          TWINE_PASSWORD: ${{ secrets.PYPI_TOKEN }}
```

## Summary

| What You Maintain | What's Auto-Generated |
|-------------------|----------------------|
| `packages/core/src/schemas/*.ts` (Zod schemas) | OpenAPI spec |
| Route definitions with `createRoute()` | TypeScript types |
| | TypeScript SDK |
| | Python SDK |
| | Go SDK |
| | API documentation (Swagger UI) |

**Change a schema → Everything updates automatically.**
