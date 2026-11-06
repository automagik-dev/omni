/**
 * The messages the platform holds for one atendimento (`GET /atendimento`), and
 * what a WhatsApp "Reply" on one of OUR bubbles quoted.
 *
 * The flow body carries only what the beneficiary typed. The reply lives on the
 * platform record: the inbound row's `id_mensagem_resposta` points at the row
 * it quoted. Measured on two production atendimentos (06/11/2026, omni#1617):
 *
 *   - the webhook `messageId` IS the inbound row's `id_mensagem`;
 *   - every button/list tap ALSO carries `id_mensagem_resposta`, pointing at
 *     the interactive message (`tip_msg` 15, body with the button labels) —
 *     a quote there would prepend our menu to every tap;
 *   - a real Reply on a text bubble points at a `tip_msg` "TEXTO" row of ours
 *     (`boleano_entrante` 0), emoji encoded as `##1f4c5##`.
 */

import type { AscFlowClient } from '../client';
import { decodeAscEmoji } from './emoji';

export interface AscAtendimentoMessage {
  id_mensagem?: string | number;
  id_mensagem_resposta?: string | number | null;
  descricao_msg?: string | null;
  boleano_entrante?: string | number;
  tip_msg?: string | number;
}

export interface AscAtendimentoRead {
  /** `mensagens`, oldest first, without the entries that are not objects. */
  messages: AscAtendimentoMessage[];
  /** Size of the response body: the atendimento carries every attachment inline as base64. */
  bytes: number;
}

/** The atendimento's messages, or `null` when it cannot be read. `signal` cancels the request. */
export async function atendimentoMessages(
  client: AscFlowClient,
  codAtendimento: string,
  signal?: AbortSignal,
): Promise<AscAtendimentoRead | null> {
  const { status, body, bytes } = await client.get('/atendimento', { codigo_atendimento: codAtendimento }, signal);
  if (status !== 200 || typeof body !== 'object' || body === null) return null;
  const list = (body as Record<string, unknown>).mensagens;
  if (!Array.isArray(list)) return null;
  const messages = list.filter((m): m is AscAtendimentoMessage => typeof m === 'object' && m !== null);
  return { messages, bytes: bytes ?? 0 };
}

export interface AscQuotedBubble {
  /** The quoted row's `id_mensagem`. */
  externalId: string;
  /** Its text, emoji decoded — what the beneficiary saw. */
  text: string;
}

/**
 * What the quoted-reply lookup found, recorded on the inbound event as
 * `rawPayload.ascFlow.quotedReply`:
 *
 *   `quoted`        our text bubble, passed to the agent
 *   `none`          the turn is not a reply (or the quoted row has no text)
 *   `tap`           the reply points at an interactive message (a button/list tap)
 *   `own`           the reply quotes a message that is not outbound
 *   `row-missing`   the inbound row, or the row it quotes, is not in the atendimento
 *   `timeout`       the read did not answer within `ASC_FLOW_QUOTE_LOOKUP_MS`
 *   `error`         the read failed or the atendimento could not be parsed
 *   `no-message-id` the flow body carried no `messageId`, so nothing can be looked up
 *   `off`           the lookup is disabled (`ASC_FLOW_QUOTE_LOOKUP_MS <= 0`)
 */
export type QuotedReplyOutcome =
  | 'quoted'
  | 'none'
  | 'tap'
  | 'own'
  | 'row-missing'
  | 'timeout'
  | 'error'
  | 'no-message-id'
  | 'off';

export type QuotedReply =
  | { outcome: 'quoted'; bubble: AscQuotedBubble }
  | { outcome: Exclude<QuotedReplyOutcome, 'quoted'> };

/** What the inbound `messageId` replied to, read from the atendimento's messages. */
export function quotedReplyOf(messages: AscAtendimentoMessage[], messageId: string): QuotedReply {
  const byId = (id: string) => messages.find((m) => String(m.id_mensagem ?? '') === id);
  const inbound = byId(messageId);
  if (!inbound) return { outcome: 'row-missing' };
  const target = String(inbound.id_mensagem_resposta ?? '').trim();
  if (!target || target === '0') return { outcome: 'none' };

  const quoted = byId(target);
  if (!quoted) return { outcome: 'row-missing' };
  if (String(quoted.boleano_entrante ?? '') !== '0') return { outcome: 'own' };
  if (String(quoted.tip_msg ?? '') !== 'TEXTO') return { outcome: 'tap' };

  const text = decodeAscEmoji(String(quoted.descricao_msg ?? '').trim());
  return text ? { outcome: 'quoted', bubble: { externalId: target, text } } : { outcome: 'none' };
}
