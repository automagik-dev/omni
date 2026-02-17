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
  onInteraction: (instanceId: string, payload: SlackInteractionPayload) => Promise<void>;
}

/**
 * Set up interaction handlers on a Bolt.js app
 */
export function setupInteractionHandlers(
  app: App,
  instanceId: string,
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

    logger.debug('Interaction received', { instanceId, actionId, interactionType, userId });

    await callbacks.onInteraction(instanceId, {
      instanceId,
      type: interactionType,
      actionId,
      userId,
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

    // Extract form values from the view state
    const stateValues = view.state?.values ?? {};
    const values: Record<string, string> = {};
    for (const [_blockId, block] of Object.entries(stateValues)) {
      const blockObj = block as unknown as Record<string, Record<string, unknown>>;
      for (const [actionId, action] of Object.entries(blockObj)) {
        const val = action.value as string | undefined;
        const selectedOpt = action.selected_option as Record<string, unknown> | undefined;
        values[actionId] = val ?? (selectedOpt?.value as string) ?? '';
      }
    }

    logger.debug('Modal submission received', { instanceId, callbackId, userId });

    await callbacks.onInteraction(instanceId, {
      instanceId,
      type: 'modal_submit',
      actionId: callbackId,
      userId,
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

    logger.debug('Modal closed', { instanceId, callbackId, userId });

    await callbacks.onInteraction(instanceId, {
      instanceId,
      type: 'modal_close',
      actionId: callbackId,
      userId,
      privateMetadata,
    });
  });

  logger.info('Interaction handlers registered', { instanceId });
}
