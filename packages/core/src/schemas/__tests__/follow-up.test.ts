import { describe, expect, test } from 'bun:test';
import type { EventPayloadMap } from '../../events/types';
import { CORE_EVENT_TYPES } from '../../events/types';
import {
  DisarmReasonSchema,
  ExponentialScheduleSchema,
  FixedScheduleSchema,
  FollowUpScheduleSchema,
  FollowUpSequenceConfigSchema,
} from '../follow-up';

describe('follow-up schemas', () => {
  describe('FixedScheduleSchema', () => {
    test('accepts a valid fixed schedule', () => {
      const parsed = FixedScheduleSchema.parse({ kind: 'fixed', intervalsMinutes: [3, 5, 30] });
      expect(parsed.kind).toBe('fixed');
      expect(parsed.intervalsMinutes).toEqual([3, 5, 30]);
    });

    test('rejects empty intervals', () => {
      const result = FixedScheduleSchema.safeParse({ kind: 'fixed', intervalsMinutes: [] });
      expect(result.success).toBe(false);
    });

    test('rejects non-positive intervals', () => {
      expect(FixedScheduleSchema.safeParse({ kind: 'fixed', intervalsMinutes: [0] }).success).toBe(false);
      expect(FixedScheduleSchema.safeParse({ kind: 'fixed', intervalsMinutes: [-1] }).success).toBe(false);
    });
  });

  describe('ExponentialScheduleSchema', () => {
    test('accepts a valid exponential schedule', () => {
      const parsed = ExponentialScheduleSchema.parse({
        kind: 'exponential',
        initialMinutes: 3,
        factor: 2,
        maxMinutes: 120,
      });
      expect(parsed.kind).toBe('exponential');
      expect(parsed.factor).toBe(2);
    });

    test('rejects factor <= 1', () => {
      expect(
        ExponentialScheduleSchema.safeParse({
          kind: 'exponential',
          initialMinutes: 3,
          factor: 1,
          maxMinutes: 120,
        }).success,
      ).toBe(false);
    });

    test('rejects non-positive initial / max', () => {
      expect(
        ExponentialScheduleSchema.safeParse({
          kind: 'exponential',
          initialMinutes: 0,
          factor: 2,
          maxMinutes: 120,
        }).success,
      ).toBe(false);
      expect(
        ExponentialScheduleSchema.safeParse({
          kind: 'exponential',
          initialMinutes: 3,
          factor: 2,
          maxMinutes: 0,
        }).success,
      ).toBe(false);
    });
  });

  describe('FollowUpScheduleSchema discriminated union', () => {
    test('routes by kind', () => {
      expect(FollowUpScheduleSchema.parse({ kind: 'fixed', intervalsMinutes: [1] }).kind).toBe('fixed');
      expect(
        FollowUpScheduleSchema.parse({
          kind: 'exponential',
          initialMinutes: 1,
          factor: 2,
          maxMinutes: 10,
        }).kind,
      ).toBe('exponential');
    });

    test('rejects unknown kind', () => {
      const result = FollowUpScheduleSchema.safeParse({ kind: 'cron', cron: '*/5 * * * *' });
      expect(result.success).toBe(false);
    });
  });

  describe('FollowUpSequenceConfigSchema', () => {
    const validConfig = {
      schedule: { kind: 'fixed' as const, intervalsMinutes: [3, 5, 30] },
      maxFollowUps: 3,
      promptTemplate: 'Follow up politely with the customer.',
    };

    test('accepts valid config and applies defaults', () => {
      const parsed = FollowUpSequenceConfigSchema.parse(validConfig);
      expect(parsed.enabled).toBe(true);
      expect(parsed.stopOutsideMessagingWindow).toBe(true);
      expect(parsed.showTypingIndicator).toBe(true);
      expect(parsed.maxFollowUps).toBe(3);
    });

    test('rejects negative maxFollowUps', () => {
      expect(FollowUpSequenceConfigSchema.safeParse({ ...validConfig, maxFollowUps: -1 }).success).toBe(false);
    });

    test('rejects zero maxFollowUps', () => {
      expect(FollowUpSequenceConfigSchema.safeParse({ ...validConfig, maxFollowUps: 0 }).success).toBe(false);
    });

    test('rejects maxFollowUps above cap', () => {
      expect(FollowUpSequenceConfigSchema.safeParse({ ...validConfig, maxFollowUps: 51 }).success).toBe(false);
    });

    test('rejects empty promptTemplate', () => {
      expect(FollowUpSequenceConfigSchema.safeParse({ ...validConfig, promptTemplate: '' }).success).toBe(false);
    });

    test('rejects empty intervals list via nested schedule', () => {
      expect(
        FollowUpSequenceConfigSchema.safeParse({
          ...validConfig,
          schedule: { kind: 'fixed', intervalsMinutes: [] },
        }).success,
      ).toBe(false);
    });

    test('rejects unknown top-level fields (strict)', () => {
      expect(FollowUpSequenceConfigSchema.safeParse({ ...validConfig, foo: 'bar' }).success).toBe(false);
    });

    test('accepts exponential schedule', () => {
      const parsed = FollowUpSequenceConfigSchema.parse({
        ...validConfig,
        schedule: { kind: 'exponential', initialMinutes: 3, factor: 2, maxMinutes: 60 },
      });
      expect(parsed.schedule.kind).toBe('exponential');
    });
  });

  describe('DisarmReasonSchema', () => {
    test('accepts every reason from the spec', () => {
      const reasons = [
        'customer_replied',
        'handoff',
        'archived',
        'window_expired',
        'sequence_complete',
        'agent_error',
        'send_failed',
      ] as const;
      for (const reason of reasons) {
        expect(DisarmReasonSchema.parse(reason)).toBe(reason);
      }
    });

    test('rejects unknown reason', () => {
      expect(DisarmReasonSchema.safeParse('exploded').success).toBe(false);
    });
  });

  describe('event registration', () => {
    test('CORE_EVENT_TYPES includes every follow-up event', () => {
      const types = CORE_EVENT_TYPES as readonly string[];
      expect(types).toContain('chat.idle_timeout');
      expect(types).toContain('follow_up.armed');
      expect(types).toContain('follow_up.fired');
      expect(types).toContain('follow_up.skipped');
      expect(types).toContain('follow_up.disarmed');
    });

    test('EventPayloadMap typechecks each follow-up variant without as-any', () => {
      // Compile-time proof: these assignments must typecheck without casts.
      const idle: EventPayloadMap['chat.idle_timeout'] = {
        chatId: 'chat-1',
        instanceId: 'inst-1',
        agentId: null,
        sequenceIndex: 0,
        attemptNumber: 1,
        totalAttempts: 3,
        minutesSinceLastAgentReply: 3,
        syntheticPrompt: 'please follow up',
      };
      const armed: EventPayloadMap['follow_up.armed'] = {
        chatId: 'chat-1',
        instanceId: 'inst-1',
        agentId: null,
        sequenceIndex: 0,
        nextFireAt: Date.now() + 60_000,
      };
      const fired: EventPayloadMap['follow_up.fired'] = {
        chatId: 'chat-1',
        instanceId: 'inst-1',
        agentId: null,
        sequenceIndex: 0,
        firedAt: Date.now(),
        syntheticPrompt: 'please follow up',
      };
      const skipped: EventPayloadMap['follow_up.skipped'] = {
        chatId: 'chat-1',
        instanceId: 'inst-1',
        agentId: null,
        sequenceIndex: 0,
        reason: 'channel_disconnected',
      };
      const disarmed: EventPayloadMap['follow_up.disarmed'] = {
        chatId: 'chat-1',
        instanceId: 'inst-1',
        agentId: null,
        sequenceIndex: 0,
        reason: 'customer_replied',
      };

      expect(idle.chatId).toBe('chat-1');
      expect(armed.sequenceIndex).toBe(0);
      expect(fired.syntheticPrompt).toBe('please follow up');
      expect(skipped.reason).toBe('channel_disconnected');
      expect(disarmed.reason).toBe('customer_replied');
    });
  });
});
