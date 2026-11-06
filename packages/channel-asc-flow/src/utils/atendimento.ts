/**
 * The messages the platform holds for one atendimento (`GET /atendimento`), and
 * what a WhatsApp "Reply" on one of OUR bubbles quoted.
 *
 * The flow body carries only what the beneficiary typed. The reply lives on the
 * platform record: the inbound row's `id_mensagem_resposta` points at the row
 * it quoted. Measured on production atendimentos 23906969 and 23946532
 * (06/11/2026, omni#1617):
 *
 *   - the webhook `messageId` IS the inbound row's `id_mensagem` (15 of 15);
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

/** `mensagens` of the atendimento, oldest first, or `null` when it cannot be read. */
export async function atendimentoMessages(
  client: AscFlowClient,
  codAtendimento: string,
): Promise<AscAtendimentoMessage[] | null> {
  const { status, body } = await client.get('/atendimento', { codigo_atendimento: codAtendimento });
  if (status !== 200 || typeof body !== 'object' || body === null) return null;
  const list = (body as Record<string, unknown>).mensagens;
  return Array.isArray(list) ? (list as AscAtendimentoMessage[]) : null;
}

export interface AscQuotedBubble {
  /** The quoted row's `id_mensagem`. */
  externalId: string;
  /** Its text, emoji decoded — what the beneficiary saw. */
  text: string;
}

/**
 * The text bubble of OURS that the inbound `messageId` replied to, or `null`:
 * not a reply, a reply to the beneficiary's own message, a tap on an
 * interactive message, or a row without text.
 */
export function quotedBubbleOf(messages: AscAtendimentoMessage[], messageId: string): AscQuotedBubble | null {
  const inbound = messages.find((m) => String(m.id_mensagem ?? '') === messageId);
  const target = String(inbound?.id_mensagem_resposta ?? '').trim();
  if (!target || target === '0') return null;

  const quoted = messages.find((m) => String(m.id_mensagem ?? '') === target);
  if (!quoted) return null;
  if (String(quoted.boleano_entrante ?? '') !== '0' || String(quoted.tip_msg ?? '') !== 'TEXTO') return null;

  const text = decodeAscEmoji(String(quoted.descricao_msg ?? '').trim());
  return text ? { externalId: target, text } : null;
}
