# Agent Provider System

> A flexible, multi-schema provider system that enables Omni to communicate with any AI agent backend.

## Overview

Omni is a **communications platform for AI agents**. The provider system is the bridge between messaging channels and agent backends. It must support:

1. **Multiple API Schemas** - OpenAI, Anthropic, Agno, and custom schemas
2. **Streaming & Non-Streaming** - Real-time responses for better UX
3. **Multi-Modal Input** - Text, images, audio, documents
4. **Session Management** - Conversation continuity across messages
5. **Generic Configuration** - Users can define custom schemas

## Provider Schemas

### Schema Comparison

| Feature | OpenAI | Anthropic | Agno | Custom |
|---------|--------|-----------|------|--------|
| Endpoint | `/v1/chat/completions` | `/v1/messages` | `/agents/{id}/runs` | Configurable |
| Auth Header | `Authorization: Bearer` | `x-api-key` | `X-API-Key` | Configurable |
| Request Format | `messages[]` array | `messages[]` array | form-data or JSON | Template-based |
| Streaming | SSE `data:` lines | SSE `event:` blocks | SSE or newline JSON | Configurable |
| Session | External (client-managed) | External | Built-in `session_id` | Configurable |
| Multi-Modal | `content[]` with `image_url` | `content[]` with `source` | `media_contents[]` | Template-based |

### 1. OpenAI-Compatible Schema

Used by: OpenAI, Azure OpenAI, Together AI, Groq (chat), Ollama, vLLM, LocalAI

```typescript
interface OpenAIProviderConfig {
  schema: 'openai';
  baseUrl: string;            // e.g., "https://api.openai.com/v1"
  apiKey: string;
  model: string;              // e.g., "gpt-4o"
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

// Request format
interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string | Array<{
      type: 'text' | 'image_url';
      text?: string;
      image_url?: { url: string };
    }>;
  }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

// Response format (non-streaming)
interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Streaming format
// data: {"id":"...","choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}
// data: [DONE]
```

### 2. Anthropic-Compatible Schema

Used by: Anthropic Claude, Amazon Bedrock (Claude)

```typescript
interface AnthropicProviderConfig {
  schema: 'anthropic';
  baseUrl: string;            // e.g., "https://api.anthropic.com"
  apiKey: string;
  model: string;              // e.g., "claude-sonnet-4-20250514"
  systemPrompt?: string;
  maxTokens?: number;
  stream?: boolean;
}

// Request format
interface AnthropicRequest {
  model: string;
  max_tokens: number;
  system?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | Array<{
      type: 'text' | 'image';
      text?: string;
      source?: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    }>;
  }>;
  stream?: boolean;
}

// Response format (non-streaming)
interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: Array<{
    type: 'text';
    text: string;
  }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// Streaming format
// event: content_block_delta
// data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}
// event: message_stop
// data: {"type":"message_stop"}
```

### 3. Agno Schema (Current v1)

Used by: Automagik Agents, Agno Platform

```typescript
interface AgnoProviderConfig {
  schema: 'agno';
  baseUrl: string;
  apiKey: string;
  agentId?: string;           // For agent runs
  teamId?: string;            // For team runs
  stream?: boolean;
  timeout?: number;
}

// Request format (form-data)
interface AgnoRequest {
  message: string;
  stream: boolean;
  user_id?: string;
  session_id?: string;
}

// Response format (non-streaming)
interface AgnoResponse {
  content: string;
  run_id: string;
  session_id?: string;
}

// Streaming format (newline-delimited JSON)
// {"event":"RunStarted","run_id":"..."}
// {"event":"RunResponseContent","content":"Hello"}
// {"event":"RunCompleted","run_id":"..."}
```

### 4. Custom Schema

For any API that doesn't fit the standard schemas.

