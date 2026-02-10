---
title: "Internal API Reference"
created: 2025-01-29
updated: 2026-02-09
tags: [api, internal]
status: current
---

# Internal API Reference

> Localhost-only endpoints for service-to-service communication. These endpoints have **no authentication** and are restricted to localhost access only.

> Related: [[endpoints|API Endpoints]], [[design|API Design]]

## Security Model

Internal APIs are protected by:
1. **Localhost restriction** - Only requests from 127.0.0.1 or ::1 are accepted
2. **No external exposure** - These paths are not proxied by any reverse proxy
3. **Process isolation** - Only trusted internal processes should call these

```typescript
// packages/api/src/middleware/internal.ts

export function internalOnly() {
  return async (c: Context, next: Next) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
      ?? c.req.header('x-real-ip')
      ?? c.req.raw.socket?.remoteAddress;

    const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'].includes(ip ?? '');

    if (!isLocalhost) {
      return c.json({ error: 'Internal endpoint - localhost only' }, 403);
    }

    await next();
  };
}
```

---

## Subprocess Configuration

Used by the gateway process to start and configure subprocess services (e.g., channel handlers, media processors).

### GET /api/v2/_internal/subprocess-config

Returns configuration needed to start subprocess services.

**Response:**
```typescript
interface SubprocessConfig {
  // Database connection
  database: {
    connectionUri: string;    // PostgreSQL connection string
    provider: 'postgresql';
    maxConnections: number;   // Connection pool size
  };

  // NATS JetStream
  nats: {
    url: string;              // e.g., "nats://localhost:4222"
    user?: string;
    password?: string;
    tls: boolean;
  };

  // Authentication
  auth: {
    internalApiKey: string;   // Shared key for internal service auth
  };

  // Logging
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    format: 'json' | 'pretty';
  };

  // Paths
  paths: {
    dataDir: string;          // e.g., "./data"
    authDir: string;          // e.g., "./data/auth"
    mediaDir: string;         // e.g., "./data/media"
    logsDir: string;          // e.g., "./logs"
  };

  // Feature flags
  features: {
    mediaProcessing: boolean;
    agentRouting: boolean;
    accessControl: boolean;
  };
}
```

**Example Response:**
```json
{
  "database": {
    "connectionUri": "postgresql://omni:secret@localhost:5432/omni",
    "provider": "postgresql",
    "maxConnections": 20
  },
  "nats": {
    "url": "nats://localhost:4222",
    "tls": false
  },
  "auth": {
    "internalApiKey": "internal_sk_abc123..."
  },
  "logging": {
    "level": "info",
    "format": "json"
  },
  "paths": {
    "dataDir": "/app/data",
    "authDir": "/app/data/auth",
    "mediaDir": "/app/data/media",
    "logsDir": "/app/logs"
  },
  "features": {
    "mediaProcessing": true,
    "agentRouting": true,
    "accessControl": true
  }
}
```

---

## Channel Startup Information

Determines which channel services need to start and which instances to auto-connect.

### GET /api/v2/_internal/channel-startup-info

Returns startup requirements for channel services.

**Response:**
```typescript
interface ChannelStartupInfo {
  channels: {
    name: string;           // Channel ID (e.g., "whatsapp-baileys", "discord")
    needed: boolean;        // Should this channel service start?
    reason?: string;        // Why it's needed (or not)
    instances: string[];    // Instance IDs to auto-connect on startup
    config?: {
      // Channel-specific startup config
      [key: string]: unknown;
    };
  }[];

  // Global startup options
  startup: {
    delayBetweenChannelsMs: number;  // Stagger channel startup
    maxConcurrentConnections: number; // Limit simultaneous connections
    healthCheckTimeoutMs: number;     // Wait for health check
  };
}
```

**Example Response:**
```json
{
  "channels": [
    {
      "name": "whatsapp-baileys",
      "needed": true,
      "reason": "3 active WhatsApp instances configured",
      "instances": [
        "wa-main",
        "wa-support",
        "wa-sales"
      ],
      "config": {
        "authPath": "/app/data/auth/whatsapp"
      }
    },
    {
      "name": "discord",
      "needed": true,
      "reason": "1 active Discord instance configured",
      "instances": [
        "discord-bot-1"
      ],
      "config": {
        "shardCount": 1
      }
    },
    {
      "name": "slack",
      "needed": false,
      "reason": "No active Slack instances",
      "instances": []
    },
    {
      "name": "telegram",
      "needed": false,
      "reason": "No active Telegram instances",
      "instances": []
    }
  ],
  "startup": {
    "delayBetweenChannelsMs": 2000,
    "maxConcurrentConnections": 5,
    "healthCheckTimeoutMs": 30000
  }
}
```

---

## Health Check (Internal)

Simple health check for internal monitoring without authentication overhead.

### GET /api/v2/_internal/health

**Response:**
```typescript
interface InternalHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  service: string;
  timestamp: string;
  uptime: number;          // Seconds
  memory: {
    used: number;          // Bytes
    total: number;
    percentage: number;
  };
  checks: {
    database: boolean;
    nats: boolean;
    channels: Record<string, boolean>;
  };
}
```

**Example Response:**
```json
{
  "status": "healthy",
  "service": "omni-api",
  "timestamp": "2025-01-29T12:00:00Z",
  "uptime": 86400,
  "memory": {
    "used": 134217728,
    "total": 536870912,
    "percentage": 25
  },
  "checks": {
    "database": true,
    "nats": true,
    "channels": {
      "whatsapp-baileys": true,
      "discord": true
    }
  }
}
```

