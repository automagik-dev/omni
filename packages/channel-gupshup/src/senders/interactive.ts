/**
 * Gupshup interactive senders — reply buttons, list messages and WhatsApp Flows.
 *
 * The Custom Integration has no native interactive shape: each one goes out as
 * its own `msg_type` event and the partner's Journey maps it onto the matching
 * Bot Studio node (Reply → up to 3 buttons, List → up to 10 rows, WhatsApp
 * Flow). Buttons reuse the shared `planInteractive` so Meta's limits are
 * enforced here exactly as on the Cloud API channels — the Journey gets a
 * payload it can render without re-validating.
 *
 * A tapped button / list row comes back as an ordinary inbound message (the
 * option title). A submitted Flow comes back through the Flow Journey's API
 * node — see the `flow_response` event in handlers/webhooks.ts.
 */

import { planInteractive } from '@omni/channel-sdk';
import type { InteractiveButton, InteractiveListOptions } from '@omni/channel-sdk';
import type { WhatsAppFlowSend } from '@omni/core/schemas';
import type { GupshupClient } from '../client';
import type { GupshupListMessage, GupshupReplyButton, GupshupSendResponse } from '../types';
import { GupshupError, GupshupErrorCode } from '../utils/errors';

interface PlannedList {
  action?: {
    button?: string;
    sections?: Array<{ title?: string; rows?: Array<{ id: string; title: string; description?: string }> }>;
  };
}

interface PlannedButtons {
  action?: { buttons?: Array<{ reply?: { id: string; title: string } }> };
}

export interface InteractiveSendResult {
  response: GupshupSendResponse;
  /** Options beyond the 10-row list limit — the caller logs them. */
  droppedRows: number;
}

/** Label of the button that opens a list when the caller gives none. */
export const DEFAULT_LIST_BUTTON_LABEL = 'Options';

/**
 * Buttons or list, decided by `planInteractive` (≤3 → reply buttons, 4–10 →
 * list, or a list when asked). URL buttons cannot be expressed through the
 * Journey, so they are folded into the body text — never dropped. A lone URL
 * button (`cta_url` on the Cloud API) goes out as plain text for the same reason.
 */
export async function sendInteractive(
  client: GupshupClient,
  to: string,
  text: string,
  buttons: InteractiveButton[],
  list?: InteractiveListOptions & { buttonLabel?: string },
): Promise<InteractiveSendResult> {
  const plan = planInteractive(text, buttons, list?.buttonLabel ?? DEFAULT_LIST_BUTTON_LABEL, list);
  const interactive = plan.interactive as { type?: string } | null;

  if (interactive?.type === 'list') {
    const action = (interactive as PlannedList).action;
    const section = action?.sections?.[0];
    const listMsg: GupshupListMessage = {
      button: action?.button ?? DEFAULT_LIST_BUTTON_LABEL,
      ...(section?.title ? { section_title: section.title } : {}),
      rows: section?.rows ?? [],
    };
    return {
      response: await client.send(to, { type: 'LIST', text: plan.body, list: listMsg }),
      droppedRows: plan.droppedRows,
    };
  }

  if (interactive?.type === 'button') {
    const replyButtons: GupshupReplyButton[] = ((interactive as PlannedButtons).action?.buttons ?? [])
      .map((b) => b.reply)
      .filter((b): b is GupshupReplyButton => Boolean(b));
    return {
      response: await client.send(to, { type: 'BUTTONS', text: plan.body, buttons: replyButtons }),
      droppedRows: 0,
    };
  }

  // No reply options left (only URLs): plain text with the links spelled out.
  const soleUrl = buttons.length === 1 && buttons[0]?.url ? `${buttons[0].text}: ${buttons[0].url}` : '';
  const body = soleUrl ? [plan.body, soleUrl].filter(Boolean).join('\n\n') : plan.body;
  return { response: await client.send(to, { type: 'TEXT', text: body }), droppedRows: 0 };
}

/**
 * A WhatsApp Flow. Only published flows can be sent by id — the Journey's
 * WhatsApp Flow node has no lookup by name — so `flowName` is refused here
 * instead of failing silently on the partner side.
 */
export async function sendFlow(
  client: GupshupClient,
  to: string,
  flow: WhatsAppFlowSend & { flowToken: string },
): Promise<GupshupSendResponse> {
  if (!flow.flowId) {
    throw new GupshupError(
      GupshupErrorCode.BAD_REQUEST,
      'Gupshup flow send needs flowId — the Journey cannot resolve a flow by name',
    );
  }
  const action = flow.flowAction ?? 'navigate';
  return client.send(to, {
    type: 'FLOW',
    text: flow.bodyText,
    flow: {
      id: flow.flowId,
      cta: flow.cta,
      token: flow.flowToken,
      action,
      ...(action === 'navigate' && flow.screen ? { screen: flow.screen } : {}),
      ...(action === 'navigate' && flow.data ? { data: flow.data } : {}),
      ...(flow.headerText ? { header: flow.headerText } : {}),
      ...(flow.footerText ? { footer: flow.footerText } : {}),
      ...(flow.draft ? { draft: true } : {}),
    },
  });
}