```typescript
interface CustomProviderConfig {
  schema: 'custom';
  baseUrl: string;
  apiKey?: string;
  authHeader?: string;        // e.g., "Authorization: Bearer {{apiKey}}"
  authType?: 'bearer' | 'api-key' | 'custom' | 'none';

  // Request configuration
  requestMethod: 'POST' | 'GET';
  requestPath: string;        // e.g., "/api/chat"
  requestContentType: 'application/json' | 'multipart/form-data';
  requestTemplate: string;    // JSON template with {{placeholders}}

  // Response configuration
  responseFormat: 'json' | 'sse' | 'text';
  responseContentPath: string;  // JSONPath to content, e.g., "$.response.text"
  responseStreamPath?: string;  // For SSE: path to delta content

  // Session handling
  sessionMode: 'header' | 'body' | 'query' | 'none';
  sessionParamName?: string;

  // Multimodal support
  supportsImages?: boolean;
  supportsAudio?: boolean;
  imageFormat?: 'url' | 'base64';
  imagePath?: string;         // Where to put images in request
}

// Example: Custom webhook-based agent
const customWebhookProvider: CustomProviderConfig = {
  schema: 'custom',
  baseUrl: 'https://my-agent.example.com',
  authHeader: 'X-Webhook-Secret: {{apiKey}}',
  authType: 'custom',

  requestMethod: 'POST',
  requestPath: '/webhook/chat',
  requestContentType: 'application/json',
  requestTemplate: JSON.stringify({
    query: '{{message}}',
    conversation_id: '{{sessionId}}',
    user: {
      id: '{{userId}}',
      phone: '{{userPhone}}'
    },
    attachments: '{{mediaContents}}'
  }),

  responseFormat: 'json',
  responseContentPath: '$.answer.text',

  sessionMode: 'body',
  sessionParamName: 'conversation_id',

  supportsImages: true,
  imageFormat: 'url',
  imagePath: '$.attachments'
};
```

## Database Schema

### Provider Table

```typescript
// packages/db/src/schema.ts

export const providerSchemas = [
  'openai',
  'anthropic',
  'agno',
  'custom'
] as const;
export type ProviderSchema = (typeof providerSchemas)[number];

export const agentProviders = pgTable('agent_providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull().unique(),

  // Schema type determines how to communicate
  schema: varchar('schema', { length: 20 }).notNull().$type<ProviderSchema>(),

  // Connection settings
  baseUrl: text('base_url').notNull(),
  apiKey: text('api_key'),

  // Schema-specific configuration (JSON)
  // For OpenAI: { model, systemPrompt, maxTokens, temperature }
  // For Anthropic: { model, systemPrompt, maxTokens }
  // For Agno: { agentId, teamId, timeout }
  // For Custom: { full CustomProviderConfig }
  schemaConfig: jsonb('schema_config').$type<Record<string, unknown>>(),

  // Default settings
  defaultStream: boolean('default_stream').notNull().default(true),
  defaultTimeout: integer('default_timeout').notNull().default(60),

  // Capabilities (auto-detected or manually set)
  supportsStreaming: boolean('supports_streaming').notNull().default(true),
  supportsImages: boolean('supports_images').notNull().default(false),
  supportsAudio: boolean('supports_audio').notNull().default(false),
  supportsDocuments: boolean('supports_documents').notNull().default(false),

  // Health tracking
  isActive: boolean('is_active').notNull().default(true),
  lastHealthCheck: timestamp('last_health_check'),
  lastHealthStatus: varchar('last_health_status', { length: 20 }),
  lastHealthError: text('last_health_error'),

  // Metadata
  description: text('description'),
  tags: text('tags').array(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

## Provider Service Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ProviderService                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐    ┌─────────────────────────────────────────────┐    │
│  │   Instance  │───►│              ProviderRouter                  │    │
│  │   Config    │    │  - Resolves provider from instance config    │    │
│  └─────────────┘    │  - Falls back to default provider            │    │
│                     └──────────────────┬──────────────────────────┘    │
│                                        │                                │
│                                        ▼                                │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    ProviderClientFactory                         │   │
│  │  Creates appropriate client based on schema type                 │   │
│  └────────┬─────────────┬─────────────┬────────────┬───────────────┘   │
│           │             │             │            │                    │
│           ▼             ▼             ▼            ▼                    │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐          │
│  │  OpenAI    │ │ Anthropic  │ │   Agno     │ │  Custom    │          │
│  │  Client    │ │  Client    │ │  Client    │ │  Client    │          │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘          │
│        │             │             │            │                       │
│        └─────────────┴─────────────┴────────────┘                       │
│                             │                                           │
│                             ▼                                           │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                   Unified Response                               │   │
│  │  {                                                               │   │
│  │    content: string,                                              │   │
│  │    usage?: { inputTokens, outputTokens },                        │   │
│  │    metadata?: { runId, sessionId, ... }                          │   │
│  │  }                                                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Implementation

### Base Provider Client

```typescript
// packages/core/src/providers/base-client.ts

export interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  images?: Array<{
    url?: string;
    base64?: string;
    mimeType: string;
  }>;
}

