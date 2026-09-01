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
 * Dedupe: the platform assigns no per-turn message id, and in async mode the
 * `api_rest` node re-POSTs every ~2s until `async_condition` holds — one
 * measured user message produced ~22 calls and three agent runs. So dedupe
 * is ON by default: `messageId` when the flow supplies one (SDK cache),
 * otherwise `codAtendimento` + exact text scoped to the in-flight window
 * (`plugin.isRedeliveryOfTurnInFlight`). Scoping to the window — instead of a
 * lasting hash of the text — is what keeps a legitimately repeated answer
 * ("1" twice in a two-step menu) alive.
 *
 * Response contract (POLL). The `api_rest` node maps the RESPONSE BODY into
 * flow variables through its `store`, and in async mode re-calls until
 * `async_condition` over that body holds. So every call answers JSON:
 *
 *   `{"pronto":0}`  — turn accepted / still running / body unprocessable
 *   `{"pronto":1,"resposta":"…","hand_off":"sim|nao","bolhas":["…"]}`
 *                   — the agent answered; the turn is cleared by this call
 *
 * Always HTTP 200 for a processable-shaped request: a permanent 4xx would only
 * make the flow re-deliver the same unprocessable payload, and a non-200 in
 * async mode stalls the node instead of letting it poll again.
 */

import type { DedupeCache } from '@omni/channel-sdk';

import { type AscFlowPlugin, TURN_PENDING } from '../plugin';
import type { AscFlowInboundBody } from '../types';

/** The flow node posts a small JSON object; 64 KB is generous headroom. */
const MAX_BODY_BYTES = 64 * 1024;

/** Every answer the flow can consume is JSON with a `pronto` field. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Nothing to hand back yet — keep polling. */
const pending = () => json(TURN_PENDING);

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
    return pending();
  }

  if (raw.length > MAX_BODY_BYTES) {
    logger.warn('[asc-flow] oversized webhook body rejected', { instanceId, size: raw.length });
    return pending();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    logger.warn('[asc-flow] webhook body is not valid JSON', { instanceId });
    return pending();
  }

  if (typeof parsedJson !== 'object' || parsedJson === null || Array.isArray(parsedJson)) {
    logger.warn('[asc-flow] webhook body is not a JSON object', { instanceId });
    return pending();
  }

  const turn = parseInboundTurn(parsedJson as AscFlowInboundBody);
  if (!turn) {
    logger.warn('[asc-flow] webhook missing codAtendimento or chatInput', { instanceId });
    return pending();
  }

  // The agent may already have answered a turn for this atendimento. That
  // answer is what the flow is polling FOR, so it is checked before anything
  // else — and taking it closes the turn.
  const ready = plugin.takeReadyTurn(instanceId, turn.codAtendimento);
  if (ready) {
    return json(ready);
  }

  // `messageId` wins when the flow supplies one (60s SDK cache). Otherwise fall
  // back to the in-flight window, which is the REAL case: the flow body we
  // author carries no message id.
  const isRedelivery = turn.messageId
    ? dedupeCache.isDuplicate(instanceId, turn.messageId, 'asc-flow', logger)
    : plugin.isRedeliveryOfTurnInFlight(instanceId, turn);
  if (isRedelivery) {
    return pending();
  }

  await plugin.handleInboundTurn(instanceId, turn);
  return pending();
}