---

## Setup Status (Internal)

Check if initial setup is required. Used during bootstrap to determine if the onboarding wizard should be shown.

### GET /api/v2/_internal/setup/status

**Response:**
```typescript
interface SetupStatus {
  setupRequired: boolean;     // True if setup wizard should run
  setupCompleted: boolean;    // True if setup was completed previously
  bootstrapMode: boolean;     // True if in first-run mode

  checks: {
    databaseConnected: boolean;
    natsConnected: boolean;
    apiKeyExists: boolean;
    instancesExist: boolean;
    settingsInitialized: boolean;
  };

  // If setup is required, suggested next step
  suggestedStep?: 'database' | 'api_keys' | 'first_instance' | 'complete';
}
```

**Example Response (First Run):**
```json
{
  "setupRequired": true,
  "setupCompleted": false,
  "bootstrapMode": true,
  "checks": {
    "databaseConnected": true,
    "natsConnected": true,
    "apiKeyExists": false,
    "instancesExist": false,
    "settingsInitialized": false
  },
  "suggestedStep": "api_keys"
}
```

---

## Register Service

Called by channel services when they start to register themselves with the API.

### POST /api/v2/_internal/services/register

**Request:**
```typescript
interface ServiceRegistration {
  name: string;           // Service identifier
  type: 'channel' | 'processor' | 'worker';
  pid: number;
  port?: number;          // If the service exposes an HTTP port
  healthEndpoint?: string; // URL for health checks

  capabilities?: {
    channels?: string[];   // For channel services
    mediaTypes?: string[]; // For processors
  };

  metadata?: Record<string, unknown>;
}
```

**Response:**
```typescript
interface RegistrationResult {
  success: boolean;
  serviceId: string;        // Assigned service ID
  heartbeatIntervalMs: number;  // How often to send heartbeat
}
```

### POST /api/v2/_internal/services/heartbeat

**Request:**
```typescript
interface ServiceHeartbeat {
  serviceId: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  metrics?: {
    cpu: number;
    memory: number;
    activeConnections?: number;
    messagesProcessed?: number;
  };
}
```

**Response:**
```typescript
interface HeartbeatResponse {
  acknowledged: boolean;
  commands?: Array<{
    type: 'shutdown' | 'restart' | 'scale';
    data?: unknown;
  }>;
}
```

### POST /api/v2/_internal/services/deregister

**Request:**
```typescript
interface ServiceDeregistration {
  serviceId: string;
  reason?: string;
}
```

---

## Event Forwarding (Internal)

Forward events between services without going through NATS (for tight coupling scenarios).

### POST /api/v2/_internal/events/forward

**Request:**
```typescript
interface EventForward {
  event: OmniEvent;
  targetService?: string;  // Specific service, or broadcast if omitted
  priority?: 'high' | 'normal' | 'low';
}
```

**Response:**
```typescript
interface ForwardResult {
  accepted: boolean;
  eventId: string;
  deliveredTo?: string[];
}
```

---

## Implementation Notes

### Gateway Integration

The gateway process uses these endpoints during startup:

```typescript
// gateway/src/startup.ts

async function startChannelServices() {
  // 1. Get subprocess config
  const config = await fetch('http://localhost:8882/api/v2/_internal/subprocess-config')
    .then(r => r.json());

  // 2. Get channel startup info
  const channels = await fetch('http://localhost:8882/api/v2/_internal/channel-startup-info')
    .then(r => r.json());

  // 3. Start each needed channel
  for (const channel of channels.channels.filter(c => c.needed)) {
    await startChannelService(channel, config);
    await sleep(channels.startup.delayBetweenChannelsMs);
  }
}

async function startChannelService(channel: ChannelInfo, config: SubprocessConfig) {
  const env = {
    DATABASE_URL: config.database.connectionUri,
    NATS_URL: config.nats.url,
    INTERNAL_API_KEY: config.auth.internalApiKey,
    LOG_LEVEL: config.logging.level,
    AUTH_PATH: config.paths.authDir,
    INSTANCES: channel.instances.join(','),
  };

  // Spawn the channel process
  const proc = spawn(`bun run channel-${channel.name}`, { env });

  // Register it
  await fetch('http://localhost:8882/api/v2/_internal/services/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: channel.name,
      type: 'channel',
      pid: proc.pid,
      capabilities: { channels: [channel.name] },
    }),
  });
}
```

### Error Handling

Internal endpoints should never expose sensitive error details:

```typescript
app.onError((err, c) => {
  // Log full error internally
  console.error('Internal API error:', err);

  // Return generic error to caller
  return c.json({
    error: 'Internal error',
    code: 'INTERNAL_ERROR',
  }, 500);
});
```

---

## Migration from v1

### Removed Endpoints

These v1 internal endpoints are no longer needed:

| v1 Endpoint | Status | Reason |
|-------------|--------|--------|
| `GET /_internal/evolution-key` | Removed | No Evolution API in v2 |
| `GET /api/recovery/api-key` | Removed | Use CLI: `bun run cli settings api-key --regenerate` |

### Changed Endpoints

| v1 Endpoint | v2 Endpoint | Change |
|-------------|-------------|--------|
| `GET /_internal/subprocess-config` | `GET /api/v2/_internal/subprocess-config` | Expanded config structure |
| `GET /_internal/channel-startup-info` | `GET /api/v2/_internal/channel-startup-info` | New format with reasons |
| `GET /_internal/health` | `GET /api/v2/_internal/health` | Added memory/uptime |
