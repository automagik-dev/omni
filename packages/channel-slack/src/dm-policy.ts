/**
 * DM policy enforcement for Slack channel
 *
 * Controls which users can send direct messages to the bot.
 * Three modes:
 * - 'open': All DMs accepted
 * - 'pairing': Only users in the allowlist can DM
 * - 'closed': All DMs rejected with configurable message
 */

import type { DmPolicy } from './types';

export interface DmPolicyConfig {
  policy: DmPolicy;
  allowlist?: string[];
  rejectionMessage?: string;
}

const DEFAULT_REJECTION_MESSAGE =
  "Sorry, I'm not configured to accept direct messages. Please message me in a channel instead.";

/**
 * Check if a DM from a user should be accepted
 */
export function shouldAcceptDm(userId: string, config: DmPolicyConfig): { accepted: boolean; reason?: string } {
  switch (config.policy) {
    case 'open':
      return { accepted: true };

    case 'pairing': {
      const isAllowed = config.allowlist?.includes(userId) ?? false;
      if (isAllowed) {
        return { accepted: true };
      }
      return {
        accepted: false,
        reason: config.rejectionMessage || DEFAULT_REJECTION_MESSAGE,
      };
    }

    case 'closed':
      return {
        accepted: false,
        reason: config.rejectionMessage || DEFAULT_REJECTION_MESSAGE,
      };

    default:
      return { accepted: true };
  }
}
