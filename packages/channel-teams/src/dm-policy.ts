/**
 * DM (1:1 chat) policy enforcement for the Microsoft Teams channel.
 *
 * Mirrors the Slack `dm-policy.ts` so operators have a single mental model:
 * - 'open':    accept all 1:1 chats with the bot
 * - 'pairing': only accept 1:1 chats from users in the allowlist
 * - 'closed':  reject every 1:1 chat with a configurable message
 *
 * In Teams, "DM" maps to the `personal` conversation scope (the activity
 * arrives with `conversation.conversationType === 'personal'`).
 */

import type { TeamsDmPolicy } from './types';

export interface TeamsDmPolicyConfig {
  policy: TeamsDmPolicy;
  allowlist?: string[];
  rejectionMessage?: string;
}

const DEFAULT_REJECTION_MESSAGE =
  "Sorry, I'm not configured to accept direct messages. Please reach me in a Teams channel instead.";

/**
 * Decide whether an inbound 1:1 chat should be processed.
 *
 * `userId` should be the sender's AAD object ID when available (`from.aadObjectId`),
 * with the legacy `from.id` as a fallback for guest accounts.
 */
export function shouldAcceptDm(userId: string, config: TeamsDmPolicyConfig): { accepted: boolean; reason?: string } {
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
