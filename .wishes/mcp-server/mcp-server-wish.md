# WISH: MCP Server

**Status:** DRAFT
**Beads:** omni-bsa
**Priority:** P2

## Context

Omni should be accessible to AI assistants (Claude, Cursor, Windsurf, etc.) via the Model Context Protocol (MCP). The MCP server acts as a thin wrapper around the API, similar to how the CLI works.

**V1 Reference:**
- `/home/cezar/dev/omni/src/mcp_tools/genie_omni/` - V1 MCP tools

**V2 CLI Reference:**
- `/home/cezar/dev/omni-v2/packages/cli/` - CLI commands (similar pattern)

## Problem Statement

AI assistants cannot interact with Omni v2 programmatically. They need:
- Tools to send messages
- Tools to read messages/chats
- Tools to manage instances
- Resources to access conversation history

## Scope

### IN SCOPE

1. **MCP Server Setup**
   - MCP SDK integration
   - Stdio transport (for local use)
   - HTTP/SSE transport (for remote use)

2. **Tools (Actions)**
   - `send_text` - Send text message
   - `send_media` - Send media message
   - `send_tts` - Send TTS voice note
   - `send_reaction` - Send reaction
   - `list_instances` - List all instances
   - `list_chats` - List chats for instance
   - `list_messages` - List messages in chat
   - `get_contacts` - Get contacts for instance

3. **Resources (Read-only Data)**
   - `omni://instances` - All instances
   - `omni://instances/{id}/chats` - Chats for instance
   - `omni://instances/{id}/chats/{chatId}/messages` - Messages in chat
   - `omni://instances/{id}/contacts` - Contacts

4. **Configuration**
   - API URL configuration
   - API key authentication
   - Instance filtering

### OUT OF SCOPE

- Streaming responses
- Webhooks/subscriptions
- Admin operations
- Complex filtering queries

## Technical Design

### Package Structure

```
packages/
└── mcp/
    ├── src/
    │   ├── index.ts          # Entry point
    │   ├── server.ts         # MCP server setup
    │   ├── tools/
    │   │   ├── index.ts
    │   │   ├── messaging.ts  # send_text, send_media, send_tts
    │   │   ├── instances.ts  # list_instances
    │   │   └── chats.ts      # list_chats, list_messages
    │   ├── resources/
    │   │   ├── index.ts
    │   │   └── omni.ts       # All omni:// resources
    │   └── client.ts         # API client wrapper
    ├── package.json
    └── tsconfig.json
```

### MCP Server Implementation

```typescript
// packages/mcp/src/server.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools';
import { registerResources } from './resources';

export async function createServer() {
  const server = new Server(
    {
      name: 'omni-mcp',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
    }
  );

  registerTools(server);
  registerResources(server);

  return server;
}

// Entry point
const server = await createServer();
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Tool Definitions

```typescript
// packages/mcp/src/tools/messaging.ts

import { z } from 'zod';

export const sendTextTool = {
  name: 'send_text',
  description: 'Send a text message via WhatsApp or Discord',
  inputSchema: z.object({
    instanceId: z.string().describe('Instance ID to send from'),
    recipient: z.string().describe('Phone number or chat ID'),
    text: z.string().describe('Message text to send'),
  }),
  handler: async (input) => {
    const response = await apiClient.sendText(
      input.instanceId,
      input.recipient,
      input.text
    );
    return {
      content: [
        {
          type: 'text',
          text: `Message sent: ${response.messageId}`,
        },
      ],
    };
  },
};

export const sendTTSTool = {
  name: 'send_tts',
  description: 'Send a text-to-speech voice note',
  inputSchema: z.object({
    instanceId: z.string(),
    recipient: z.string(),
    text: z.string().describe('Text to convert to speech'),
    voiceId: z.string().optional().describe('ElevenLabs voice ID'),
  }),
  handler: async (input) => {
    const response = await apiClient.sendTTS(input);
    return {
      content: [
        {
          type: 'text',
          text: `Voice note sent: ${response.durationMs}ms audio`,
        },
      ],
    };
  },
};
```

### Resource Definitions

```typescript
// packages/mcp/src/resources/omni.ts

export const instancesResource = {
  uri: 'omni://instances',
  name: 'Omni Instances',
  description: 'List of all configured messaging instances',
  mimeType: 'application/json',
  handler: async () => {
    const instances = await apiClient.getInstances();
    return JSON.stringify(instances, null, 2);
  },
};

export const chatsResource = {
  uriTemplate: 'omni://instances/{instanceId}/chats',
  name: 'Instance Chats',
  description: 'List of chats for a specific instance',
  mimeType: 'application/json',
  handler: async (uri) => {
    const instanceId = extractParam(uri, 'instanceId');
    const chats = await apiClient.getChats(instanceId);
    return JSON.stringify(chats, null, 2);
  },
};
```

### Configuration

```json
// .mcp.json (user config)
{
  "mcpServers": {
    "omni": {
      "command": "bunx",
      "args": ["@omni/mcp"],
      "env": {
        "OMNI_API_URL": "http://localhost:8882",
        "OMNI_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Implementation Groups

### Group 1: Setup
- [ ] Create `packages/mcp/` directory
- [ ] Set up MCP SDK dependencies
- [ ] Create basic server structure
- [ ] Create API client wrapper

### Group 2: Tools
- [ ] Implement `send_text` tool
- [ ] Implement `send_media` tool
- [ ] Implement `send_tts` tool
- [ ] Implement `send_reaction` tool
- [ ] Implement `list_instances` tool
- [ ] Implement `list_chats` tool
- [ ] Implement `list_messages` tool

### Group 3: Resources
- [ ] Implement `omni://instances` resource
- [ ] Implement `omni://instances/{id}/chats` resource
- [ ] Implement `omni://instances/{id}/chats/{chatId}/messages` resource
- [ ] Implement `omni://instances/{id}/contacts` resource

### Group 4: Publishing
- [ ] Add to monorepo build
- [ ] Create npm package
- [ ] Add documentation
- [ ] Test with Claude Desktop

## Success Criteria

- [ ] MCP server starts and connects via stdio
- [ ] All tools work correctly
- [ ] Resources return proper data
- [ ] Works with Claude Desktop
- [ ] Works with Cursor/Windsurf

## Dependencies

- `@omni/sdk` - API client
- `@modelcontextprotocol/sdk` - MCP SDK
