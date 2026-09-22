/**
 * Interaction handler for Slack
 *
 * Handles:
 * - Button clicks
 * - Select menu selections
 * - Modal submissions (view_submission) and closures (view_closed)
 * - Action acknowledgment within 3s Slack requirement
 * - Action ID scoping with 'omni:' prefix
 */

import type { Logger } from '@omni/channel-sdk';
import type { App } from '@slack/bolt';
import type { SlackInteractionPayload } from '../types';

export interface InteractionHandlerCallbacks {
  /**
   * `receiverKey` identifies the shared receiver, NOT an instance: an
   * interaction carries no event envelope, so the callback routes it by the
   * payload's `teamId` and `userId` and sets the instance itself (Group 5
   * review, HIGH #1).
   */
  onInteraction: (receiverKey: string, payload: SlackInteractionPayload) => Promise<void>;
}

/**
 * The workspace an interaction happened in.
 *
 * Block actions and view submissions spell it `body.team.id`; an
 * org-installed app can send `team` as null and carry the workspace on the
 * acting user instead, which is the `user.team_id` fallback.
 */
function teamIdOf(body: unknown): string | undefined {
  const record = body as Record<string, unknown> | null | undefined;
  const team = record?.team as Record<string, unknown> | null | undefined;
  const teamId = team?.id;
  if (typeof teamId === 'string' && teamId.length > 0) return teamId;
  const user = record?.user as Record<string, unknown> | null | undefined;
  const userTeamId = user?.team_id;
  return typeof userTeamId === 'string' && userTeamId.length > 0 ? userTeamId : undefined;
}

/**
 * Set up interaction handlers on a Bolt.js app
 */
export function setupInteractionHandlers(
  app: App,
  receiverKey: string,
  callbacks: InteractionHandlerCallbacks,
  logger: Logger,
): void {
  // Handle button clicks with omni: prefix
  app.action(/^omni:/, async ({ action, ack, body }) => {
    // Acknowledge within 3 seconds
    await ack();

    const act = action as unknown as Record<string, unknown>;
    const actionId = (act.action_id as string) ?? '';
    const value = act.value as string | undefined;
    const userId = (((body as unknown as Record<string, unknown>).user as Record<string, unknown>)?.id as string) ?? '';

    const channelObj = (body as unknown as Record<string, unknown>).channel as Record<string, unknown> | undefined;
    const channelId = channelObj?.id as string | undefined;
    const messageObj = (body as unknown as Record<string, unknown>).message as Record<string, unknown> | undefined;
    const threadTs = messageObj?.thread_ts as string | undefined;

    // Determine interaction type from action type
    const actionType = act.type as string;
    let interactionType: SlackInteractionPayload['type'] = 'button';
    if (actionType === 'static_select' || actionType === 'external_select' || actionType?.includes('select')) {
      interactionType = 'select';
    }

    // For select menus, extract selected value from various select types
    const selectedOption = act.selected_option as Record<string, unknown> | undefined;
    const selectedUser = act.selected_user as string | undefined;
    const selectedChannel = act.selected_channel as string | undefined;
    const selectedConversation = act.selected_conversation as string | undefined;
    const selectedValue =
      (selectedOption?.value as string | undefined) ?? selectedUser ?? selectedChannel ?? selectedConversation;

    const teamId = teamIdOf(body);
    logger.debug('Interaction received', { receiver: receiverKey, teamId, actionId, interactionType, userId });

    await callbacks.onInteraction(receiverKey, {
      instanceId: receiverKey,
      type: interactionType,
      actionId,
      userId,
      teamId,
      channelId,
      threadTs,
      value: selectedValue ?? value,
    });
  });

  // Handle modal submissions (view_submission)
  app.view({ callback_id: /^omni:/, type: 'view_submission' }, async ({ ack, view, body }) => {
    await ack();

    const callbackId = view.callback_id;
    const bodyAny = body as unknown as Record<string, unknown>;
    const userId = bodyAny.user ? ((bodyAny.user as Record<string, unknown>).id as string) : '';
    const privateMetadata = view.private_metadata || undefined;

    // Extract form values from the view state.
    // Each action type exposes its value on a different field:
    //   plain_text_input       → action.value
    //   static/external_select → action.selected_option.value
    //   users/channels/
    //   conversations_select   → action.selected_user / _channel / _conversation
    //   datepicker             → action.selected_date
    //   timepicker             → action.selected_time
    //   multi_*_select,
    //   checkboxes             → action.selected_options[] (array of {value})
    //   radio_buttons          → action.selected_option.value
    const stateValues = view.state?.values ?? {};
    const values: Record<string, string> = {};
    for (const [_blockId, block] of Object.entries(stateValues)) {
      const blockObj = block as unknown as Record<string, Record<string, unknown>>;
      for (const [actionId, action] of Object.entries(blockObj)) {
        const val = action.value as string | undefined;
        const selectedOpt = action.selected_option as Record<string, unknown> | undefined;
        const selectedOpts = action.selected_options as Array<Record<string, unknown>> | undefined;
        values[actionId] =
          val ??
          (selectedOpt?.value as string | undefined) ??
          (action.selected_user as string | undefined) ??
          (action.selected_channel as string | undefined) ??
          (action.selected_conversation as string | undefined) ??
          (action.selected_date as string | undefined) ??
          (action.selected_time as string | undefined) ??
          (selectedOpts ? JSON.stringify(selectedOpts.map((o) => o.value)) : undefined) ??
          '';
      }
    }

    const teamId = teamIdOf(body);
    logger.debug('Modal submission received', { receiver: receiverKey, teamId, callbackId, userId });

    await callbacks.onInteraction(receiverKey, {
      instanceId: receiverKey,
      type: 'modal_submit',
      actionId: callbackId,
      userId,
      teamId,
      privateMetadata,
      value: JSON.stringify(values),
      rawPayload: { view_state: stateValues },
    });
  });

  // Handle modal close events (view_closed)
  app.view({ callback_id: /^omni:/, type: 'view_closed' }, async ({ ack, view, body }) => {
    await ack();

    const callbackId = view.callback_id;
    const bodyAny = body as unknown as Record<string, unknown>;
    const userId = bodyAny.user ? ((bodyAny.user as Record<string, unknown>).id as string) : '';
    const privateMetadata = view.private_metadata || undefined;

    const teamId = teamIdOf(body);
    logger.debug('Modal closed', { receiver: receiverKey, teamId, callbackId, userId });

    await callbacks.onInteraction(receiverKey, {
      instanceId: receiverKey,
      type: 'modal_close',
      actionId: callbackId,
      userId,
      teamId,
      privateMetadata,
    });
  });

  logger.info('Interaction handlers registered', { receiver: receiverKey });
}
