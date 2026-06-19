import type { AgentTrigger, OmniCustomerContext, OmniExecutionContext, ProviderRequest } from './types';

export const OMNI_EXECUTION_CONTEXT_EXTENSION_URI = 'https://omni.dev/extensions/execution-context/v1';

function compactEnv(values: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined)) as Record<
    string,
    string
  >;
}

function inferChatType(context: AgentTrigger): 'dm' | 'group' | 'channel' {
  if (context.type === 'dm') return 'dm';
  if (context.source.chatId === context.sender.platformUserId) return 'dm';
  if (context.source.threadId) return 'channel';
  return 'group';
}

function compactCustomer(customer: OmniCustomerContext | undefined): OmniCustomerContext | undefined {
  if (!customer) return undefined;
  const compacted = Object.fromEntries(Object.entries(customer).filter(([, value]) => value !== undefined));
  return Object.keys(compacted).length > 0 ? compacted : undefined;
}

export function buildOmniExecutionContext(context: AgentTrigger): OmniExecutionContext {
  const userId = context.sender.personId ?? context.sender.platformUserId;
  const sessionId = context.sessionId || context.source.threadId || context.source.chatId || userId;
  const customer = compactCustomer(context.customer);
  return {
    identity: {
      userId,
      ...(context.sender.personId ? { personId: context.sender.personId } : {}),
      platformUserId: context.sender.platformUserId,
      ...(context.sender.displayName ? { displayName: context.sender.displayName } : {}),
    },
    source: {
      channel: context.source.channelType,
      instanceId: context.source.instanceId,
      chatId: context.source.chatId,
      ...(context.source.threadId ? { threadId: context.source.threadId } : {}),
      messageId: context.source.messageId,
    },
    session: {
      id: sessionId,
      ...(context.sessionStrategy ? { strategy: context.sessionStrategy } : {}),
    },
    trace: {
      id: context.traceId,
    },
    ...(customer ? { customer } : {}),
  };
}

export function buildOmniEnv(
  context: AgentTrigger,
  executionContext: OmniExecutionContext = buildOmniExecutionContext(context),
): Record<string, string> {
  return compactEnv({
    ...(context.env ?? {}),
    OMNI_USER_ID: executionContext.identity.userId,
    OMNI_PERSON_ID: executionContext.identity.personId,
    OMNI_PLATFORM_USER_ID: executionContext.identity.platformUserId,
    OMNI_SENDER: executionContext.identity.platformUserId,
    OMNI_DISPLAY_NAME: executionContext.identity.displayName,
    OMNI_INSTANCE: executionContext.source.instanceId,
    OMNI_CHAT: executionContext.source.chatId,
    OMNI_MESSAGE: executionContext.source.messageId,
    OMNI_CHANNEL: executionContext.source.channel,
    OMNI_SESSION: executionContext.session.id,
    OMNI_TRACE_ID: executionContext.trace.id,
    OMNI_THREAD: executionContext.source.threadId,
    OMNI_EXTERNAL_USER_ID: executionContext.customer?.externalUserId,
    OMNI_CUSTOMER_ID: executionContext.customer?.customerId,
    OMNI_ORGANIZATION_ID: executionContext.customer?.organizationId,
    OMNI_TENANT_ID: executionContext.customer?.tenantId,
  });
}

export function buildProviderRequestContext(
  context: AgentTrigger,
): Pick<
  ProviderRequest,
  | 'chat'
  | 'env'
  | 'executionContext'
  | 'messageId'
  | 'platform'
  | 'replyToMessageId'
  | 'sender'
  | 'sessionId'
  | 'userId'
> {
  const executionContext = buildOmniExecutionContext(context);
  return {
    userId: executionContext.identity.userId,
    sessionId: executionContext.session.id,
    platform: {
      id: executionContext.identity.platformUserId,
      channel: executionContext.source.channel,
      instanceId: executionContext.source.instanceId,
    },
    sender: {
      ...(executionContext.identity.displayName ? { displayName: executionContext.identity.displayName } : {}),
    },
    chat: {
      type: inferChatType(context),
      id: executionContext.source.chatId,
      ...(executionContext.source.threadId ? { threadId: executionContext.source.threadId } : {}),
    },
    messageId: executionContext.source.messageId,
    ...(context.content.referencedMessageId ? { replyToMessageId: context.content.referencedMessageId } : {}),
    env: buildOmniEnv(context, executionContext),
    executionContext,
  };
}
