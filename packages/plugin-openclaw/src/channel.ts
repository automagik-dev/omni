import { omniMessageActions } from './actions.js';
import { startOmniAccount } from './gateway.js';
import { omniOutbound } from './outbound.js';
import type { ChannelAccountSnapshot, OmniPluginConfig, OpenClawChannel, ResolvedOmniAccount } from './types.js';

function listAccountIds(cfg: OmniPluginConfig): string[] {
  const accounts = cfg.channels?.omni?.accounts;
  if (!accounts) return [];
  return Object.keys(accounts);
}

function resolveAccount(cfg: OmniPluginConfig, accountId?: string | null): ResolvedOmniAccount {
  const accounts = cfg.channels?.omni?.accounts;
  const id = accountId ?? Object.keys(accounts ?? {})[0] ?? 'default';
  const raw = accounts?.[id];
  return {
    accountId: id,
    enabled: raw?.enabled !== false,
    configured: Boolean(raw?.apiUrl && raw?.apiKey && raw?.instanceId),
    apiUrl: raw?.apiUrl ?? '',
    apiKey: raw?.apiKey ?? '',
    instanceId: raw?.instanceId ?? '',
  };
}

export const omniPlugin: OpenClawChannel = {
  id: 'omni',
  meta: {
    label: 'Omni',
    selectionLabel: 'Omni Multichannel (WhatsApp, Discord, Slack, Telegram)',
    docsPath: '/channels/omni',
    blurb: 'Route messages via the Omni v2 multichannel stack.',
    aliases: ['omni-channel', 'omni-v2'],
  },
  capabilities: { chatTypes: ['direct', 'group'], reactions: true, media: true },
  config: {
    listAccountIds,
    resolveAccount,
    isConfigured: (account) => account.configured,
    describeAccount: (account): ChannelAccountSnapshot => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      baseUrl: account.apiUrl,
    }),
  },
  outbound: omniOutbound,
  actions: omniMessageActions,
  gateway: {
    startAccount: startOmniAccount,
  },
  status: {
    defaultRuntime: {
      accountId: 'default',
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: (accounts) =>
      accounts.flatMap((account) => {
        const lastError = typeof account.lastError === 'string' ? account.lastError.trim() : '';
        if (!lastError) return [];
        return [
          { channel: 'omni', accountId: account.accountId, kind: 'runtime', message: `Channel error: ${lastError}` },
        ];
      }),
  },
};
