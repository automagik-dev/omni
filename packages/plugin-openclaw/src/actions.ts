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

const OMNI_API_TIMEOUT_MS = 30_000;

async function omniApiRequest(account: ResolvedOmniAccount, path: string, body: unknown): Promise<unknown> {
  const url = `${account.apiUrl}${path}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': account.apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(OMNI_API_TIMEOUT_MS),
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
    if (!account.enabled) throw new Error(`Omni account '${account.accountId}' is disabled`);
    if (!account.configured) throw new Error(`Omni account '${account.accountId}' is not configured`);

    if (action === 'send') {
      const to = requireStringParam(params, 'to');
      const message = requireStringParam(params, 'message');
      const replyTo = readStringParam(params, 'replyTo');
      const result = await omniApiRequest(account, '/api/v2/messages/send', {
        to,
        text: message,
        instanceId: account.instanceId,
        ...(replyTo ? { replyTo } : {}),
      });
      return { content: result };
    }

    if (action === 'react') {
      const messageId = requireStringParam(params, 'messageId');
      const to = requireStringParam(params, 'to');
      const emoji = readStringParam(params, 'emoji') ?? '\u{1F44D}';
      const result = await omniApiRequest(account, '/api/v2/messages/send/reaction', {
        messageId,
        to,
        emoji,
        instanceId: account.instanceId,
      });
      return { content: result };
    }

    if (action === 'read') {
      const messageId = requireStringParam(params, 'messageId');
      const result = await omniApiRequest(account, `/api/v2/messages/${encodeURIComponent(messageId)}/read`, {
        instanceId: account.instanceId,
      });
      return { content: result };
    }

    if (action === 'reply') {
      const to = requireStringParam(params, 'to');
      const message = requireStringParam(params, 'message');
      const replyTo =
        readStringParam(params, 'replyTo') ??
        readStringParam(params, 'replyToId') ??
        readStringParam(params, 'messageId');
      const result = await omniApiRequest(account, '/api/v2/messages/send', {
        to,
        text: message,
        instanceId: account.instanceId,
        ...(replyTo ? { replyTo } : {}),
      });
      return { content: result };
    }

    throw new Error(`Action '${action}' is not supported for channel omni.`);
  },
};
