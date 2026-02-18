export interface OmniAccountConfig {
  apiUrl: string;
  apiKey: string;
  instanceId: string;
  enabled?: boolean;
}

export interface OmniChannelConfig {
  accounts: Record<string, OmniAccountConfig>;
}

export interface OmniPluginConfig {
  channels?: {
    omni?: OmniChannelConfig;
  };
}

export interface OpenClawMessage {
  accountId: string;
  recipientId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface OpenClawInboundMessage {
  accountId: string;
  senderId: string;
  text: string;
  timestamp: number;
  rawEvent?: unknown;
}

export interface OpenClawChannelAPI {
  registerChannel(options: { plugin: OpenClawChannel }): void;
}

export interface OpenClawChannel {
  id: string;
  meta: {
    label: string;
    selectionLabel: string;
    docsPath: string;
    blurb: string;
    aliases: string[];
  };
  capabilities: {
    chatTypes: string[];
  };
  config: {
    listAccountIds(cfg: OmniPluginConfig): string[];
    resolveAccount(cfg: OmniPluginConfig, accountId: string): OmniAccountConfig | undefined;
  };
  outbound: {
    sendText(account: OmniAccountConfig, message: OpenClawMessage): Promise<void>;
  };
  gateway: {
    start(
      account: OmniAccountConfig,
      accountId: string,
      onMessage: (msg: OpenClawInboundMessage) => void,
    ): Promise<void>;
    stop(accountId: string): Promise<void>;
  };
}
