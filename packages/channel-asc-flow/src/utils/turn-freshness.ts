/**
 * The second half of telling a re-sent input from a real turn.
 *
 * The first half is free and lives in the handler: on a real turn the body's
 * two fields agree, on a re-send they do not (see `entradaDefasada`). That
 * covers every re-send whose stale `{#entrada}` differs from the frozen
 * `{#MENSAGEM}` — which is most of them.
 *
 * It cannot cover the one where they are the SAME text. Measured on 22344480:
 *
 *   23:20:54  chatInput 🗑️  message 🗑️   the beneficiary really sent it
 *   23:21:11  chatInput 🗑️  message 🗑️   the flow sent it back
 *
 * Byte-identical bodies. The 🗑️ opened the cycle, so it is both the current
 * input and the frozen message, and the re-send reset the session in the
 * middle of an identification.
 *
 * Here the platform's own record IS the discriminator: by 23:21:11 its latest
 * inbound was already the CPF the beneficiary had typed at 23:21:01. So this
 * check runs ONLY on that narrow path — fields agreeing on a text we already
 * answered — and the common turn never pays for it.
 *
 * Fails OPEN: any trouble reaching the platform means the turn is processed as
 * usual. Dropping a real message costs the beneficiary their turn; letting a
 * re-send through costs a repeated answer.
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
