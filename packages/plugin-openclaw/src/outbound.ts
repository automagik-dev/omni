import { getOmniRuntime } from './runtime.js';
import type {
  ChannelOutboundAdapter,
  ChannelOutboundContext,
  OmniPluginConfig,
  OutboundDeliveryResult,
  ResolvedOmniAccount,
} from './types.js';

const OMNI_API_TIMEOUT_MS = 30_000;

function resolveAccountFromContext(ctx: ChannelOutboundContext): ResolvedOmniAccount {
  const accounts = (ctx.cfg as OmniPluginConfig).channels?.omni?.accounts;
  const id = ctx.accountId ?? Object.keys(accounts ?? {})[0] ?? 'default';
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

export const omniOutbound: ChannelOutboundAdapter = {
  deliveryMode: 'direct',
  chunker: (text, limit) => getOmniRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: 'markdown',
  textChunkLimit: 4096,

  sendText: async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
    const account = resolveAccountFromContext(ctx);
    const url = `${account.apiUrl}/api/v2/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': account.apiKey,
      },
      body: JSON.stringify({
        recipientId: ctx.to,
        text: ctx.text,
        instanceId: account.instanceId,
        ...(ctx.replyToId ? { replyToId: ctx.replyToId } : {}),
      }),
      signal: AbortSignal.timeout(OMNI_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Omni sendText failed: ${response.status} ${response.statusText} ${body}`);
    }

    const data = (await response.json()) as { id?: string };
    return { channel: 'omni', messageId: data.id };
  },

  sendMedia: async (ctx: ChannelOutboundContext): Promise<OutboundDeliveryResult> => {
    const account = resolveAccountFromContext(ctx);
    const url = `${account.apiUrl}/api/v2/messages/send/media`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': account.apiKey,
      },
      body: JSON.stringify({
        recipientId: ctx.to,
        text: ctx.text,
        mediaUrl: ctx.mediaUrl,
        instanceId: account.instanceId,
        ...(ctx.replyToId ? { replyToId: ctx.replyToId } : {}),
      }),
      signal: AbortSignal.timeout(OMNI_API_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`Omni sendMedia failed: ${response.status} ${response.statusText} ${body}`);
    }

    const data = (await response.json()) as { id?: string };
    return { channel: 'omni', messageId: data.id };
  },
};
