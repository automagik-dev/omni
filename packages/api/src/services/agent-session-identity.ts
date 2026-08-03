import type { ChannelType, ProviderSchema } from '@omni/db';

declare const process: { env: Record<string, string | undefined> };

type AgentSessionStrategyLike = 'per_user' | 'per_chat' | 'per_thread' | string;

function computeLegacySessionId(
  strategy: AgentSessionStrategyLike,
  userId: string,
  chatId: string,
  threadId?: string,
): string {
  switch (strategy) {
    case 'per_user':
      return userId;
    case 'per_chat':
      return chatId;
    case 'per_thread':
      return `thread:${chatId}:${threadId ?? chatId}`;
    default:
      return `${userId}:${chatId}`;
  }
}

export interface KhalSessionIdentityInput {
  providerSchema?: ProviderSchema | string;
  sessionStrategy?: string;
  from: string;
  chatId: string;
  channel?: ChannelType | string;
  instanceId: string;
  personId?: string | null;
  rawPayload?: Record<string, unknown> | null;
  environment?: string | null;
  threadId?: string;
}

export interface ResolvedAgentSessionIdentity {
  sessionId: string;
  legacySessionId: string;
  sessionStrategy: string;
  canonicalSessionId?: string;
  personId?: string;
  environment?: string;
  channelSegment?: string;
  source: 'explicit-khal' | 'canonical-khal' | 'legacy';
}

function readHeader(headers: unknown, name: string): string | undefined {
  if (!headers || typeof headers !== 'object') return undefined;
  const headerMap = headers as Record<string, unknown>;
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headerMap)) {
    if (key.toLowerCase() === lowerName && typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function readStringField(source: Record<string, unknown> | null | undefined, names: string[]): string | undefined {
  if (!source) return undefined;
  for (const name of names) {
    const value = source[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

export function extractKhalSessionIdFromRawPayload(rawPayload?: Record<string, unknown> | null): string | undefined {
  const direct = readStringField(rawPayload, ['khalSessionId', 'khal_session_id', 'session_id']);
  if (direct) return direct;
  return readHeader(rawPayload?.headers, 'x-khal-session-id');
}

function resolveKhalEnvironment(
  rawPayload?: Record<string, unknown> | null,
  explicitEnvironment?: string | null,
): string | undefined {
  const explicit = explicitEnvironment?.trim();
  if (explicit) return explicit;

  const fromPayload = readStringField(rawPayload, ['khalEnv', 'khalEnvironment', 'environment', 'env']);
  if (fromPayload) return fromPayload;

  return (
    readHeader(rawPayload?.headers, 'x-khal-env') ??
    readHeader(rawPayload?.headers, 'x-khal-environment') ??
    process.env.KHAL_SESSION_ENV?.trim() ??
    process.env.KHAL_ENV?.trim() ??
    process.env.OMNI_ENV?.trim()
  );
}

function channelToKhalSessionSegment(channel?: ChannelType | string): string | undefined {
  if (!channel) return undefined;
  if (channel === 'whatsapp-gupshup') return 'gupshup';
  if (channel === 'whatsapp-business') return 'whatsapp';
  if (channel === 'whatsapp-baileys') return 'whatsapp';
  return String(channel).replace(/^channel-/, '');
}

export function buildCanonicalKhalSessionId(input: {
  environment: string;
  instanceId: string;
  channelSegment: string;
  personId: string;
}): string {
  return `khal:${input.environment}:omni:${input.instanceId}:${input.channelSegment}:${input.personId}`;
}

export function resolveKhalSessionId(input: KhalSessionIdentityInput): ResolvedAgentSessionIdentity {
  const sessionStrategy = input.sessionStrategy ?? 'per_chat';
  const legacySessionId = computeLegacySessionId(sessionStrategy, input.from, input.chatId, input.threadId);
  const explicitKhalSessionId = extractKhalSessionIdFromRawPayload(input.rawPayload);
  if (explicitKhalSessionId) {
    return {
      sessionId: explicitKhalSessionId,
      legacySessionId,
      sessionStrategy,
      canonicalSessionId: explicitKhalSessionId,
      personId: input.personId ?? undefined,
      environment: resolveKhalEnvironment(input.rawPayload, input.environment),
      channelSegment: channelToKhalSessionSegment(input.channel),
      source: 'explicit-khal',
    };
  }

  const environment = resolveKhalEnvironment(input.rawPayload, input.environment);
  const channelSegment = channelToKhalSessionSegment(input.channel);
  const personId = input.personId?.trim();

  if (input.providerSchema === 'agno' && environment && channelSegment && personId) {
    const canonicalSessionId = buildCanonicalKhalSessionId({
      environment,
      instanceId: input.instanceId,
      channelSegment,
      personId,
    });
    return {
      sessionId: canonicalSessionId,
      legacySessionId,
      sessionStrategy,
      canonicalSessionId,
      personId,
      environment,
      channelSegment,
      source: 'canonical-khal',
    };
  }

  return {
    sessionId: legacySessionId,
    legacySessionId,
    sessionStrategy,
    personId: personId ?? undefined,
    environment,
    channelSegment,
    source: 'legacy',
  };
}
