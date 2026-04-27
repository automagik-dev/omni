/**
 * Agent tools for Microsoft Teams interactions.
 *
 * Group 2 ships only the typed surface; the actual implementations land in
 * Group 3 (inbound) and Group 4 (outbound). The signatures below mirror the
 * Slack tools module so the dispatcher can wire to either channel without
 * branching.
 *
 * Each tool throws `TeamsError(SEND_FAILED|...)` on failure — the dispatcher
 * relies on that contract for retry classification.
 */

import type { Logger } from '@omni/channel-sdk';
import { TeamsError, TeamsErrorCode } from './types';

const NOT_IMPLEMENTED = (toolName: string): never => {
  throw new TeamsError(
    TeamsErrorCode.UNSUPPORTED_ACTIVITY,
    `${toolName} is not implemented in the Group 2 skeleton — see WISH.md Group 3/4`,
  );
};

/**
 * Add a reaction to a Teams message.
 *
 * Bot Framework supports a fixed enum: `like`, `heart`, `laugh`, `surprised`,
 * `sad`, `angry`. Anything else will be normalised by Group 4.
 */
export async function addReaction(
  _conversationId: string,
  _activityId: string,
  _emoji: string,
  logger: Logger,
): Promise<void> {
  logger.debug('teams.addReaction stub invoked');
  NOT_IMPLEMENTED('addReaction');
}

/**
 * Remove a reaction from a Teams message.
 */
export async function removeReaction(
  _conversationId: string,
  _activityId: string,
  _emoji: string,
  logger: Logger,
): Promise<void> {
  logger.debug('teams.removeReaction stub invoked');
  NOT_IMPLEMENTED('removeReaction');
}

/**
 * Edit an already-sent message (Bot Framework `updateActivity`).
 */
export async function editMessage(
  _conversationId: string,
  _activityId: string,
  _newText: string,
  logger: Logger,
): Promise<void> {
  logger.debug('teams.editMessage stub invoked');
  NOT_IMPLEMENTED('editMessage');
}

/**
 * Delete an already-sent message (Bot Framework `deleteActivity`).
 */
export async function deleteMessage(_conversationId: string, _activityId: string, logger: Logger): Promise<void> {
  logger.debug('teams.deleteMessage stub invoked');
  NOT_IMPLEMENTED('deleteMessage');
}

/**
 * Look up a Teams member's profile (display name, AAD ID, email).
 *
 * Bot Framework exposes this via `TeamsInfo.getMember` from `botbuilder`.
 */
export async function memberInfo(
  _conversationId: string,
  _userId: string,
  logger: Logger,
): Promise<Record<string, unknown>> {
  logger.debug('teams.memberInfo stub invoked');
  return NOT_IMPLEMENTED('memberInfo');
}
