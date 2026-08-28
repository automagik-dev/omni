/**
 * Inbound handler for the ASC platform Flow channel.
 *
 * The flow's `api_rest` node POSTs here. Its request body is FREE TEXT authored
 * in the flow designer, so the field names are our contract, not the vendor's:
 * `codAtendimento` + `chatInput`, optionally `phone` and `messageId`. The
 * snake_case aliases are accepted because flows written by the client's team
 * spell variables that way.
 *
 * Route: `POST /api/v2/channels/asc-flow/:instanceId/webhook` (mounted by
 * `@omni/api`, the Gupshup/Hermes per-instance precedent). The platform
 * documents no payload signature — authenticity rests on the unguessable
 * instance id in the path plus an OPTIONAL verify token when one is configured
 * on the instance.
 *
 * Dedupe: the platform assigns no per-turn message id. When the flow supplies
 * one (`messageId`) it feeds the SDK dedupe cache; without it every delivery is
 * treated as new. That is deliberate — synthesising an id from the text would
 * make a legitimately repeated answer ("1" twice in a two-step menu) vanish.
 *
 * Always answers 200 to a processable-shaped request: a permanent 4xx would
 * only make the flow re-deliver the same unprocessable payload.
 */

import type { DedupeCache } from '@omni/channel-sdk';

import type { AscFlowPlugin } from '../plugin';
import type { AscFlowInboundBody } from '../types';

/** The flow node posts a small JSON object; 64 KB is generous headroom. */
const MAX_BODY_BYTES = 64 * 1024;

function firstString(...values: Array<string | number | undefined>): string {
  for (const value of values) {
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

export interface ParsedAscFlowTurn {
  codAtendimento: string;
  text: string;
  phone: string;
  messageId?: string;
}

/**
 * Normalise the flow node's body into a turn, or `null` when the mandatory
 * pair (`codAtendimento` + `chatInput`) is missing.
 */
export function parseInboundTurn(body: AscFlowInboundBody): ParsedAscFlowTurn | null {
  const codAtendimento = firstString(body.codAtendimento, body.cod_atendimento);
  const text = firstString(body.chatInput, body.message);
  if (!codAtendimento || !text) return null;

  const messageId = firstString(body.messageId, body.idMensagem);
  return {
    codAtendimento,
    text,
    phone: firstString(body.phone, body.telefone),
    ...(messageId ? { messageId } : {}),
  };
}

/**
 * Full HTTP entry point used by `plugin.handleWebhook`.
 */
export async function handleAscFlowWebhookRequest(
  request: Request,
  plugin: AscFlowPlugin,
  instanceId: string,
  verifyToken: string | undefined,
  dedupeCache: DedupeCache,
): Promise<Response> {
  const logger = plugin.getLogger();

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  // Optional shared secret — only rejects when a token is configured AND the
  // request carries a mismatching one, so a flow that has not been updated to
  // echo it keeps working.
  if (verifyToken) {
    const supplied = new URL(request.url).searchParams.get('token') ?? request.headers.get('x-webhook-token');
    if (supplied !== null && supplied !== verifyToken) {
      logger.warn('[asc-flow] webhook token mismatch — rejecting', { instanceId });
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch (err) {
    logger.warn('[asc-flow] failed to read webhook body', { instanceId, err: String(err) });
    return new Response('OK', { status: 200 });
  }

  if (raw.length > MAX_BODY_BYTES) {
    logger.warn('[asc-flow] oversized webhook body rejected', { instanceId, size: raw.length });
    return new Response('OK', { status: 200 });
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    logger.warn('[asc-flow] webhook body is not valid JSON', { instanceId });
    return new Response('OK', { status: 200 });
  }

  if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
    logger.warn('[asc-flow] webhook body is not a JSON object', { instanceId });
    return new Response('OK', { status: 200 });
  }

  const turn = parseInboundTurn(parsedJson as AscFlowInboundBody);
  if (!turn) {
    logger.warn('[asc-flow] webhook missing codAtendimento or chatInput', { instanceId });
    return new Response('OK', { status: 200 });
  }

  if (turn.messageId && dedupeCache.isDuplicate(instanceId, turn.messageId, 'asc-flow', logger)) {
    return new Response('OK', { status: 200 });
  }

  await plugin.handleInboundTurn(instanceId, turn);
  return new Response('OK', { status: 200 });
}
