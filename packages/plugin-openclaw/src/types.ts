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

export interface ResolvedOmniAccount {
  accountId: string;
  name?: string;
  enabled: boolean;
  configured: boolean;
  apiUrl: string;
  apiKey: string;
  instanceId: string;
}

export interface OpenClawPluginApi {
  runtime: PluginRuntime;
  registerChannel(opts: { plugin: OpenClawChannel }): void;
}

export interface PluginRuntime {
  channel: {
    text: {
      chunkMarkdownText: (text: string, limit: number) => string[];
    };
  };
}

export interface ChannelOutboundAdapter {
  deliveryMode: string;
  chunker?: ((text: string, limit: number) => string[]) | null;
  chunkerMode?: string;
  textChunkLimit?: number;
  sendText?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
  sendMedia?: (ctx: ChannelOutboundContext) => Promise<OutboundDeliveryResult>;
}

export interface ChannelOutboundContext {
  cfg: OmniPluginConfig;
  to: string;
  text: string;
  mediaUrl?: string;
  replyToId?: string | null;
  threadId?: string | number | null;
  accountId?: string | null;
}

export interface OutboundDeliveryResult {
  channel: string;
  messageId?: string;
  [key: string]: unknown;
}

export interface ChannelGatewayContext {
  cfg: OmniPluginConfig;
  accountId: string;
  account: ResolvedOmniAccount;
  runtime: unknown;
  abortSignal: AbortSignal;
  log?: ChannelLogSink;
  getStatus: () => ChannelAccountSnapshot;
  setStatus: (next: ChannelAccountSnapshot) => void;
}

export interface ChannelLogSink {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
}

export interface ChannelAccountSnapshot {
  accountId: string;
  name?: string;
  enabled?: boolean;
  configured?: boolean;
  running?: boolean;
  lastStartAt?: number | null;
  lastStopAt?: number | null;
  lastError?: string | null;
  baseUrl?: string;
  [key: string]: unknown;
}

export interface ChannelMessageActionAdapter {
  listActions?: (params: { cfg: OmniPluginConfig }) => string[];
  supportsAction?: (params: { action: string }) => boolean;
  handleAction?: (ctx: ChannelMessageActionContext) => Promise<{ content: unknown }>;
}

export interface ChannelMessageActionContext {
  channel: string;
  action: string;
  cfg: OmniPluginConfig;
  params: Record<string, unknown>;
  accountId?: string | null;
}

export interface OpenClawChannel {
  id: string;
  meta: {
    id?: string;
    label: string;
    selectionLabel: string;
    docsPath: string;
    blurb: string;
    aliases?: string[];
    order?: number;
  };
  capabilities: {
    chatTypes: string[];
    reactions?: boolean;
    media?: boolean;
  };
  config: {
    listAccountIds(cfg: OmniPluginConfig): string[];
    resolveAccount(cfg: OmniPluginConfig, accountId?: string | null): ResolvedOmniAccount;
    isConfigured?: (account: ResolvedOmniAccount) => boolean;
    describeAccount?: (account: ResolvedOmniAccount) => ChannelAccountSnapshot;
  };
  outbound?: ChannelOutboundAdapter;
  actions?: ChannelMessageActionAdapter;
  gateway?: {
    startAccount?: (ctx: ChannelGatewayContext) => Promise<unknown>;
  };
  status?: {
    defaultRuntime?: ChannelAccountSnapshot;
    collectStatusIssues?: (
      accounts: ChannelAccountSnapshot[],
    ) => Array<{ channel: string; accountId: string; kind: string; message: string }>;
  };
}
