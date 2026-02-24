/**
 * Channel configuration resolution and validation
 *
 * Provides:
 * - Zod schemas for per-channel config validation
 * - resolveChannelConfig() helper for merging per-channel overrides
 */

import { z } from 'zod';
import type { SlackChannelConfig, SlackConfig } from '../types';

/**
 * Zod schema for per-channel configuration
 */
export const SlackChannelConfigSchema = z.object({
  requireMention: z.boolean().optional(),
  allowedUsers: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
});

/**
 * Zod schema for Slack config extension fields (new fields added in this version).
 *
 * Validates:
 * - mode: 'http' requires signingSecret
 * - channelAllowlist and channelBlocklist are mutually exclusive
 */
export const SlackConfigExtensionSchema = z
  .object({
    mode: z.enum(['socket', 'http']).optional().default('socket'),
    signingSecret: z.string().optional(),
    channels: z.record(z.string(), SlackChannelConfigSchema).optional(),
    channelAllowlist: z.array(z.string()).optional(),
    channelBlocklist: z.array(z.string()).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === 'http' && !data.signingSecret) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'signingSecret is required when mode is "http"',
        path: ['signingSecret'],
      });
    }
    if (data.channelAllowlist && data.channelBlocklist) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'channelAllowlist and channelBlocklist are mutually exclusive',
        path: ['channelAllowlist'],
      });
    }
  });

/**
 * Resolve per-channel configuration by merging instance defaults with channel overrides.
 *
 * Fields set in `channels[channelId]` take precedence over instance defaults.
 * Fields not set in the channel config return undefined (no restriction applied).
 *
 * @param instanceConfig - Full Slack instance config
 * @param channelId - Slack channel ID (e.g. "C12345")
 * @returns Merged SlackChannelConfig for the given channel
 */
export function resolveChannelConfig(
  instanceConfig: Pick<SlackConfig, 'channels'>,
  channelId: string,
): SlackChannelConfig {
  return instanceConfig.channels?.[channelId] ?? {};
}
