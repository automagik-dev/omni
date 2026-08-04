/**
 * Shared planner for the channel-agnostic `content.buttons` contract onto the
 * WhatsApp Cloud API `interactive` object. Meta's constraints drive the shape:
 *   - `interactive.button` — up to 3 reply buttons (title ≤ 20 chars, id ≤ 256)
 *   - `interactive.list`   — 4-10 options become a single-section list
 *                            (row title ≤ 24 chars, row description ≤ 72,
 *                            section title ≤ 24); >10 rows is a Meta hard
 *                            limit, the overflow is dropped (caller logs)
 *   - a list is also chosen for ≤3 options when the caller asks for one
 *     (`forceList`) or supplies presentation that only lists can render
 *     (a row `description`, or a `sectionTitle`) — rendering reply buttons
 *     there would drop that content silently
 *   - `interactive.cta_url`— exactly one URL button (session messages cannot
 *                            carry arbitrary URL buttons; cta_url is the only
 *                            in-session link affordance)
 *   - URL buttons that cannot be expressed (mixed with reply buttons, or more
 *     than one) are appended to the body as `label: url` lines so no
 *     information is silently lost.
 *
 * Consumed by every channel that speaks the Cloud API interactive dialect:
 * whatsapp-business talks to Meta directly, hermes through the Mutant gateway
 * (which proxies the same payload shape). Interactive messages only deliver
 * inside the 24h customer-service window — outside it Meta rejects them (use
 * an HSM template with buttons instead).
 */

export interface InteractiveButton {
  text: string;
  /** Callback payload (becomes the reply button / list row id). */
  data?: string;
  /** Link button URL — expressed via cta_url when it is the only button. */
  url?: string;
  /**
   * Secondary line under the row title. Lists only — Meta's reply buttons
   * have no description affordance, so supplying one promotes the message to
   * a list (see `planInteractive`).
   */
  description?: string;
}

/** List-specific presentation, ignored when the plan renders reply buttons. */
export interface InteractiveListOptions {
  /** Section header above the rows. */
  sectionTitle?: string;
  /** Render a list even with ≤3 options (default: count decides). */
  forceList?: boolean;
}

const MAX_REPLY_BUTTONS = 3;
const MAX_LIST_ROWS = 10;
const MAX_BUTTON_TITLE = 20;
const MAX_ROW_TITLE = 24;
const MAX_ROW_DESCRIPTION = 72;
const MAX_SECTION_TITLE = 24;
const MAX_ID = 256;

const truncate = (s: string, max: number): string => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

function buttonId(btn: InteractiveButton, index: number): string {
  return (btn.data ?? btn.text ?? `btn_${index}`).slice(0, MAX_ID);
}

/** Result of mapping the agnostic buttons onto a Cloud API interactive payload. */
export interface InteractivePlan {
  interactive: Record<string, unknown> | null;
  /** Body text, possibly extended with URL fallback lines. */
  body: string;
  /** Rows dropped beyond Meta's list limit — caller should log these. */
  droppedRows: number;
}

/**
 * Pure mapping step — exported for tests and for plugins to log drops.
 */
export function planInteractive(
  bodyText: string,
  buttons: InteractiveButton[],
  listButtonLabel: string,
  listOptions: InteractiveListOptions = {},
): InteractivePlan {
  const replyButtons = buttons.filter((b) => !b.url);
  const urlButtons = buttons.filter((b) => b.url);

  // Single URL button and nothing else → cta_url is the exact fit.
  const soleCta = replyButtons.length === 0 && urlButtons.length === 1 ? urlButtons[0] : undefined;
  if (soleCta) {
    return {
      interactive: {
        type: 'cta_url',
        body: { text: bodyText },
        action: {
          name: 'cta_url',
          parameters: { display_text: truncate(soleCta.text, MAX_BUTTON_TITLE), url: soleCta.url },
        },
      },
      body: bodyText,
      droppedRows: 0,
    };
  }

  // Any other URL buttons cannot render in-session — fold them into the body.
  let body = bodyText;
  if (urlButtons.length > 0) {
    const lines = urlButtons.map((b) => `${b.text}: ${b.url}`);
    body = body ? `${body}\n\n${lines.join('\n')}` : lines.join('\n');
  }

  if (replyButtons.length === 0) {
    return { interactive: null, body, droppedRows: 0 };
  }

  // Descriptions and section titles only exist on lists, so asking for either
  // implies a list — rendering reply buttons instead would drop them silently,
  // which this module deliberately avoids (see the URL-button fallback above).
  const wantsList =
    listOptions.forceList === true ||
    listOptions.sectionTitle !== undefined ||
    replyButtons.some((b) => b.description !== undefined);

  if (replyButtons.length <= MAX_REPLY_BUTTONS && !wantsList) {
    return {
      interactive: {
        type: 'button',
        body: { text: body },
        action: {
          buttons: replyButtons.map((b, i) => ({
            type: 'reply',
            reply: { id: buttonId(b, i), title: truncate(b.text, MAX_BUTTON_TITLE) },
          })),
        },
      },
      body,
      droppedRows: 0,
    };
  }

  const rows = replyButtons.slice(0, MAX_LIST_ROWS);
  return {
    interactive: {
      type: 'list',
      body: { text: body },
      action: {
        button: truncate(listButtonLabel, MAX_BUTTON_TITLE),
        sections: [
          {
            ...(listOptions.sectionTitle ? { title: truncate(listOptions.sectionTitle, MAX_SECTION_TITLE) } : {}),
            rows: rows.map((b, i) => ({
              id: buttonId(b, i),
              title: truncate(b.text, MAX_ROW_TITLE),
              ...(b.description ? { description: truncate(b.description, MAX_ROW_DESCRIPTION) } : {}),
            })),
          },
        ],
      },
    },
    body,
    droppedRows: replyButtons.length - rows.length,
  };
}
