import { describe, expect, it } from 'bun:test';
import { buildOmniEnv, buildOmniExecutionContext, buildProviderRequestContext } from '../execution-context';
import type { AgentTrigger } from '../types';

const trigger: AgentTrigger = {
  traceId: 'trace-123',
  type: 'dm',
  event: {} as AgentTrigger['event'],
  source: {
    channelType: 'whatsapp-baileys',
    instanceId: 'instance-123',
    chatId: 'chat-456',
    messageId: 'message-789',
    threadId: 'thread-001',
  },
  sender: {
    platformUserId: '5511999999999@s.whatsapp.net',
    personId: 'person-111',
    displayName: 'Luis',
  },
  content: {
    text: 'hello',
    referencedMessageId: 'quoted-001',
  },
  sessionId: 'session-abc',
  sessionStrategy: 'per_chat',
  customer: {
    externalUserId: 'usr_123',
    customerId: 'cus_456',
    organizationId: 'org_789',
    tenantId: 'tenant_abc',
  },
  env: {
    GENIE_TMUX_SESSION: 'omni',
  },
};

describe('execution context', () => {
  it('builds canonical Omni execution context', () => {
    const context = buildOmniExecutionContext(trigger);

    expect(context.identity.userId).toBe('person-111');
    expect(context.identity.platformUserId).toBe('5511999999999@s.whatsapp.net');
    expect(context.source.instanceId).toBe('instance-123');
    expect(context.session.id).toBe('session-abc');
    expect(context.customer?.externalUserId).toBe('usr_123');
  });

  it('falls back to platform user ID when personId is missing', () => {
    const context = buildOmniExecutionContext({
      ...trigger,
      sender: { platformUserId: 'telegram-user-1' },
      customer: undefined,
    });

    expect(context.identity.userId).toBe('telegram-user-1');
    expect(context.identity.personId).toBeUndefined();
  });

  it('builds CLI env with legacy aliases and customer IDs', () => {
    const env = buildOmniEnv(trigger);

    expect(env.OMNI_USER_ID).toBe('person-111');
    expect(env.OMNI_PERSON_ID).toBe('person-111');
    expect(env.OMNI_PLATFORM_USER_ID).toBe('5511999999999@s.whatsapp.net');
    expect(env.OMNI_SENDER).toBe('5511999999999@s.whatsapp.net');
    expect(env.OMNI_EXTERNAL_USER_ID).toBe('usr_123');
    expect(env.OMNI_CUSTOMER_ID).toBe('cus_456');
    expect(env.GENIE_TMUX_SESSION).toBe('omni');
  });

  it('builds provider request context', () => {
    const requestContext = buildProviderRequestContext(trigger);

    expect(requestContext.userId).toBe('person-111');
    expect(requestContext.sessionId).toBe('session-abc');
    expect(requestContext.platform?.id).toBe('5511999999999@s.whatsapp.net');
    expect(requestContext.messageId).toBe('message-789');
    expect(requestContext.replyToMessageId).toBe('quoted-001');
    expect(requestContext.executionContext?.customer?.tenantId).toBe('tenant_abc');
  });

  it('uses the trigger classification to identify direct messages', () => {
    const requestContext = buildProviderRequestContext({
      ...trigger,
      type: 'dm',
      source: {
        ...trigger.source,
        channelType: 'slack',
        chatId: 'D123',
        threadId: undefined,
      },
      sender: {
        platformUserId: 'U123',
      },
    });

    expect(requestContext.chat?.type).toBe('dm');
  });
});
