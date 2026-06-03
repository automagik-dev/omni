import { describe, expect, it } from 'bun:test';
import {
  buildCanonicalKhalSessionId,
  extractKhalSessionIdFromRawPayload,
  resolveKhalSessionId,
} from '../agent-session-identity';

describe('agent session identity', () => {
  it('extracts explicit KHAL session ids from rawPayload and headers', () => {
    expect(extractKhalSessionIdFromRawPayload({ khalSessionId: ' khal-session-123 ' })).toBe('khal-session-123');
    expect(extractKhalSessionIdFromRawPayload({ headers: { 'x-khal-session-id': ' khal-session-456 ' } })).toBe(
      'khal-session-456',
    );
  });

  it('builds canonical HML Gupshup session ids for Agno/KHAL dispatch and cleanup', () => {
    const resolved = resolveKhalSessionId({
      providerSchema: 'agno',
      sessionStrategy: 'per_chat',
      from: '5547996094523',
      chatId: '5547996094523',
      channel: 'whatsapp-gupshup',
      instanceId: 'c88f18fd-3e0a-49ed-9835-efd2c2be3988',
      personId: '8e0b8253-7221-4756-af64-dece4f25a71d',
      rawPayload: { headers: { 'x-khal-env': 'hml' } },
    });

    expect(resolved.source).toBe('canonical-khal');
    expect(resolved.sessionId).toBe(
      'khal:hml:omni:c88f18fd-3e0a-49ed-9835-efd2c2be3988:gupshup:8e0b8253-7221-4756-af64-dece4f25a71d',
    );
    expect(resolved.legacySessionId).toBe('5547996094523');
  });

  it('builds prod namespace canonical session ids from the same resolver', () => {
    expect(
      buildCanonicalKhalSessionId({
        environment: 'prod',
        instanceId: 'prod-instance',
        channelSegment: 'gupshup',
        personId: 'person-123',
      }),
    ).toBe('khal:prod:omni:prod-instance:gupshup:person-123');
  });

  it('preserves legacy computed ids for non-KHAL/non-Agno providers', () => {
    const resolved = resolveKhalSessionId({
      providerSchema: 'openclaw',
      sessionStrategy: 'per_chat',
      from: '5511999999999',
      chatId: '5511999999999',
      channel: 'whatsapp-gupshup',
      instanceId: 'inst-1',
      personId: 'person-1',
      rawPayload: { headers: { 'x-khal-env': 'hml' } },
    });

    expect(resolved.source).toBe('legacy');
    expect(resolved.sessionId).toBe('5511999999999');
  });
});
