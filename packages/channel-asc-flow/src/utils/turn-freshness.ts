/**
 * Telling a beneficiary who repeats themselves from a flow that restarted.
 *
 * The flow's `aguarda_usuario` node has its own timeout — 10s on flow #225 —
 * and its timeout edge ENDS the atendimento (`fin_1`). The next message the
 * beneficiary sends therefore restarts the flow from `start`, and the restart
 * re-enters `api_rest` carrying the PREVIOUS value of the input variable,
 * because that variable is only written once `aguarda_usuario` validates the
 * new input. Measured on atendimento 22342225 (05/09):
 *
 *   14:46:19  turn answered; aguarda_usuario waits 10s, times out, ends
 *   14:52:46  beneficiary sends "quero falar com um atendente humano"
 *   14:52:53  api_rest calls us with chatInput "🗑️"  ← the 14:46 value
 *   14:53:31  api_rest finally calls with the real text, 45s later
 *
 * The stale call is indistinguishable from a genuine repeat by its shape
 * alone: both carry a `chatInput` equal to the text of the previous turn.
 * ("1" twice in a two-step menu is a real pair of answers, and the suite
 * pins that.) What separates them is whether the PLATFORM recorded a new
 * inbound message — so on that one ambiguous path, and only there, the
 * atendimento is asked.
 *
 * Fails OPEN: any trouble reaching the platform means the turn is processed
 * as usual. Dropping a real message costs the beneficiary their turn; letting
 * a stale one through costs a repeated answer, which is the lesser harm.
 */

import type { Logger } from '@omni/core';

import type { AscFlowClient } from '../client';
import { decodeAscEmoji } from './emoji';

interface AscAtendimentoMessage {
  descricao_msg?: string | null;
  boleano_entrante?: string | number;
}

/**
 * The text of the newest INBOUND message the platform holds for this
 * atendimento, or `null` when it cannot be read.
 */
async function latestInboundText(client: AscFlowClient, codAtendimento: string): Promise<string | null> {
  const { status, body } = await client.get('/atendimento', { codigo_atendimento: codAtendimento });
  if (status !== 200 || typeof body !== 'object' || body === null) return null;

  const list = (body as Record<string, unknown>).mensagens;
  if (!Array.isArray(list)) return null;

  // Newest last, so walk backwards to the first inbound with text of its own.
  // Media rows carry a null `descricao_msg` and are skipped rather than read
  // as an empty message.
  for (const raw of [...(list as AscAtendimentoMessage[])].reverse()) {
    if (String(raw.boleano_entrante ?? '') !== '1') continue;
    const text = decodeAscEmoji(String(raw.descricao_msg ?? '').trim());
    if (text) return text;
  }
  return null;
}

/**
 * Whether this inbound is the flow replaying a stale variable rather than the
 * beneficiary speaking.
 *
 * Only ever called when `text` repeats the last turn we answered for this
 * `cod` — every other inbound skips the platform round trip entirely.
 */
export async function isStaleFlowReplay(params: {
  client: AscFlowClient;
  instanceId: string;
  codAtendimento: string;
  text: string;
  logger: Logger;
}): Promise<boolean> {
  const { client, instanceId, codAtendimento, text, logger } = params;

  let latest: string | null;
  try {
    latest = await latestInboundText(client, codAtendimento);
  } catch (err) {
    logger.warn('[asc-flow] could not read the atendimento to date this turn — processing it', {
      instanceId,
      codAtendimento,
      err: String(err),
    });
    return false;
  }

  if (latest === null) return false;
  if (latest === text.trim()) return false;

  logger.info('[asc-flow] flow restarted with a stale input variable — dropping the replay', {
    instanceId,
    codAtendimento,
  });
  return true;
}
