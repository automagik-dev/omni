# WISH: WhatsApp Business Cloud API Channel

**Status:** DRAFT
**Beads:** omni-c85
**Priority:** P2

## Context

The current WhatsApp channel uses Baileys (unofficial WhatsApp Web client). For production/enterprise use, we need official WhatsApp Business Cloud API support, which provides:
- Official Meta support
- Higher rate limits
- Business features (templates, catalogs)
- No risk of account bans

**V1 Reference:**
- V1 uses Evolution API which supports both Baileys and Cloud API modes

**WhatsApp Cloud API Docs:**
- https://developers.facebook.com/docs/whatsapp/cloud-api

## Problem Statement

Baileys-only implementation has limitations:
- Risk of account suspension (unofficial)
- No business message templates
- Lower rate limits
- No Meta support

Enterprise customers require official API support.

## Scope

### IN SCOPE

1. **Cloud API Integration**
   - Webhook receiver for incoming messages
   - Message sending via Graph API
   - Media upload/download
   - Message templates support

2. **Authentication**
   - Facebook App configuration
   - Access token management
   - Webhook verification

3. **Message Types**
   - Text messages
   - Media messages (image, video, audio, document)
   - Template messages
   - Interactive messages (buttons, lists)
   - Location messages
   - Contact messages

4. **Webhook Events**
   - `messages` - Incoming messages
   - `statuses` - Delivery/read receipts
   - `errors` - Error notifications

5. **Channel Plugin**
   - Implement `BaseChannelPlugin` interface
   - Register as `whatsapp-cloud` channel type
   - Share message schemas with `whatsapp-baileys`

### OUT OF SCOPE

- WhatsApp Business Management API (business settings)
- Catalog/Commerce features
- Flows (interactive forms)
- WhatsApp Business App integration

## Technical Design

### Package Structure

```
packages/
└── channel-whatsapp-cloud/
    ├── src/
    │   ├── index.ts
    │   ├── plugin.ts           # Main plugin
    │   ├── client.ts           # Graph API client
    │   ├── webhook.ts          # Webhook handler
    │   ├── handlers/
    │   │   ├── messages.ts     # Message handlers
    │   │   └── statuses.ts     # Status handlers
    │   ├── senders/
    │   │   ├── text.ts
    │   │   ├── media.ts
    │   │   ├── template.ts
    │   │   └── interactive.ts
    │   └── types.ts
    ├── package.json
    └── tsconfig.json
```

### Plugin Implementation

```typescript
// packages/channel-whatsapp-cloud/src/plugin.ts

import { BaseChannelPlugin } from '@omni/channel-sdk';

export class WhatsAppCloudPlugin extends BaseChannelPlugin {
  readonly id = 'whatsapp-cloud';
  readonly name = 'WhatsApp Business Cloud API';
  readonly channelType = 'whatsapp';

  private client: WhatsAppCloudClient;

  async initialize(config: PluginConfig) {
    this.client = new WhatsAppCloudClient({
      accessToken: config.accessToken,
      phoneNumberId: config.phoneNumberId,
      businessAccountId: config.businessAccountId,
    });
  }

  async sendMessage(instanceId: string, message: OutgoingMessage) {
    const result = await this.client.sendMessage(message);
    await this.publishEvent('message.sent', { instanceId, message, result });
    return result;
  }

  async handleWebhook(req: Request) {
    // Verify webhook signature
    // Parse webhook payload
    // Route to appropriate handler
    // Publish events
  }
}
```

### Graph API Client

```typescript
// packages/channel-whatsapp-cloud/src/client.ts

const GRAPH_API_URL = 'https://graph.facebook.com/v18.0';

export class WhatsAppCloudClient {
  private accessToken: string;
  private phoneNumberId: string;

  async sendTextMessage(to: string, text: string) {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: text },
    });
  }

  async sendTemplateMessage(to: string, template: TemplateMessage) {
    return this.sendMessage({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template,
    });
  }

  async sendMediaMessage(to: string, media: MediaMessage) {
    // Upload media first if needed
    const mediaId = await this.uploadMedia(media.buffer, media.mimeType);
    return this.sendMessage({
      messaging_product: 'whatsapp',
      to,
      type: media.type,
      [media.type]: { id: mediaId },
    });
  }

  private async sendMessage(payload: object) {
    const response = await fetch(
      `${GRAPH_API_URL}/${this.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      }
    );
    return response.json();
  }
}
```

### Webhook Handler

```typescript
// packages/channel-whatsapp-cloud/src/webhook.ts

export async function handleWebhook(req: Request, plugin: WhatsAppCloudPlugin) {
  // Verify signature
  const signature = req.headers.get('x-hub-signature-256');
  if (!verifySignature(signature, await req.text(), appSecret)) {
    throw new Error('Invalid signature');
  }

  const payload = await req.json();

  // Handle verification challenge
  if (req.method === 'GET') {
    const challenge = new URL(req.url).searchParams.get('hub.challenge');
    return new Response(challenge);
  }

  // Process webhook entries
  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field === 'messages') {
        await handleMessages(change.value, plugin);
      }
    }
  }
}

async function handleMessages(value: object, plugin: WhatsAppCloudPlugin) {
  for (const message of value.messages || []) {
    await plugin.publishEvent('message.received', {
      messageId: message.id,
      from: message.from,
      type: message.type,
      content: extractContent(message),
      timestamp: parseInt(message.timestamp) * 1000,
    });
  }
}
```

### Instance Configuration

```typescript
interface WhatsAppCloudConfig {
  // Facebook App credentials
  appId: string;
  appSecret: string;

  // WhatsApp Business Account
  businessAccountId: string;
  phoneNumberId: string;
  accessToken: string;

  // Webhook
  webhookVerifyToken: string;
}
```

## Implementation Groups

### Group 1: Setup
- [ ] Create `packages/channel-whatsapp-cloud/`
- [ ] Set up Graph API client
- [ ] Implement webhook verification

### Group 2: Message Receiving
- [ ] Implement webhook handler
- [ ] Handle text messages
- [ ] Handle media messages
- [ ] Handle status updates

### Group 3: Message Sending
- [ ] Implement text sending
- [ ] Implement media sending
- [ ] Implement template sending
- [ ] Implement interactive messages

### Group 4: Plugin Integration
- [ ] Implement `BaseChannelPlugin` interface
- [ ] Register plugin with channel registry
- [ ] Add instance configuration UI support

### Group 5: Testing
- [ ] Unit tests for client
- [ ] Webhook handler tests
- [ ] Integration tests with Meta sandbox

## Success Criteria

- [ ] Webhook receives and processes messages
- [ ] Text messages can be sent
- [ ] Media messages can be sent
- [ ] Template messages can be sent
- [ ] Status updates are tracked
- [ ] Plugin integrates with v2 architecture

## Dependencies

- `@omni/channel-sdk` - Plugin base class
- `@omni/core` - Event bus, schemas

## External Dependencies

- Meta Developer Account
- WhatsApp Business Account
- Verified phone number
