/**
 * Map Omni's channel-agnostic `content.buttons` onto the ASC platform's
 * interactive message (`msg_interativa_parametros` on
 * `POST /sendMsgInterativaAvancado`).
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

const MAX_OPTIONS = 10;
const MAX_BODY_TEXT = 1024;

/** `msg_interativa_parametros.tipo` — 1 is a list, 2 reply buttons. */
const TIPO_LISTA = 1;
const TIPO_BOTOES = 2;
/** Label on the button that opens the list, when the caller sets none. */
const LIST_BUTTON_LABEL = 'Opções';

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

/**
 * `msg_interativa_parametros` for `POST /sendMsgInterativaAvancado` — the
 * endpoint that renders a REAL WhatsApp interactive message, with a
 * description under every row.
 *
 * This is the one the channel should use. The URA fields on `/mensagem`
 * (`buildUra` above) are a flat `{ordinal: label}` map with nowhere to put a
 * description, so a proposal arrived on the handset reading
 *
 *     1 - amanhã 07/09 · 08:00
 *     2 - amanhã 07/09 · 19:00
 *
 * naming no clinic, while the agent had put the clinic and the doctor in the
 * row description. Probed against the live platform 06/09: `ura_descricoes`
 * is ignored, an object-shaped option is not delivered, and a `\n` in a title
 * flattens the whole bubble to plain text. `/sendMsgInterativaAvancado` has
 * the field:
 *
 *     {"rowId": "0_0", "title": "amanhã 07/09 · 08:00",
 *      "description": "Teleconsulta · Dr. Francisco Assis"}
 *
 * Two platform quirks, both measured, both load-bearing:
 *   - the body is FORM-encoded, not JSON (see `client.callForm`);
 *   - `envio_direto` is refused for this type ("Nao e possivel utilizar envio
 *     direto para esse tipo de mensagem"), so it is never sent.
 *
 * The tap still comes back as the row TEXT, so the same shaping rules apply
 * and `null` still means "send the bubble as plain text".
 */
export function buildInteractive(
  body: string,
  buttons: InteractiveButton[] | undefined,
  listOptions: InteractiveListOptions = {},
): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_BODY_TEXT) return null;

  const replyButtons = (buttons ?? []).filter((b) => !b.url && b.text?.trim());
  if (replyButtons.length === 0 || replyButtons.length > MAX_OPTIONS) return null;

  const plan = planInteractive(trimmed, replyButtons, LIST_BUTTON_LABEL, listOptions);
  if (!plan.interactive || plan.droppedRows > 0) return null;

  const type = plan.interactive.type;
  if (type !== 'button' && type !== 'list') return null;

  const titles = titlesOf(plan.interactive);
  if (titles.length !== replyButtons.length || titles.some((t) => !t)) return null;
  // The tap comes back as the row text: two titles that fold together are an
  // ambiguous choice, and in scheduling that books the wrong appointment.
  if (new Set(titles.map(foldTitle)).size !== titles.length) return null;

  if (type === 'button') {
    return { tipo: TIPO_BOTOES, mensagem: trimmed, button: titles };
  }

  const action = plan.interactive.action as Record<string, unknown> | undefined;
  const sections = (action?.sections ?? []) as Array<{
    title?: string;
    rows?: Array<{ title?: string; description?: string }>;
  }>;
  const rows = sections[0]?.rows ?? [];

  return {
    tipo: TIPO_LISTA,
    mensagem: trimmed,
    list: {
      texto_botao: (action?.button as string) || LIST_BUTTON_LABEL,
      secao: [
        {
          texto: sections[0]?.title ?? '',
          linhas: rows.map((row) => ({
            texto: row.title ?? '',
            // Empty rather than absent: the platform reads the key either way,
            // and a row with no description is a row, not a failure.
            descricao: row.description ?? '',
          })),
        },
      ],
    },
  };
}