export interface ProviderRequest {
  messages: ProviderMessage[];
  stream?: boolean;
  sessionId?: string;
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface ProviderResponse {
  content: string;
  finishReason?: 'stop' | 'length' | 'tool_calls' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  metadata?: {
    runId?: string;
    sessionId?: string;
    model?: string;
  };
}

export interface StreamChunk {
  content: string;
  isComplete: boolean;
  metadata?: Record<string, unknown>;
}

export abstract class BaseProviderClient {
  constructor(
    protected config: AgentProvider,
    protected eventBus: EventBus
  ) {}

  abstract send(request: ProviderRequest): Promise<ProviderResponse>;
  abstract sendStream(request: ProviderRequest): AsyncGenerator<StreamChunk>;
  abstract healthCheck(): Promise<boolean>;

  // Convert internal format to provider-specific format
  protected abstract formatRequest(request: ProviderRequest): unknown;

  // Convert provider response to internal format
  protected abstract parseResponse(response: unknown): ProviderResponse;
}
```

### OpenAI Client

```typescript
// packages/core/src/providers/openai-client.ts

export class OpenAIClient extends BaseProviderClient {
  private httpClient: HttpClient;

  constructor(config: AgentProvider, eventBus: EventBus) {
    super(config, eventBus);
    this.httpClient = new HttpClient({
      baseUrl: config.baseUrl,
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
  }

  async send(request: ProviderRequest): Promise<ProviderResponse> {
    const formatted = this.formatRequest(request);
    const response = await this.httpClient.post('/chat/completions', formatted);
    return this.parseResponse(response);
  }

  async *sendStream(request: ProviderRequest): AsyncGenerator<StreamChunk> {
    const formatted = this.formatRequest({ ...request, stream: true });

    for await (const chunk of this.httpClient.postSSE('/chat/completions', formatted)) {
      if (chunk.data === '[DONE]') {
        yield { content: '', isComplete: true };
        return;
      }

      const parsed = JSON.parse(chunk.data);
      const delta = parsed.choices?.[0]?.delta?.content || '';
      yield { content: delta, isComplete: false };
    }
  }

  protected formatRequest(request: ProviderRequest): OpenAIRequest {
    const schemaConfig = this.config.schemaConfig as OpenAISchemaConfig;

    const messages: OpenAIMessage[] = [];

    // Add system prompt if configured
    if (schemaConfig?.systemPrompt) {
      messages.push({
        role: 'system',
        content: schemaConfig.systemPrompt,
      });
    }

    // Convert messages
    for (const msg of request.messages) {
      if (msg.images?.length) {
        // Multi-modal message
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: [
            { type: 'text', text: msg.content },
            ...msg.images.map(img => ({
              type: 'image_url' as const,
              image_url: { url: img.url || `data:${img.mimeType};base64,${img.base64}` },
            })),
          ],
        });
      } else {
        messages.push({
          role: msg.role as 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    return {
      model: schemaConfig?.model || 'gpt-4o',
      messages,
      stream: request.stream,
      max_tokens: schemaConfig?.maxTokens,
      temperature: schemaConfig?.temperature,
    };
  }

  protected parseResponse(response: OpenAIAPIResponse): ProviderResponse {
    return {
      content: response.choices[0]?.message?.content || '',
      finishReason: response.choices[0]?.finish_reason as any,
      usage: response.usage ? {
        inputTokens: response.usage.prompt_tokens,
        outputTokens: response.usage.completion_tokens,
        totalTokens: response.usage.total_tokens,
      } : undefined,
      metadata: {
        model: response.model,
      },
    };
  }

  async healthCheck(): Promise<boolean> {
    try {
      // Send a minimal request to check connectivity
      await this.httpClient.get('/models');
      return true;
    } catch {
      return false;
    }
  }
}
```

### Provider Client Factory

```typescript
// packages/core/src/providers/factory.ts

import { OpenAIClient } from './openai-client';
import { AnthropicClient } from './anthropic-client';
import { AgnoClient } from './agno-client';
import { CustomClient } from './custom-client';

export class ProviderClientFactory {
  constructor(private eventBus: EventBus) {}

  create(provider: AgentProvider): BaseProviderClient {
    switch (provider.schema) {
      case 'openai':
        return new OpenAIClient(provider, this.eventBus);
      case 'anthropic':
        return new AnthropicClient(provider, this.eventBus);
      case 'agno':
        return new AgnoClient(provider, this.eventBus);
      case 'custom':
        return new CustomClient(provider, this.eventBus);
      default:
        throw new Error(`Unknown provider schema: ${provider.schema}`);
    }
  }
}
```

### Provider Service

```typescript
// packages/core/src/providers/service.ts

export class ProviderService {
  private factory: ProviderClientFactory;
  private clientCache: Map<string, BaseProviderClient> = new Map();

  constructor(
    private db: Database,
    private eventBus: EventBus
  ) {
    this.factory = new ProviderClientFactory(eventBus);
  }

  async getProviderForInstance(instanceId: string): Promise<BaseProviderClient | null> {
    const instance = await this.db.query.instances.findFirst({
      where: eq(instances.id, instanceId),
      with: { agentProvider: true },
    });

    if (!instance?.agentProvider) {
      return null;
    }

    return this.getClient(instance.agentProvider);
  }

  async getDefaultProvider(): Promise<BaseProviderClient | null> {
    const defaultProvider = await this.db.query.agentProviders.findFirst({
      where: eq(agentProviders.isActive, true),
      orderBy: [asc(agentProviders.createdAt)],
    });

    if (!defaultProvider) {
      return null;
    }

    return this.getClient(defaultProvider);
  }

  private getClient(provider: AgentProvider): BaseProviderClient {
    // Check cache first
    const cached = this.clientCache.get(provider.id);
    if (cached) {
      return cached;
    }

    // Create new client
    const client = this.factory.create(provider);
    this.clientCache.set(provider.id, client);
    return client;
  }

  async sendMessage(
    instanceId: string,
    request: ProviderRequest
  ): Promise<ProviderResponse> {
    const client = await this.getProviderForInstance(instanceId)
      ?? await this.getDefaultProvider();

    if (!client) {
      throw new Error('No provider configured');
    }

    // Emit event before sending
    await this.eventBus.publish({
      type: 'agent.request',
      payload: { instanceId, request },
    });

    const response = await client.send(request);

    // Emit event after receiving response
    await this.eventBus.publish({
      type: 'agent.response',
      payload: { instanceId, response },
    });

    return response;
  }

  async *streamMessage(
    instanceId: string,
    request: ProviderRequest
  ): AsyncGenerator<StreamChunk> {
    const client = await this.getProviderForInstance(instanceId)
      ?? await this.getDefaultProvider();

    if (!client) {
      throw new Error('No provider configured');
    }

    await this.eventBus.publish({
      type: 'agent.stream.start',
      payload: { instanceId, request },
    });

    let fullContent = '';
    for await (const chunk of client.sendStream(request)) {
      fullContent += chunk.content;
      yield chunk;

      if (chunk.isComplete) {
        await this.eventBus.publish({
          type: 'agent.stream.complete',
          payload: { instanceId, content: fullContent },
        });
      }
    }
  }

  // CRUD operations
  async createProvider(data: NewAgentProvider): Promise<AgentProvider> {
    const [provider] = await this.db.insert(agentProviders).values(data).returning();
    this.clientCache.delete(provider.id); // Clear cache
    return provider;
  }

  async updateProvider(id: string, data: Partial<AgentProvider>): Promise<AgentProvider> {
    const [provider] = await this.db
      .update(agentProviders)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(agentProviders.id, id))
      .returning();
    this.clientCache.delete(id); // Clear cache
    return provider;
  }

  async deleteProvider(id: string): Promise<void> {
    await this.db.delete(agentProviders).where(eq(agentProviders.id, id));
    this.clientCache.delete(id);
  }

  async checkHealth(id: string): Promise<{ healthy: boolean; error?: string }> {
    const provider = await this.db.query.agentProviders.findFirst({
      where: eq(agentProviders.id, id),
    });

    if (!provider) {
      return { healthy: false, error: 'Provider not found' };
    }

    const client = this.getClient(provider);

    try {
      const healthy = await client.healthCheck();

      // Update health status
      await this.db
        .update(agentProviders)
        .set({
          lastHealthCheck: new Date(),
          lastHealthStatus: healthy ? 'healthy' : 'unhealthy',
          lastHealthError: healthy ? null : 'Health check failed',
        })
        .where(eq(agentProviders.id, id));

      return { healthy };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      await this.db
        .update(agentProviders)
        .set({
          lastHealthCheck: new Date(),
          lastHealthStatus: 'error',
          lastHealthError: errorMessage,
        })
        .where(eq(agentProviders.id, id));

      return { healthy: false, error: errorMessage };
    }
  }
}
```

## API Endpoints

### Provider Management

```yaml
# List providers
GET /api/v2/providers
Query:
  schema?: 'openai' | 'anthropic' | 'agno' | 'custom'
  active?: boolean
Response:
  providers: Provider[]

# Get provider
GET /api/v2/providers/:id
Response:
  provider: Provider

# Create provider
POST /api/v2/providers
Body:
  name: string
  schema: 'openai' | 'anthropic' | 'agno' | 'custom'
  baseUrl: string
  apiKey?: string
  schemaConfig?: object
  description?: string
Response:
  provider: Provider

# Update provider
PATCH /api/v2/providers/:id
Body:
  name?: string
  baseUrl?: string
  apiKey?: string
  schemaConfig?: object
  isActive?: boolean
Response:
  provider: Provider

# Delete provider
DELETE /api/v2/providers/:id
Response:
  success: true

# Health check
POST /api/v2/providers/:id/health
Response:
  healthy: boolean
  error?: string
  lastCheck: timestamp

# Test provider (send test message)
POST /api/v2/providers/:id/test
Body:
  message: string
Response:
  success: boolean
  response?: string
  latencyMs: number
  error?: string

# List available agents/models from provider
GET /api/v2/providers/:id/models
Response:
  models: Array<{ id: string; name: string }>

# For Agno: list agents
GET /api/v2/providers/:id/agents
Response:
  agents: Array<{ id: string; name: string; description?: string }>

# For Agno: list teams
GET /api/v2/providers/:id/teams
Response:
  teams: Array<{ id: string; name: string; description?: string }>
```

### Schema Definitions Endpoint

Useful for UI to dynamically build configuration forms:

```yaml
# Get schema definitions
GET /api/v2/providers/schemas
Response:
  schemas:
    openai:
      name: "OpenAI Compatible"
      description: "OpenAI, Azure OpenAI, Together AI, Groq, Ollama..."
      configFields:
        - name: model
          type: string
          required: true
          default: "gpt-4o"
          description: "Model identifier"
        - name: systemPrompt
          type: text
          required: false
          description: "System prompt for the model"
        - name: maxTokens
          type: number
          required: false
          default: 4096
        - name: temperature
          type: number
          required: false
          default: 0.7
          min: 0
          max: 2
    anthropic:
      name: "Anthropic Compatible"
      description: "Anthropic Claude, Amazon Bedrock (Claude)..."
      configFields: [...]
    agno:
      name: "Agno Platform"
      description: "Automagik Agents, Agno..."
      configFields:
        - name: agentId
          type: string
          required: false
          description: "Agent ID (for agent runs)"
        - name: teamId
          type: string
          required: false
          description: "Team ID (for team runs)"
    custom:
      name: "Custom Schema"
      description: "Define your own API schema"
      configFields: [...]
```

## UI Integration

### Provider Configuration Form

The UI should:

1. **Show schema selector** - Dropdown with OpenAI/Anthropic/Agno/Custom
2. **Dynamic config fields** - Based on selected schema
3. **Connection test** - Test button to verify configuration
4. **Model/Agent selector** - For Agno, fetch and show available agents

### Instance Provider Selection

When configuring an instance:

1. **Provider dropdown** - Select from configured providers
2. **Override option** - Allow instance-specific overrides
3. **Preview** - Show which schema/model will be used

## Migration from v1

### Provider Migration Script

```typescript
// scripts/migrate-providers.ts

async function migrateProviders() {
  // Get all unique provider configurations from v1 instances
  const v1Instances = await v1Database.query(`
    SELECT DISTINCT
      agent_api_url,
      agent_api_key,
      agent_id,
      agent_type,
      agent_timeout
    FROM omni_instance_configs
    WHERE agent_api_url IS NOT NULL
  `);

  for (const instance of v1Instances) {
    // Detect schema based on URL patterns
    const schema = detectSchema(instance.agent_api_url);

    // Create provider
    await v2Database.insert(agentProviders).values({
      name: generateProviderName(instance.agent_api_url),
      schema,
      baseUrl: instance.agent_api_url,
      apiKey: instance.agent_api_key,
      schemaConfig: buildSchemaConfig(schema, instance),
      defaultTimeout: instance.agent_timeout || 60,
    });
  }
}

function detectSchema(url: string): ProviderSchema {
  if (url.includes('openai.com') || url.includes('/v1/chat')) {
    return 'openai';
  }
  if (url.includes('anthropic.com') || url.includes('/v1/messages')) {
    return 'anthropic';
  }
  if (url.includes('/agents/') || url.includes('/teams/')) {
    return 'agno';
  }
  return 'agno'; // Default to agno for backward compatibility
}
```

## Summary

The provider system enables Omni to:

1. **Connect to any AI backend** - OpenAI, Anthropic, Agno, or custom
2. **Support streaming** - Real-time responses for better UX
3. **Handle multi-modal input** - Text, images, audio, documents
4. **Manage sessions** - Conversation continuity
5. **Scale** - Reusable providers across multiple instances
6. **Extend** - Custom schemas for any API

This architecture makes Omni truly a **universal communications platform for AI agents**.
