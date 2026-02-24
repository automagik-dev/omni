/**
 * Tests for Slack config schema extensions and resolveChannelConfig helper
 *
 * Group 1: Config Schema Extensions
 */

import { describe, expect, it } from 'bun:test';

import { SlackChannelConfigSchema, SlackConfigExtensionSchema, resolveChannelConfig } from '../config/channel-config';
import type { SlackConfig } from '../types';

// ─────────────────────────────────────────────────────────────
// SlackChannelConfigSchema
// ─────────────────────────────────────────────────────────────

describe('SlackChannelConfigSchema', () => {
  it('accepts an empty object (all fields optional)', () => {
    const result = SlackChannelConfigSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts a fully-specified channel config', () => {
    const result = SlackChannelConfigSchema.safeParse({
      requireMention: true,
      allowedUsers: ['U123', 'U456'],
      tools: ['search', 'calculator'],
      skills: ['coding'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requireMention).toBe(true);
      expect(result.data.allowedUsers).toEqual(['U123', 'U456']);
      expect(result.data.tools).toEqual(['search', 'calculator']);
      expect(result.data.skills).toEqual(['coding']);
    }
  });

  it('rejects non-boolean requireMention', () => {
    const result = SlackChannelConfigSchema.safeParse({ requireMention: 'yes' });
    expect(result.success).toBe(false);
  });

  it('rejects non-array allowedUsers', () => {
    const result = SlackChannelConfigSchema.safeParse({ allowedUsers: 'U123' });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// SlackConfigExtensionSchema — mode defaults
// ─────────────────────────────────────────────────────────────

describe('SlackConfigExtensionSchema — mode defaults', () => {
  it('defaults mode to "socket" when omitted', () => {
    const result = SlackConfigExtensionSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('socket');
    }
  });

  it('accepts explicit mode: socket', () => {
    const result = SlackConfigExtensionSchema.safeParse({ mode: 'socket' });
    expect(result.success).toBe(true);
  });

  it('accepts mode: http with signingSecret', () => {
    const result = SlackConfigExtensionSchema.safeParse({
      mode: 'http',
      signingSecret: 'abcdef1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown mode values', () => {
    const result = SlackConfigExtensionSchema.safeParse({ mode: 'websocket' });
    expect(result.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────
// SlackConfigExtensionSchema — HTTP mode validation
// ─────────────────────────────────────────────────────────────

describe('SlackConfigExtensionSchema — HTTP mode validation', () => {
  it('fails validation when mode is http and signingSecret is missing', () => {
    const result = SlackConfigExtensionSchema.safeParse({ mode: 'http' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('signingSecret');
    }
  });

  it('fails validation when mode is http and signingSecret is empty string', () => {
    const result = SlackConfigExtensionSchema.safeParse({ mode: 'http', signingSecret: '' });
    expect(result.success).toBe(false);
  });

  it('passes validation when mode is socket and signingSecret is missing', () => {
    const result = SlackConfigExtensionSchema.safeParse({ mode: 'socket' });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────
// SlackConfigExtensionSchema — allowlist/blocklist mutual exclusivity
// ─────────────────────────────────────────────────────────────

describe('SlackConfigExtensionSchema — allowlist/blocklist mutual exclusivity', () => {
  it('accepts channelAllowlist without channelBlocklist', () => {
    const result = SlackConfigExtensionSchema.safeParse({ channelAllowlist: ['C123'] });
    expect(result.success).toBe(true);
  });

  it('accepts channelBlocklist without channelAllowlist', () => {
    const result = SlackConfigExtensionSchema.safeParse({ channelBlocklist: ['C123'] });
    expect(result.success).toBe(true);
  });

  it('fails when both channelAllowlist and channelBlocklist are set', () => {
    const result = SlackConfigExtensionSchema.safeParse({
      channelAllowlist: ['C123'],
      channelBlocklist: ['C456'],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((i) => i.path.join('.'));
      expect(paths).toContain('channelAllowlist');
    }
  });
});

// ─────────────────────────────────────────────────────────────
// resolveChannelConfig
// ─────────────────────────────────────────────────────────────

describe('resolveChannelConfig', () => {
  it('returns empty object when no channels config is set', () => {
    const config: Pick<SlackConfig, 'channels'> = {};
    const result = resolveChannelConfig(config, 'C123');
    expect(result).toEqual({});
  });

  it('returns empty object when channel has no per-channel config', () => {
    const config: Pick<SlackConfig, 'channels'> = {
      channels: { C456: { requireMention: true } },
    };
    const result = resolveChannelConfig(config, 'C123');
    expect(result).toEqual({});
  });

  it('returns channel-specific overrides', () => {
    const config: Pick<SlackConfig, 'channels'> = {
      channels: {
        C123: {
          requireMention: true,
          allowedUsers: ['U789'],
          tools: ['search'],
          skills: ['coding'],
        },
      },
    };
    const result = resolveChannelConfig(config, 'C123');
    expect(result.requireMention).toBe(true);
    expect(result.allowedUsers).toEqual(['U789']);
    expect(result.tools).toEqual(['search']);
    expect(result.skills).toEqual(['coding']);
  });

  it('does not bleed config from one channel to another', () => {
    const config: Pick<SlackConfig, 'channels'> = {
      channels: {
        C123: { requireMention: true },
        C456: { requireMention: false, allowedUsers: ['U111'] },
      },
    };
    const c123 = resolveChannelConfig(config, 'C123');
    const c456 = resolveChannelConfig(config, 'C456');

    expect(c123.requireMention).toBe(true);
    expect(c123.allowedUsers).toBeUndefined();

    expect(c456.requireMention).toBe(false);
    expect(c456.allowedUsers).toEqual(['U111']);
  });

  it('returns undefined for unset per-channel fields (not restricted by default)', () => {
    const config: Pick<SlackConfig, 'channels'> = {
      channels: { C123: { requireMention: true } },
    };
    const result = resolveChannelConfig(config, 'C123');
    expect(result.allowedUsers).toBeUndefined();
    expect(result.tools).toBeUndefined();
    expect(result.skills).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────
// Backward compatibility: existing configs work unchanged
// ─────────────────────────────────────────────────────────────

describe('Backward compatibility', () => {
  it('existing socket-mode config without new fields parses as socket mode', () => {
    const result = SlackConfigExtensionSchema.safeParse({
      // Old config with no mode/channels fields
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mode).toBe('socket');
      expect(result.data.channels).toBeUndefined();
      expect(result.data.channelAllowlist).toBeUndefined();
      expect(result.data.channelBlocklist).toBeUndefined();
    }
  });
});
