import type {
  ChannelMessageActionAdapter,
  ChannelMessageActionContext,
  OmniPluginConfig,
  ResolvedOmniAccount,
} from './types.js';

function readStringParam(params: Record<string, unknown>, key: string): string | undefined {
  const val = params[key];
  if (typeof val === 'string') return val.trim() || undefined;
  return undefined;
}

function requireStringParam(params: Record<string, unknown>, key: string): string {
  const val = readStringParam(params, key);
  if (val === undefined) throw new Error(`Missing required parameter: ${key}`);
  return val;
}

function resolveAccountForAction(cfg: OmniPluginConfig, accountId?: string | null): ResolvedOmniAccount {
  const accounts = cfg.channels?.omni?.accounts;
  const id = accountId ?? Object.keys(accounts ?? {})[0] ?? 'default';
  const raw = accounts?.[id];
  if (!raw) throw new Error(`Omni account '${id}' not found`);
  return {
    accountId: id,
    enabled: raw.enabled !== false,
    configured: Boolean(raw.apiUrl && raw.apiKey && raw.instanceId),
    apiUrl: raw.apiUrl,
    apiKey: raw.apiKey,
    instanceId: raw.instanceId,
  };
}

async function omniApiRequest(account: ResolvedOmniAccount, path: string, body: unknown): Promise<unknown> {
  const url = `${account.apiUrl}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': account.apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Omni API ${path} failed: ${response.status} ${response.statusText} ${text}`);
  }

  return response.json();
}

const SUPPORTED_ACTIONS = ['send', 'react', 'read', 'reply'] as const;

export const omniMessageActions: ChannelMessageActionAdapter = {
  listActions: () => [...SUPPORTED_ACTIONS],

  supportsAction: ({ action }) => (SUPPORTED_ACTIONS as readonly string[]).includes(action),

  handleAction: async (ctx: ChannelMessageActionContext): Promise<{ content: unknown }> => {
    const { action, params, cfg, accountId } = ctx;
    const account = resolveAccountForAction(cfg, accountId);

    if (action === 'send') {
      const to = requireStringParam(params, 'to');
      const message = requireStringParam(params, 'message');
      const replyTo = readStringParam(params, 'replyTo');
      const result = await omniApiRequest(account, '/api/v2/messages', {
        recipientId: to,
        text: message,
        instanceId: account.instanceId,
        ...(replyTo ? { replyToId: replyTo } : {}),
      });
      return { content: result };
    }

    if (action === 'react') {
      const messageId = requireStringParam(params, 'messageId');
      const emoji = readStringParam(params, 'emoji') ?? '\u{1F44D}';
      const result = await omniApiRequest(account, '/api/v2/messages/reaction', {
        messageId,
        emoji,
        instanceId: account.instanceId,
      });
      return { content: result };
    }

    if (action === 'read') {
      const messageId = requireStringParam(params, 'messageId');
      const url = `${account.apiUrl}/api/v2/messages/${messageId}/read`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': account.apiKey,
        },
        body: JSON.stringify({ instanceId: account.instanceId }),
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Omni read failed: ${response.status} ${response.statusText} ${text}`);
      }
      return { content: await response.json() };
    }

    if (action === 'reply') {
      const to = requireStringParam(params, 'to');
      const message = requireStringParam(params, 'message');
      const replyToId =
        readStringParam(params, 'replyTo') ??
        readStringParam(params, 'replyToId') ??
        readStringParam(params, 'messageId');
      const result = await omniApiRequest(account, '/api/v2/messages', {
        recipientId: to,
        text: message,
        instanceId: account.instanceId,
        ...(replyToId ? { replyToId } : {}),
      });
      return { content: result };
    }

    throw new Error(`Action '${action}' is not supported for channel omni.`);
  },
};
