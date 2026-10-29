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
import { encodeAscEmoji } from './emoji';

const MAX_OPTIONS = 10;
const MAX_BODY_TEXT = 1024;

/** `msg_interativa_parametros.tipo` — 1 is a list, 2 reply buttons, 3 a URL button, 5 a Meta WhatsApp Flow. */
const TIPO_LISTA = 1;
const TIPO_BOTOES = 2;
const TIPO_BOTAO_URL = 3;
const TIPO_FLUXO = 5;
/** Meta's limit for the CTA that opens a flow. */
const MAX_FLOW_CTA = 30;
/** Label on the button that opens the list, when the caller sets none. */
const LIST_BUTTON_LABEL = 'Opções';
/** Meta's limit for the list button text; a longer label falls back to the default. */
const MAX_LIST_BUTTON_LABEL = 20;

/** The caller's list button label when it fits Meta's limit, else the default. */
function listButtonLabelOf(label: string | undefined): string {
  const trimmed = label?.trim();
  return trimmed && trimmed.length <= MAX_LIST_BUTTON_LABEL ? trimmed : LIST_BUTTON_LABEL;
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
  listOptions: InteractiveListOptions & { buttonLabel?: string } = {},
): Record<string, unknown> | null {
  const trimmed = body.trim();
  if (!trimmed || trimmed.length > MAX_BODY_TEXT) return null;

  const replyButtons = (buttons ?? []).filter((b) => !b.url && b.text?.trim());
  const urlButtons = (buttons ?? []).filter((b) => b.url && b.text?.trim());
  const [soleUrl] = urlButtons;
  if (replyButtons.length === 0 && urlButtons.length === 1 && soleUrl) return buildUrlButton(trimmed, soleUrl);
  if (replyButtons.length === 0 || replyButtons.length > MAX_OPTIONS) return null;

  const buttonLabel = listButtonLabelOf(listOptions.buttonLabel);
  const plan = planInteractive(trimmed, replyButtons, buttonLabel, listOptions);
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
      texto_botao: (action?.button as string) || buttonLabel,
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

/**
 * `msg_interativa_parametros` for the platform's URL button (`tipo: 3`,
 * `url_button {texto_botao, url}`): Meta's `cta_url`, the one way a link rides
 * a button in session. It is the shape the SDK plans for a sole URL button, so
 * the label is cut where whatsapp-business and hermes cut it.
 *
 * The caller may also write the URL in the text, so that a plugin which still
 * drops URL buttons delivers the link anyway. A line that is only that link
 * (see `isLinkLine`) leaves the body here, where the button takes its place;
 * the bubble pushed when the platform refuses the button keeps it.
 */
function buildUrlButton(body: string, button: InteractiveButton): Record<string, unknown> | null {
  const url = button.url ?? '';
  const plan = planInteractive(body, [button], LIST_BUTTON_LABEL);
  const action = plan.interactive?.action as { parameters?: { display_text?: string } } | undefined;
  const label = action?.parameters?.display_text?.trim();
  const mensagem = body
    .split('\n')
    .filter((line) => !isLinkLine(line, button.text, url))
    .join('\n')
    .trim();
  if (!mensagem || !label) return null;

  // The body arrives already encoded (`resolveOutboundText`); the label comes
  // straight from the button, so it is encoded here. See `emoji.ts`.
  return { tipo: TIPO_BOTAO_URL, mensagem, url_button: { texto_botao: encodeAscEmoji(label), url } };
}

/**
 * A line the URL button replaces: the URL alone, or the button's label leading
 * into it (`Ver Política de Privacidade: <url>`, the `label: url` shape
 * `planInteractive` folds a URL button into). Any other line with the URL is
 * prose, and it stays whole: cutting it would drop what it says.
 */
function isLinkLine(line: string, label: string, url: string): boolean {
  const at = line.indexOf(url);
  if (at < 0) return false;
  let rest = `${line.slice(0, at)}${line.slice(at + url.length)}`.trim();
  if (rest.endsWith(':')) rest = rest.slice(0, -1).trim();
  return !rest || foldTitle(rest).startsWith(foldTitle(encodeAscEmoji(label)));
}

/**
 * The bubble pushed when the platform refuses the component. A URL button whose
 * bubble does not write its URL takes it along as `label: url`, the shape
 * `planInteractive` folds a URL button into, so the link still reaches the
 * handset. Every other component falls back to its bubble as it is.
 */
export function textFallbackOf(bubble: string, params: Record<string, unknown>): string {
  const button = params.url_button as { texto_botao?: string; url?: string } | undefined;
  if (params.tipo !== TIPO_BOTAO_URL || !button?.url || bubble.includes(button.url)) return bubble;
  return `${bubble}\n\n${button.texto_botao}: ${button.url}`;
}

/** The part of Omni's flow descriptor (`metadata.flow`) the ASC platform can carry. */
export interface AscFlowDescriptor {
  flowId?: string;
  cta?: string;
  bodyText?: string;
  headerText?: string;
  footerText?: string;
  data?: Record<string, unknown>;
}

/**
 * `msg_interativa_parametros` for a Meta WhatsApp Flow (`tipo: 5`) on
 * `POST /sendMsgInterativaAvancado`, from the descriptor the
 * `/instances/:id/whatsapp-flows/send` route puts in `metadata.flow`.
 *
 * The platform's schema (`interactive_flow`) is `{texto_botao, fluxo_id,
 * payload}`. `fluxo_id` passes through as the caller gave it, because the spec
 * does not say whether it is the platform's `FluxoWhatsapp.id` or the Meta id
 * (`cod_id_meta`). `payload` carries `data`, the first screen's input.
 *
 * Only `flowId` is supported: the platform has no field for a flow NAME, and
 * `screen`/`flowAction`/`draft` have no counterpart in its schema either.
 *
 * `null` means "send the bubble as plain text", the same contract as
 * `buildInteractive`: the text the caller wrote is the canonical path.
 */
export function buildFlowInteractive(
  body: string,
  flow: AscFlowDescriptor | undefined,
): Record<string, unknown> | null {
  const trimmed = body.trim();
  const flowId = flow?.flowId?.trim();
  const cta = flow?.cta?.trim();
  // The limit is Meta's, on what the handset shows, so it is checked before the
  // emoji become `##codepoint##` markers.
  if (!trimmed || trimmed.length > MAX_BODY_TEXT || !flowId || !cta || cta.length > MAX_FLOW_CTA) return null;

  // The body arrives already encoded (`resolveOutboundText`); these come
  // straight from the descriptor, so they are encoded here. See `emoji.ts`.
  return {
    tipo: TIPO_FLUXO,
    mensagem: trimmed,
    ...(flow?.headerText ? { cabecalho_tipo: 'text', cabecalho_texto: encodeAscEmoji(flow.headerText) } : {}),
    ...(flow?.footerText ? { rodape: encodeAscEmoji(flow.footerText) } : {}),
    fluxo: { texto_botao: encodeAscEmoji(cta), fluxo_id: flowId, payload: flow?.data ?? {} },
  };
}
