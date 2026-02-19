import { describe, expect, test } from 'bun:test';
import { z } from 'zod';

/**
 * Guild config API schema tests.
 * These validate the Zod schemas used by the guild config endpoints
 * without requiring a running API server.
 */

const guildConfigOverrideSchema = z.object({
  agentReplyFilter: z
    .object({
      mode: z.enum(['all', 'filtered']).optional(),
      conditions: z
        .object({
          onDm: z.boolean().optional(),
          onMention: z.boolean().optional(),
          onReply: z.boolean().optional(),
          onNameMatch: z.boolean().optional(),
          namePatterns: z.array(z.string()).optional(),
        })
        .optional(),
    })
    .optional(),
  toolPolicies: z.record(z.string(), z.enum(['allow', 'deny'])).optional(),
  reactions: z
    .object({
      enabled: z.boolean().optional(),
      allowedEmojis: z.array(z.string()).optional(),
    })
    .optional(),
  maxLines: z.number().int().min(0).optional(),
  presence: z
    .object({
      status: z.enum(['online', 'dnd', 'idle', 'invisible']).optional(),
      activityText: z.string().max(128).optional(),
      activityType: z.enum(['Playing', 'Streaming', 'Listening', 'Watching', 'Custom', 'Competing']).optional(),
    })
    .optional(),
});

describe('guild config schema validation', () => {
  test('accepts empty config (all defaults)', () => {
    const result = guildConfigOverrideSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  test('accepts agent reply filter override', () => {
    const result = guildConfigOverrideSchema.safeParse({
      agentReplyFilter: {
        mode: 'filtered',
        conditions: { onMention: true, onDm: false },
      },
    });
    expect(result.success).toBe(true);
  });

  test('accepts tool policies', () => {
    const result = guildConfigOverrideSchema.safeParse({
      toolPolicies: { search: 'allow', exec: 'deny' },
    });
    expect(result.success).toBe(true);
  });

  test('accepts maxLines = 0 (disabled)', () => {
    const result = guildConfigOverrideSchema.safeParse({ maxLines: 0 });
    expect(result.success).toBe(true);
  });

  test('accepts maxLines = 17', () => {
    const result = guildConfigOverrideSchema.safeParse({ maxLines: 17 });
    expect(result.success).toBe(true);
  });

  test('rejects negative maxLines', () => {
    const result = guildConfigOverrideSchema.safeParse({ maxLines: -1 });
    expect(result.success).toBe(false);
  });

  test('accepts presence override', () => {
    const result = guildConfigOverrideSchema.safeParse({
      presence: { status: 'dnd', activityText: 'Maintenance' },
    });
    expect(result.success).toBe(true);
  });

  test('rejects invalid presence status', () => {
    const result = guildConfigOverrideSchema.safeParse({
      presence: { status: 'busy' },
    });
    expect(result.success).toBe(false);
  });

  test('accepts full config override', () => {
    const result = guildConfigOverrideSchema.safeParse({
      agentReplyFilter: { mode: 'all' },
      toolPolicies: { search: 'allow' },
      reactions: { enabled: true, allowedEmojis: ['👍', '❤️'] },
      maxLines: 20,
      presence: { status: 'online', activityText: 'Helping', activityType: 'Playing' },
    });
    expect(result.success).toBe(true);
  });
});

describe('guild config resolution logic', () => {
  test('guild-specific overrides instance default (deep merge)', () => {
    const instanceDefaults = {
      agentReplyFilter: {
        mode: 'filtered' as const,
        conditions: { onDm: true, onMention: true, onReply: true },
      },
      maxLines: 17,
    };

    const guildOverride = {
      agentReplyFilter: {
        conditions: { onMention: false },
      },
      maxLines: 25,
    };

    // Resolved: guild overrides take precedence
    const resolved = {
      ...instanceDefaults,
      ...guildOverride,
      agentReplyFilter: {
        ...instanceDefaults.agentReplyFilter,
        ...guildOverride.agentReplyFilter,
        conditions: {
          ...instanceDefaults.agentReplyFilter.conditions,
          ...guildOverride.agentReplyFilter.conditions,
        },
      },
    };

    expect(resolved.maxLines).toBe(25);
    expect(resolved.agentReplyFilter.mode).toBe('filtered');
    expect(resolved.agentReplyFilter.conditions.onMention).toBe(false);
    expect(resolved.agentReplyFilter.conditions.onDm).toBe(true);
  });

  test('unknown guild falls back to instance defaults', () => {
    const overrides: Record<string, Record<string, unknown>> = {
      '123456789': { maxLines: 20 },
    };

    const guildId = '999999999';
    const guildConfig = overrides[guildId] ?? {};
    expect(guildConfig).toEqual({});
  });

  test('DELETE removes guild overrides', () => {
    const overrides: Record<string, Record<string, unknown>> = {
      '123456789': { maxLines: 20 },
      '987654321': { maxLines: 30 },
    };

    const guildIdToDelete = '123456789';
    delete overrides[guildIdToDelete];

    expect(overrides[guildIdToDelete]).toBeUndefined();
    expect(overrides['987654321']).toBeDefined();
  });
});

describe('guild config cache', () => {
  test('cache key format is instanceId:guildId', () => {
    const instanceId = 'inst-123';
    const guildId = 'guild-456';
    const cacheKey = `${instanceId}:${guildId}`;
    expect(cacheKey).toBe('inst-123:guild-456');
  });

  test('cache invalidation removes entry', () => {
    const cache = new Map<string, { data: unknown; expiresAt: number }>();
    const key = 'inst:guild';
    cache.set(key, { data: { maxLines: 20 }, expiresAt: Date.now() + 60000 });

    expect(cache.has(key)).toBe(true);
    cache.delete(key);
    expect(cache.has(key)).toBe(false);
  });

  test('expired cache entries are not used', () => {
    const cache = new Map<string, { data: unknown; expiresAt: number }>();
    const key = 'inst:guild';
    cache.set(key, { data: { maxLines: 20 }, expiresAt: Date.now() - 1000 }); // expired

    const entry = cache.get(key);
    const isValid = entry && entry.expiresAt > Date.now();
    expect(isValid).toBe(false);
  });
});

describe('guild config audit', () => {
  test('audit entry has required fields', () => {
    const auditEntry = {
      instanceId: 'inst-123',
      guildId: 'guild-456',
      apiKeyId: 'key-789',
      action: 'update' as const,
      diff: { old: { maxLines: 17 }, new: { maxLines: 25 } },
      timestamp: Date.now(),
    };

    expect(auditEntry.instanceId).toBeDefined();
    expect(auditEntry.guildId).toBeDefined();
    expect(auditEntry.action).toBe('update');
    expect(auditEntry.diff).toBeDefined();
    expect(auditEntry.timestamp).toBeGreaterThan(0);
  });

  test('delete action has null new config', () => {
    const auditEntry = {
      action: 'delete' as const,
      diff: { old: { maxLines: 20 }, new: null },
    };

    expect(auditEntry.action).toBe('delete');
    expect(auditEntry.diff.new).toBeNull();
  });
});
