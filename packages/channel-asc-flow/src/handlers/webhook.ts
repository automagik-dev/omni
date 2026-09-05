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
import { decodeAscEmoji } from '../utils/emoji';

/**
 * How long the inbound request is held waiting for the agent's answer.
 *
 * Under the `api_rest` node's own `timeout` (180s on flow #225) so the platform
 * never gives up on a request we are still holding, and above the measured
 * agent latency (p50 14.7s / p90 30.2s / max 42s).
 *
 * `ASC_FLOW_HOLD_MS=0` turns the hold off and restores the pure poll contract.
 * Read per CALL, not at module load: the suite sets it from `helpers.ts`, and a
 * constant would freeze whatever the value was when the module first imported —
 * which import order decides, not the test.
 */
const holdTimeoutMs = () => Number(process.env.ASC_FLOW_HOLD_MS ?? 120_000);

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
  /** The text came from the frozen `message` fallback, not from `chatInput`. */
  fromFallback: boolean;
  phone: string;
  messageId?: string;
}

/**
 * Normalise the flow node's body into a turn, or `null` when the mandatory
 * pair (`codAtendimento` + `chatInput`) is missing.
 */
export function parseInboundTurn(body: AscFlowInboundBody): ParsedAscFlowTurn | null {
  const codAtendimento = firstString(body.codAtendimento, body.cod_atendimento);
  // `chatInput` is what the beneficiary just typed; `message` is the flow's
  // fallback, and on flow #225 that is `{#MENSAGEM}` — which stays FROZEN on
  // the message that opened the atendimento. Keeping them apart is what lets
  // the handler use the fallback ONLY to open a conversation, never to
  // republish the opening text on every loop (measured: a 🗑️ that opened the
  // atendimento came back ~10s after each real turn and reset the session
  // mid-conversation, on 22329234 and 22330067).
  const typed = decodeAscEmoji(firstString(body.chatInput));
  const fallback = decodeAscEmoji(firstString(body.message));
  const text = typed || fallback;
  if (!codAtendimento || !text) return null;

  const messageId = firstString(body.messageId, body.idMensagem);
  return {
    codAtendimento,
    text,
    fromFallback: !typed,
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

  // Optional shared secret. Once a token IS configured it is mandatory: a
  // missing one is rejected exactly like a wrong one. Accepting the absence
  // made the check bypassable by simply not sending it — and this route is
  // mounted auth-exempt, so anyone holding the instance UUID could inject
  // turns (billed agent runs) and drain parked answers.
  if (verifyToken) {
    const supplied = new URL(request.url).searchParams.get('token') ?? request.headers.get('x-webhook-token');
    if (supplied !== verifyToken) {
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
  // else — and taking it closes the turn. The TEXT is handed along: an answer
  // belongs to the turn that asked for it, and a parked body must never be
  // spent on a genuinely new message (which would swallow it silently).
  const ready = plugin.takeReadyTurn(instanceId, turn.codAtendimento, turn.text);
  if (ready) {
    return json(ready);
  }

  // A body whose `chatInput` is EMPTY is the flow looping back, not the
  // beneficiary speaking: the only text it carries is the frozen fallback. It
  // may OPEN a conversation (the first call legitimately has no `chatInput`
  // yet), but once this cod has been seen it is a poll and nothing more.
  if (turn.fromFallback && plugin.hasSeenCod(instanceId, turn.codAtendimento)) {
    logger.debug('[asc-flow] loop-back with no chatInput — treating as a poll', {
      instanceId,
      codAtendimento: turn.codAtendimento,
    });
    return pending();
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

  // HOLD the request until the agent answers, instead of returning `pronto:0`
  // and trusting the node to poll again.
  //
  // Measured on flow #225 (atendimentos 22327328 and 22327711): the node is
  // configured `async=1` with `async_condition = {#BODY.pronto} = 1`, and the
  // platform's own Requisições report shows it receiving `pronto:1` with the
  // answer filled — yet the flow rendered `{#resposta}` from the PREVIOUS
  // cycle, one turn late. Whatever the node does with the condition, it does
  // not wait for it.
  //
  // Answering the FIRST call with the finished turn removes the question: the
  // condition holds on the only response there is. It works the same if the
  // node is switched to synchronous, so the flow needs no edit either way.
  // The deadline sits under the node's own `timeout` (180s), and falling back
  // to `pronto:0` keeps the old polling behaviour for anything slower.
  const holdMs = holdTimeoutMs();
  if (holdMs <= 0) return pending();
  const held = await plugin.waitForTurn(instanceId, turn.codAtendimento, turn.text, holdMs);
  return held ? json(held) : pending();
}
