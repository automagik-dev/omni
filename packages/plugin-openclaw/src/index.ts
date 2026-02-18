import type {
  OmniAccountConfig,
  OmniPluginConfig,
  OpenClawChannel,
  OpenClawChannelAPI,
  OpenClawInboundMessage,
  OpenClawMessage,
} from './types.js';

const activeConnections = new Map<string, { close: () => void }>();

function listAccountIds(cfg: OmniPluginConfig): string[] {
  const accounts = cfg.channels?.omni?.accounts;
  if (!accounts) return [];
  return Object.keys(accounts);
}

function resolveAccount(cfg: OmniPluginConfig, accountId: string): OmniAccountConfig | undefined {
  return cfg.channels?.omni?.accounts[accountId];
}

async function sendText(account: OmniAccountConfig, message: OpenClawMessage): Promise<void> {
  const url = `${account.apiUrl}/v2/instances/${account.instanceId}/messages/send`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${account.apiKey}`,
    },
    body: JSON.stringify({
      to: message.recipientId,
      text: message.text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Omni send failed: ${response.status} ${response.statusText}`);
  }
}

function stopGateway(accountId: string): void {
  const conn = activeConnections.get(accountId);
  if (conn) {
    conn.close();
    activeConnections.delete(accountId);
  }
}

function processSSEBuffer(buffer: string, accountId: string, onMessage: (msg: OpenClawInboundMessage) => void): string {
  const lines = buffer.split('\n');
  const remaining = lines.pop() ?? '';

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = line.slice(6).trim();
    if (!data || data === '[DONE]') continue;
    handleSSEData(data, accountId, onMessage);
  }

  return remaining;
}

interface MessageReceivedEvent {
  type: 'message.received';
  payload: { message: { sender: { id: string }; content?: { text?: string } } };
  metadata: { timestamp: number };
}

function isMessageReceivedEvent(value: unknown): value is MessageReceivedEvent {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === 'message.received' && typeof v.payload === 'object' && typeof v.metadata === 'object';
}

function handleSSEData(data: string, accountId: string, onMessage: (msg: OpenClawInboundMessage) => void): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }

  if (!isMessageReceivedEvent(parsed)) return;

  onMessage({
    accountId,
    senderId: parsed.payload.message.sender.id,
    text: parsed.payload.message.content?.text ?? '',
    timestamp: parsed.metadata.timestamp,
    rawEvent: parsed,
  });
}

async function startGateway(
  account: OmniAccountConfig,
  accountId: string,
  onMessage: (msg: OpenClawInboundMessage) => void,
): Promise<void> {
  stopGateway(accountId);

  const url = `${account.apiUrl}/v2/events/stream?instanceId=${account.instanceId}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${account.apiKey}`,
      Accept: 'text/event-stream',
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Omni SSE stream failed: ${response.status} ${response.statusText}`);
  }

  const abortController = new AbortController();
  const connection = {
    close: () => {
      abortController.abort();
    },
  };
  activeConnections.set(accountId, connection);

  // Read the SSE stream using Bun's async text() approach in background
  void (async () => {
    const decoder = new TextDecoder();
    const reader = response.body?.getReader();
    if (!reader) return;

    let buffer = '';
    try {
      for (;;) {
        if (abortController.signal.aborted) break;
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = processSSEBuffer(buffer, accountId, onMessage);
      }
    } catch {
      // Stream closed or aborted — normal on stop()
    }
  })();
}

const omniChannel: OpenClawChannel = {
  id: 'omni',
  meta: {
    label: 'Omni',
    selectionLabel: 'Omni Multichannel (WhatsApp, Discord, Slack, Telegram)',
    docsPath: '/channels/omni',
    blurb: 'Route messages via the Omni v2 multichannel stack.',
    aliases: ['omni-channel', 'omni-v2'],
  },
  capabilities: {
    chatTypes: ['direct', 'group'],
  },
  config: {
    listAccountIds,
    resolveAccount,
  },
  outbound: {
    sendText,
  },
  gateway: {
    start: startGateway,
    stop: async (accountId: string) => {
      stopGateway(accountId);
    },
  },
};

export default function register(api: OpenClawChannelAPI): void {
  api.registerChannel({ plugin: omniChannel });
}
