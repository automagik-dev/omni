/**
 * Map Omni's channel-agnostic `content.buttons` onto the ASC platform's URA
 * fields (`ura_opcoes` + `forcar_botoes` on `POST /mensagem`).
 *
 * Shaping is delegated to the SDK's `planInteractive`, so the button-vs-list
 * decision and the title truncation are the SAME ones whatsapp-business and
 * hermes use. The ASC platform is a BSP on top of Meta, so no ASC limit can be
 * LOOSER than Meta's — cutting at Meta's is always safe.
 *
 * On top of the plan we apply three ASC-specific degradations. Each returns
 * `null`, and `null` means "send the bubble as plain text": the numbered text
 * the agent already wrote is the CANONICAL path and is never removed, the URA
 * is only a tap affordance on top of it.
 *
 *   1. more than 10 options — Meta truncates the overflow SILENTLY, and a
 *      half-shown menu is worse than a full numbered list;
 *   2. body over 1024 characters — Meta rejects the interactive body;
 *   3. titles that collide after truncation — the tap comes back as the TITLE,
 *      so two identical titles are an ambiguous choice. In scheduling that
 *      books the wrong appointment.
 *
 * The URA carries labels only: no descriptions, no section title, no list
 * button label. Nothing is lost — the description already lives in the
 * numbered text that goes out in the same bubble.
 */

import { planInteractive } from '@omni/channel-sdk';
import type { InteractiveButton, InteractiveListOptions } from '@omni/channel-sdk';

import type { AscFlowUra } from '../types';

const MAX_OPTIONS = 10;
const MAX_BODY_TEXT = 1024;

/**
 * Identity key for a title — accents, case and repeated spaces folded away, so
 * "Consulta às 08h30" and "consulta as 08h30" count as the same choice.
 */
export function foldTitle(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
}

/** Pull the row/button titles out of a Cloud API interactive object. */
function titlesOf(interactive: Record<string, unknown>): string[] {
  const action = interactive.action as Record<string, unknown> | undefined;
  if (interactive.type === 'button') {
    const buttons = (action?.buttons ?? []) as Array<{ reply?: { title?: string } }>;
    return buttons.map((b) => b.reply?.title ?? '');
  }
  const sections = (action?.sections ?? []) as Array<{ rows?: Array<{ title?: string }> }>;
  return (sections[0]?.rows ?? []).map((r) => r.title ?? '');
}

/**
 * Build the URA fields, or `null` when the payload must degrade to plain text.
 *
 * `body` is the text of the bubble the URA rides on — it is what Meta measures
 * against the 1024 limit, not the raw agent output.
 */
export function buildUra(
  body: string,
  buttons: InteractiveButton[] | undefined,
  listOptions: InteractiveListOptions = {},
): AscFlowUra | null {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_BODY_TEXT) return null;

  const replyButtons = (buttons ?? []).filter((b) => !b.url && b.text?.trim());
  if (replyButtons.length === 0 || replyButtons.length > MAX_OPTIONS) return null;

  // The list button label is irrelevant here (the URA has no such field), but
  // planInteractive requires one; pass a constant.
  const plan = planInteractive(trimmed, replyButtons, 'Opções', listOptions);
  if (!plan.interactive || plan.droppedRows > 0) return null;

  const type = plan.interactive.type;
  if (type !== 'button' && type !== 'list') return null;

  const titles = titlesOf(plan.interactive);
  if (titles.length !== replyButtons.length || titles.some((t) => !t)) return null;
  if (new Set(titles.map(foldTitle)).size !== titles.length) return null;

  return {
    ura_opcoes: Object.fromEntries(titles.map((title, i) => [String(i + 1), title])),
    forcar_botoes: type === 'button',
  };
}

/**
 * Split a turn into the bubbles that go out as separate WhatsApp messages.
 * A blank line is the separator — the convention the scheduling agent already
 * writes to, and the one the adapter proved in the ASC emulator.
 */
export function splitBubbles(text: string): string[] {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
}
