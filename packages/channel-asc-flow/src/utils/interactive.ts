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

/** Meta renders at most three reply buttons. */
const MAX_BUTTONS = 3;
/** Meta's reply-button title limit. */
const BUTTON_TITLE_MAX = 20;

/**
 * Shorten a title to the button limit, cutting on a word boundary when that
 * leaves something readable.
 *
 * "ROGERIO AMARO RODRIGUES" becomes "ROGERIO AMARO", not "ROGERIO AMARO RODRI".
 * A hard cut is the fallback for a single long word.
 */
function shortenTitle(title: string): string {
  const value = title.trim();
  if (value.length <= BUTTON_TITLE_MAX) return value;
  const head = value.slice(0, BUTTON_TITLE_MAX);
  const boundary = head.lastIndexOf(' ');
  return (boundary >= 8 ? head.slice(0, boundary) : head).trim();
}

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

  let titles = titlesOf(plan.interactive);
  let asButtons = type === 'button';

  // A LIST never renders on this platform. Measured on the handset 05/09: with
  // `forcar_botoes: true` Baileys received a `buttonsMessage` and showed the
  // taps; with `false` it received a plain `conversation`, and the platform had
  // APPENDED its own numbered menu to the text. The beneficiary then read the
  // options twice — once in the agent's own bubbles, once in the menu the
  // platform built:
  //
  //     Encontramos mais de uma pessoa neste cadastro. Para quem é a consulta?
  //     1. Rogerio
  //     2. Aneli
  //     Pode responder com o nome.
  //     1 - ROGERIO AMARO RODRIGUES
  //     2 - ANELI CAMILO AMARO
  //
  // So when the options FIT in buttons, take buttons even if the plan chose a
  // list on title length alone — shortening a title costs a few characters on
  // a tap target whose full text is already in the bubble above it. Past three
  // options nothing can be done: the numbered text stays the canonical path.
  if (!asButtons && replyButtons.length <= MAX_BUTTONS) {
    titles = replyButtons.map((b) => shortenTitle(b.text ?? ''));
    asButtons = true;
  }

  // Past three options there is no component, and sending one anyway is WORSE
  // than sending none.
  //
  // A list here is flattened into a numbered menu the platform builds from
  // `ura_opcoes` — titles only, descriptions dropped, because the URA has no
  // field for them. The agent puts what identifies the choice IN the
  // description (`domain/interactive.py::from_proposal`: the title is the
  // slot, the description is the clinic and the doctor), which is right for a
  // channel that renders lists and useless here.
  //
  // The result reached a beneficiary on 06/09 (atendimento 22348…): the bubble
  // numbered four clinics 1-4, and under it the platform's menu numbered ten
  // slots 1-10, each reading only `amanhã 07/09 · 08:00`. Two numbering systems
  // in one message, neither naming a place — and rows 1, 5 and 9 were the same
  // clinic while 1, 2, 3 were three different ones. Tapping "3" lands somewhere
  // other than the third thing the person read.
  //
  // With no URA the agent's own numbered text stands alone and coherent. It
  // loses a tap affordance that never worked and removes a menu that
  // contradicted the message it was attached to.
  if (!asButtons) return null;

  if (titles.length !== replyButtons.length || titles.some((t) => !t)) return null;
  // The tap comes back as the TITLE, so two titles that fold together are an
  // ambiguous choice — and shortening is exactly what can create that
  // collision. In scheduling it books the wrong person.
  if (new Set(titles.map(foldTitle)).size !== titles.length) return null;

  return {
    ura_opcoes: Object.fromEntries(titles.map((title, i) => [String(i + 1), title])),
    forcar_botoes: asButtons,
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
