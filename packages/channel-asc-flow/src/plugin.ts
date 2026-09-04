/**
 * ASC platform Flow channel plugin.
 *
 * Not to be confused with `@omni/channel-asc`. That one talks to ASC's API
 * Gateway (`apigw.ascbrazil.com.br`), a mirror of the WhatsApp Cloud API — the
 * "BSP direct" model. This one is the model Hapvida chose: the conversation
 * lives inside a FLOW on the ASC platform, the flow CALLS us, and we answer
 * through the platform's REST API (`/rest/v2`). Different contracts end to end,
 * hence a separate package and a separate `ChannelType`.
 *
 *   WhatsApp → ASC (Flow) → api_rest node → Omni → agent
 *   → callbackFlowMsg (the bubbles BEFORE the last one) → the last bubble comes
 *     back in the HTTP BODY of the api_rest poll → transferirHumano when the
 *     turn hands off
 *
 * Rich content (media, location, contact card, real buttons/list) cannot ride
 * a string slot, so it goes through `POST /mensagem` instead — see
 * `utils/outbound.ts`. When that call delivers the last bubble, `resposta`
 * comes back EMPTY so the flow does not render the same bubble twice.
 *
 * POLL contract. The `api_rest` node consumes the HTTP RESPONSE BODY and maps it
 * into flow variables through its `store`; in async mode it re-calls this
 * endpoint until `async_condition` over that body is true. So the turn is a
 * STATE here, not a push:
 *
 *   1st call for a `cod_atendimento` → publish `message.received`, answer `{"pronto":0}`
 *   re-calls while the agent runs   → no republish (dedupe), answer `{"pronto":0}`
 *   agent answered (`sendMessage`)  → next call answers
 *       `{"pronto":1,"resposta":…,"hand_off":"sim|nao","bolhas":[…]}` and clears the turn
 *
 * Always HTTP 200. The flow is configured with `async = 1` and
 * `async_condition = {#BODY.pronto} = 1`.
 *
 * Turn boundary. One agent REPLY is one flow turn — not one `sendMessage`. A
 * turn's paragraphs (blank-line separated) become separate bubbles, which is
 * how the scheduling agent writes and what the adapter proved against the ASC
 * emulator. The bubbles before the last one are PUSHED through
 * `callbackFlowMsg` (with typing between them, for rhythm); the LAST one rides
 * back in `resposta`, which is the single slot the flow's `message` node
 * renders. The dispatcher does split one reply across several `sendMessage`
 * calls, so the parts before the last are HELD on the turn window and the last
 * one answers with all of them — see `collectTurnParts`.
 *
 * Handoff. Detected from `metadata.isHandoff` (the Gupshup precedent), not by
 * sniffing the agent's prose: the adapter only regex-matched the invitation
 * because it called the agent itself and had no metadata channel. Two of the
 * Genesys component's fourteen userdata fields are ours to fill — `fila_vq`
 * (destination queue) and `motivo_transf_vq` (reason) — and they ride in the
 * same response body, per HANDOFF-GENESYS.md. Where the handoff LANDS is
 * `ascFlowHandoffMode`, and the two destinations are exclusive: `flow` (default)
 * answers the poll and lets the flow reach the Genesys node, `service` calls
 * `/transferirHumano` and parks the atendimento in the ASC's own queue, which
 * stops the poll loop dead. `hand_off: "sim"` is never said on a handoff that
 * did not hold (see `utils/handoff.ts`), and the turn always answers rather
 * than leaving the beneficiary in silence.
 */

import { BaseChannelPlugin, createInboundDedupeCache, sanitizeMessage } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  DedupeCache,
  FetchHistoryOptions,
  FetchHistoryResult,
  InstanceConfig,
  InteractiveListOptions,
  OutgoingMessage,
  PluginContext,
  SendResult,
} from '@omni/channel-sdk';
import { type Logger, markdownToWhatsApp } from '@omni/core';
import type { ChannelType } from '@omni/core/types';

import { ASC_FLOW_CAPABILITIES } from './capabilities';
import { AscFlowClient } from './client';
import { type ParsedAscFlowTurn, handleAscFlowWebhookRequest } from './handlers/webhook';
import type { AscFlowConfig, AscFlowUra } from './types';
import { encodeAscEmoji } from './utils/emoji';
import { AscFlowApiError, AscFlowErrorCode, isRetryable } from './utils/errors';
import { type AscFlowHandoffMode, type HandoffPlan, planHandoff } from './utils/handoff';
import { buildUra, splitBubbles } from './utils/interactive';
import { isAscMediaFilename, mediaFallbackText, resolveAscInboundMedia } from './utils/media';
import { OUTBOUND_MEDIA_FALLBACK_TEXT, buildReplyField, buildRichFields, isRichContent } from './utils/outbound';

/** Platform default — the NotreDame tenant this channel was built against. */
export const DEFAULT_ASC_FLOW_BASE_URL = 'https://sac-notredame.ascbrazil.com.br';
/** The REST prefix every endpoint sits under. */
const REST_PREFIX = '/rest/v2';

/**
 * The body the `api_rest` node reads once the agent has answered. Field names
 * are the flow's variable names, so they stay snake_case/pt-BR.
 */
export interface AscFlowTurnReady {
  pronto: 1;
  resposta: string;
  hand_off: 'sim' | 'nao';
  bolhas: string[];
  fila_vq?: string;
  motivo_transf_vq?: string;
  ura_opcoes?: Record<string, string>;
  forcar_botoes?: boolean;
}

/** The body every call gets while the agent is still running. */
export const TURN_PENDING = { pronto: 0 } as const;

interface AscFlowTurnState {
  text: string;
  at: number;
  /**
   * The trace the inbound publish opened. The dispatcher threads it back on the
   * outgoing message, which makes it the only handle that says WHICH turn an
   * answer belongs to — object identity cannot, because an answer that outlived
   * its own window captures whatever window occupies the cod when it finally
   * sends.
   */
  correlationId?: string;
  /**
   * The parts of one agent reply that arrived before its last one. They ride
   * the window so they share its TTL and its identity — see `collectTurnParts`.
   */
  parts?: string[];
  /** Set by `sendMessage`; the next poll takes it and the turn is over. */
  ready?: AscFlowTurnReady;
}

interface AscFlowInstanceState {
  client: AscFlowClient;
  config: AscFlowConfig;
  dedupeCache: DedupeCache;
  /** `cod_atendimento` → the turn being answered. See `isRedeliveryOfTurnInFlight`. */
  inFlight: Map<string, AscFlowTurnState>;
  /** When `sweepInFlight` last ran, so it runs at most once per interval. */
  lastSweepAt: number;
}

/**
 * How long a turn stays open: both the deadline for delivering an answer and
 * the safety valve that releases a turn nobody answered (agent crash,
 * dispatcher drop) instead of wedging that `cod_atendimento` forever.
 *
 * 150s, sized against the two real ceilings rather than a round number:
 *
 *   - the `api_rest` node's own `timeout` — 180s on flow #225 — is the hard
 *     one. Past it the flow stops polling, so no answer is deliverable however
 *     long Omni holds it; releasing at 150s still reaches the flow before it
 *     gives up on its own.
 *   - the instance `agentTimeout` defaults to 600s (schema.ts:830), so the
 *     previous 60s silently dropped every legitimate 60–600s run. Measured
 *     agent latency on this deployment is p50 14.7s / p90 30.2s / max 42s, so
 *     150s carries ~3.5x headroom over the worst observed run.
 */
const IN_FLIGHT_TTL_MS = 150_000;

/** A text turn with no poll waiting reaches nobody — see `refuseUndeliverable`. */
const UNDELIVERABLE_ERROR = 'no ASC flow turn is polling this cod_atendimento — a text-only send cannot be delivered';

/** A handoff that never held must not read to the route as a completed one. */
const HANDOFF_REFUSED_ERROR = 'handoff refused: the transfer never held, so the turn answers without it';

/**
 * How often `inFlight` is swept for entries past the TTL.
 *
 * The TTL alone does NOT bound the map: it is only consulted when that exact
 * `cod_atendimento` is touched again, so an atendimento abandoned mid-turn —
 * the beneficiary walks away, the flow stops polling — leaves an entry that
 * nothing ever reads and nothing ever frees. At the Hapvida volume (80k
 * atendimentos/month ÷ 30 days ÷ 24h ≈ 111/hour) the LIVE set is ~2 entries
 * (111/hour over a 60s window), so everything above that is leak, and it only
 * came down on a restart.
 *
 * Sweeping bounds the map to what ARRIVES in one interval rather than to the
 * process lifetime. It is O(n) over a map the sweep itself keeps small, and it
 * rides the inbound path instead of a timer — one less handle to leak.
 */
const IN_FLIGHT_SWEEP_MS = 60_000;

/**
 * Hard ceiling on `inFlight`, independent of the sweep.
 *
 * The sweep bounds the map by arrival RATE; this bounds it by count, for a
 * burst that outruns one interval. 5.000 is ~45× the measured hourly arrival
 * rate — high enough never to evict a live turn, low enough to cap the channel
 * at a few MB of turn state no matter what the platform does.
 */
const IN_FLIGHT_MAX_ENTRIES = 5_000;

/**
 * Markdown → WhatsApp syntax, honoring the instance's `messageFormatMode`
 * (same contract as hermes/whatsapp-business/baileys). The far end of this
 * channel IS WhatsApp — the ASC flow delivers to the handset — so without this
 * the agent's `**bold**` arrives raw and WhatsApp pairs the asterisks wrong.
 * Measured on the live number 01/09.
 */
function resolveOutboundText(message: OutgoingMessage): string {
  const formatMode = (message.metadata?.messageFormatMode as 'convert' | 'passthrough') ?? 'convert';
  const text = message.content.text ?? message.content.caption ?? '';
  const formatted = formatMode === 'passthrough' ? text : markdownToWhatsApp(text);
  // The platform carries emoji only as `##codepoint##` markers — a raw `✅`
  // reached the handset as `?` (measured 01/09 on the session-cleared
  // confirmation). Encoding is the mirror of the inbound decode and runs even
  // in passthrough: it is transport, not formatting.
  return encodeAscEmoji(formatted);
}

/**
 * The message that answers the turn — or `null` while its earlier parts are
 * still being held.
 *
 * One agent reply reaches a channel as MANY `sendMessage` calls: the provider
 * splits it on blank lines (`agno-provider.ts`, `enableAutoSplit`) and the
 * dispatcher sends each part on its own. Every other channel just shows N
 * messages. Here the FIRST part answered the poll, the flow's next poll
 * collected it and closed the turn, and parts 2..N found nothing polling and
 * were refused as undeliverable — the beneficiary read one paragraph of three
 * and lost whatever the agent sent after the text. Measured on atendimento
 * 22325225: "Agno agent responded parts:3", then two undeliverable warnings.
 *
 * So the turn is the whole reply, not its first part. The dispatcher stamps
 * `partIndex`/`partCount`; the parts before the last are held and the last one
 * answers with all of them joined by a blank line — which `splitBubbles` turns
 * back into the same bubbles, with the URA on the last one.
 *
 * Holding is only ever done on a turn that is really being polled, and the
 * held parts live ON that window, so they inherit its TTL and its identity: a
 * window that closes mid-reply takes its held parts with it rather than
 * leaking them or answering the next turn. A part that arrives with no window
 * falls through to the usual undeliverable refusal, unchanged.
 */
function collectTurnParts(message: OutgoingMessage, turn: AscFlowTurnState | undefined): OutgoingMessage | null {
  const meta = message.metadata ?? {};
  const partCount = Number(meta.partCount ?? 1);
  const partIndex = Number(meta.partIndex ?? 0);
  // Nothing to collect: no turn to hold on to, a send that stands alone, or a
  // hint that is not a hint (NaN fails both comparisons). Rich content never
  // takes this path — it leaves through `/mensagem` and needs no poll.
  if (!turn || message.content.type !== 'text' || !(partCount > 1) || !(partIndex >= 0)) return message;

  const part = message.content.text ?? '';
  if (partIndex < partCount - 1) {
    turn.parts = [...(turn.parts ?? []), part];
    return null;
  }

  const text = [...(turn.parts ?? []), part].join('\n\n');
  turn.parts = undefined;
  return { ...message, content: { ...message.content, text } };
}

/** The list presentation hints `buildUra` accepts, when the caller set any. */
function listOptionsOf(content: OutgoingMessage['content']): InteractiveListOptions {
  return {
    ...(content.list?.sectionTitle !== undefined ? { sectionTitle: content.list.sectionTitle } : {}),
    ...(content.list?.forceList !== undefined ? { forceList: content.list.forceList } : {}),
  };
}

/** `cod_atendimento` is numeric on the wire; the chat id is its string form. */
function toCodAtendimento(chatId: string): number {
  // Must be digits END TO END: `parseInt` would happily read a JID like
  // "5551999@s.whatsapp.net" as 5551999 and address the wrong atendimento.
  if (!/^\d+$/.test(chatId.trim())) {
    throw new AscFlowApiError(
      AscFlowErrorCode.INVALID_REQUEST,
      `chat id "${chatId}" is not an ASC cod_atendimento (expected digits)`,
    );
  }
  return Number(chatId.trim());
}

/** Base URL with the `/rest/v2` prefix appended when the operator omitted it. */
export function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  return trimmed.endsWith(REST_PREFIX) ? trimmed : `${trimmed}${REST_PREFIX}`;
}

/**
 * The poll body for an answered turn.
 *
 * `resposta` is EMPTY when `/mensagem` already put the last bubble on the
 * handset — the flow's message node renders this slot, so a non-empty one would
 * show the same bubble twice. A refused `/mensagem` with no caption would leave
 * the turn silent, so it says so instead of nothing.
 */
function buildReadyBody(turn: {
  delivered: boolean;
  lastBubble: string;
  bubbles: string[];
  handoff: HandoffPlan['fields'] | null;
  ura: AscFlowUra | null;
}): AscFlowTurnReady {
  return {
    pronto: 1,
    resposta: turn.delivered ? '' : turn.lastBubble || OUTBOUND_MEDIA_FALLBACK_TEXT,
    hand_off: turn.handoff ? 'sim' : 'nao',
    bolhas: turn.bubbles,
    ...(turn.handoff ?? {}),
    ...(turn.ura ?? {}),
  };
}

export class AscFlowPlugin extends BaseChannelPlugin {
  readonly id = 'asc-flow' as ChannelType;
  readonly name = 'ASC Platform Flow';
  readonly version = '1.0.0';
  readonly capabilities: ChannelCapabilities = ASC_FLOW_CAPABILITIES;

  private ascFlowInstances = new Map<string, AscFlowInstanceState>();

  // ─────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────

  protected override async onInitialize(_context: PluginContext): Promise<void> {
    this.logger.info('ASC Flow plugin initialized');
  }

  protected override async onDestroy(): Promise<void> {
    for (const [, state] of this.ascFlowInstances) {
      state.dedupeCache.dispose();
    }
    this.ascFlowInstances.clear();
    this.logger.info('ASC Flow plugin destroyed');
  }

  // ─────────────────────────────────────────────────────────────
  // Connection
  // ─────────────────────────────────────────────────────────────

  async connect(instanceId: string, config: InstanceConfig): Promise<void> {
    const creds = config.credentials ?? {};
    const opts = config.options ?? {};
    const pick = (key: string): unknown => creds[key] ?? opts[key];

    const baseUrl = normalizeBaseUrl((pick('ascFlowBaseUrl') as string | undefined) ?? DEFAULT_ASC_FLOW_BASE_URL);
    const login = pick('ascFlowLogin') as string | undefined;
    const chave = pick('ascFlowChave') as string | undefined;
    const handoffServico = Number(pick('ascFlowHandoffServico') ?? 0);
    // `flow` is the default because it is the measured-correct path for the
    // Genesys/WDE destination; `service` is opt-in for the ASC's own queue.
    const handoffMode: AscFlowHandoffMode = pick('ascFlowHandoffMode') === 'service' ? 'service' : 'flow';
    const webhookVerifyToken = pick('webhookVerifyToken') as string | undefined;

    if (!login) throw new AscFlowApiError(AscFlowErrorCode.AUTH_FAILED, 'ascFlowLogin is required');
    if (!chave) throw new AscFlowApiError(AscFlowErrorCode.AUTH_FAILED, 'ascFlowChave is required');

    this.logger.info('Connecting ASC Flow instance', { instanceId, baseUrl });

    const client = new AscFlowClient(baseUrl, login, chave, this.logger);
    // Authenticating here is the credential check: `/authuser` is the only
    // endpoint that does not need an existing atendimento to exercise.
    await client.getToken(true);

    const ascFlowConfig: AscFlowConfig = {
      ascFlowBaseUrl: baseUrl,
      ascFlowLogin: login,
      ascFlowChave: chave,
      ascFlowHandoffMode: handoffMode,
      ascFlowHandoffServico: Number.isFinite(handoffServico) ? handoffServico : 0,
      webhookVerifyToken,
    };

    // A reconnect (instance-monitor restart, credential change) calls connect on
    // an instance that already has state. Overwriting it stranded the previous
    // dedupe cache's cleanup interval, which then ran for the life of the
    // process holding its whole map — one leaked timer per restart.
    this.ascFlowInstances.get(instanceId)?.dedupeCache.dispose();

    this.ascFlowInstances.set(instanceId, {
      client,
      config: ascFlowConfig,
      dedupeCache: createInboundDedupeCache(),
      inFlight: new Map(),
      lastSweepAt: Date.now(),
    });

    await this.updateInstanceStatus(instanceId, config, {
      state: 'connected',
      since: new Date(),
      message: 'Connected to the ASC platform REST API',
    });

    await this.emitInstanceConnected(instanceId, {
      profileName: 'ASC Flow',
      ownerIdentifier: login,
    });

    this.logger.info('ASC Flow instance connected', { instanceId, baseUrl });
  }

  async disconnect(instanceId: string): Promise<void> {
    this.logger.info('Disconnecting ASC Flow instance', { instanceId });

    const state = this.ascFlowInstances.get(instanceId);
    if (state) {
      state.dedupeCache.dispose();
      this.ascFlowInstances.delete(instanceId);
    }

    this.instances.setInstance(instanceId, {} as InstanceConfig, {
      state: 'disconnected',
      since: new Date(),
      message: 'Disconnected',
    });

    await this.emitInstanceDisconnected(instanceId, 'Manual disconnect');
  }

  // ─────────────────────────────────────────────────────────────
  // Outbound
  // ─────────────────────────────────────────────────────────────

  /** `POST /sendIndicador` — the "digitando…" bubble. */
  async sendTyping(instanceId: string, chatId: string, _duration?: number): Promise<void> {
    const state = this.ascFlowInstances.get(instanceId);
    if (!state) return;
    try {
      await state.client.call('/sendIndicador', { cod: toCodAtendimento(chatId), tipo: 1 });
    } catch (err) {
      // A typing indicator is never worth failing a turn over.
      this.logger.warn('[asc-flow] sendIndicador failed', { instanceId, chatId, err: String(err) });
    }
  }

  async sendMessage(instanceId: string, message: OutgoingMessage): Promise<SendResult> {
    const state = this.ascFlowInstances.get(instanceId);
    if (!state) {
      return { success: false, error: 'ASC Flow instance not connected', retryable: false, timestamp: Date.now() };
    }

    const { to } = message;
    const meta = message.metadata ?? {};

    const correlationId = meta.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      const cod = toCodAtendimento(to);
      // The turn this send ANSWERS, captured before anything awaits.
      //
      // Identity, not just presence: `resolveTurn` compares this exact object
      // later, so an answer that arrives after its own window closed cannot be
      // written into the NEXT turn's window (which delivered turn A's answer as
      // the reply to message B, and lost B's own answer behind the text gate).
      //
      // A ghost — the `{text:''}` entry a proactive send parks — is not a turn:
      // no poll is waiting on it and its body can never pass `takeReadyTurn`'s
      // text gate, so counting it as "polling" is what let an undeliverable
      // text send report success.
      const answering = state.inFlight.get(to.trim());
      const polling = answering !== undefined && answering.text !== '';

      // One agent reply, many sends. Hold every part but the last so ONE turn
      // answers with all of them — see `collectTurnParts`. A held part reached
      // nobody yet and produced no message, hence no id: the dispatcher does
      // not read this result, and nothing else stamps the hint.
      const turnMessage = collectTurnParts(message, polling ? answering : undefined);
      if (!turnMessage) return { success: true, timestamp: Date.now() };

      const content = turnMessage.content;
      const text = resolveOutboundText(turnMessage);

      const { rich, bubbles } = await this.prepareTurn(turnMessage, text);

      // The URA rides on the LAST bubble — the options attach to the last thing
      // the beneficiary read, and that bubble is the one that goes back in
      // `resposta`. The fields go BOTH ways: in the poll body (for a flow with
      // a URA node) and on the `/mensagem` that delivers that bubble (which is
      // what actually renders buttons today).
      const lastBubble = bubbles[bubbles.length - 1] ?? '';
      const ura = rich ? null : buildUra(lastBubble, content.buttons, listOptionsOf(content));

      // Refuse BEFORE anything reaches the handset. `deliver` pushes every
      // bubble but the last through `/callbackFlowMsg` — a real delivery, not a
      // parked one — so refusing afterwards reported total failure on a turn
      // whose first paragraphs had already landed, and the operator's resend
      // then duplicated them. Rich content and interactives go out through
      // `/mensagem`, which needs no poll; a plain-text turn is delivered ONLY by
      // being collected from the poll body.
      if (!rich && !ura && !polling) return this.refuseUndeliverable(instanceId, to, content.type);

      const { delivered } = await this.deliver(state, cod, {
        text,
        bubbles,
        lastBubble,
        rich,
        ura,
        message: turnMessage,
      });

      // The farewell only needs pushing when `/mensagem` did not already put it
      // on the handset (`delivered`); in flow mode it rides `resposta` as usual.
      const handoff =
        meta.isHandoff === true
          ? await this.runHandoff(state, instanceId, cod, meta, delivered ? '' : lastBubble)
          : null;
      // A handoff that did not hold must not read as one. `hand_off:'nao'` is
      // already the honest poll body, but reporting success let the route answer
      // `201 {status:'sent'}`, write a `handoffLogs` row implying the transfer
      // happened, and disarm the follow-ups that would have revisited the chat.
      const handoffRefused = meta.isHandoff === true && handoff === null;

      this.resolveTurn(
        state,
        to,
        buildReadyBody({ delivered, lastBubble, bubbles, handoff, ura }),
        answering,
        correlationId,
      );

      if (handoffRefused) return this.refuseSend(instanceId, to, HANDOFF_REFUSED_ERROR);

      if (correlationId) this.captureT11(correlationId);

      // The platform returns no per-message id, so Omni's UUID stays canonical.
      const messageId = crypto.randomUUID();

      await this.emitTurnSent(instanceId, turnMessage, messageId, {
        cod,
        bubbles: bubbles.length,
        ura,
        delivered,
        handoff: handoff !== null,
      });

      return {
        success: true,
        messageId,
        timestamp: Date.now(),
        // Pause the agent only when the beneficiary really did leave the bot.
        //
        // In `flow` mode they never do here: the handoff is a ROUTE inside the
        // still-running flow, and they only leave at the `genesys_mobile_service`
        // node. Pausing stops the dispatcher from answering the next turn, and a
        // turn nobody answers is a turn nobody resolves — the measured deadlock
        // on atendimento 22289496.
        //
        // In `service` mode `/transferirHumano` does park the atendimento in a
        // human queue — but only when it is ACCEPTED. A refusal (`handoff` null)
        // leaves the atendimento in "Automático" with the flow still polling, so
        // pausing there recreates the same deadlock with nobody on the way.
        pauseAgent: state.config.ascFlowHandoffMode === 'service' && handoff !== null,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const retryable = isRetryable(error);

      await this.emitMessageFailed({ instanceId, chatId: to, error: errorMessage, retryable });

      // The window is LEFT IN PLACE. Flows POST without a `messageId`, so this
      // entry is the only redelivery marker there is: dropping it made the
      // api_rest node's next ~2s re-POST look like a brand-new turn, which
      // republished `message.received`, re-ran the agent, and failed identically
      // — roughly `180s ÷ agent-latency` billed runs for one user message when
      // the failure is deterministic (a whitespace-only reply throwing
      // 'refusing to send an empty turn'). Leaving it absorbs the re-polls and
      // releases once at the TTL.

      return { success: false, error: errorMessage, retryable, timestamp: Date.now() };
    }
  }

  /** `message.sent` for a turn that was delivered or parked for the poll. */
  private async emitTurnSent(
    instanceId: string,
    message: OutgoingMessage,
    messageId: string,
    turn: { cod: number; bubbles: number; ura: AscFlowUra | null; delivered: boolean; handoff: boolean },
  ): Promise<void> {
    const { content, to } = message;
    await this.emitMessageSent({
      instanceId,
      externalId: messageId,
      chatId: to,
      to,
      content: {
        type: content.type as import('@omni/core/types').ContentType,
        text: content.text,
      },
      replyToId: message.replyTo,
      rawPayload: {
        ascFlow: {
          codAtendimento: turn.cod,
          bubbles: turn.bubbles,
          interactive: turn.ura ? (turn.ura.forcar_botoes ? 'buttons' : 'list') : 'text',
          uraOptions: turn.ura ? Object.keys(turn.ura.ura_opcoes).length : 0,
          /** Rich content left through `/mensagem` rather than the poll body. */
          viaMensagem: turn.delivered,
          handoff: turn.handoff,
        },
      },
      senderAgentId: message.metadata?.senderAgentId as string | undefined,
    });
  }

  /**
   * Report a send that reached nothing and never will: `/mensagem` was not used
   * (or was refused) and no poll is waiting to collect `resposta`.
   *
   * Reporting success here is what let proactive sends — a follow-up sweep, or
   * a recipient `resolveRecipient` resolved to a bare phone rather than a
   * `cod_atendimento` — persist messages the beneficiary never received.
   */
  private async refuseUndeliverable(instanceId: string, to: string, type: string): Promise<SendResult> {
    this.logger.warn('[asc-flow] refusing an undeliverable send', { instanceId, to, type });
    return this.refuseSend(instanceId, to, UNDELIVERABLE_ERROR);
  }

  /** Report a send as failed, so the caller never records it as delivered. */
  private async refuseSend(instanceId: string, to: string, error: string): Promise<SendResult> {
    await this.emitMessageFailed({ instanceId, chatId: to, error, retryable: false });
    return { success: false, error, retryable: false, timestamp: Date.now() };
  }

  /**
   * Hand the atendimento to a human, through whichever of the two EXCLUSIVE
   * destinations this instance is configured for, and report whether it holds.
   *
   * In `flow` mode there is NO platform call: `/transferirHumano` takes the
   * atendimento out of "Automático", which kills the poll loop — measured on
   * atendimento 22286567 — and a dead flow never reaches the Genesys node. The
   * fields in the poll body ARE the handoff there.
   *
   * In `service` mode the call still gates the answer. `null` is the only
   * honest answer to a refusal: `hand_off: 'sim'` is what routes the flow, so
   * saying it on a transfer that never landed leaves the beneficiary reading
   * "vou te transferir" with nobody on the way. Both failure modes — an input
   * that never should have been dialed (`planHandoff`) and a platform refusal —
   * degrade here rather than throwing: the turn still answers, like every other
   * best-effort call in this channel.
   *
   * `farewell` is PUSHED before a `service`-mode transfer rather than parked.
   * An accepted `/transferirHumano` ends the poll loop (measured on atendimento
   * 22286567: one event after the call, then nothing), so a goodbye left in
   * `resposta` waits for a poll that never comes — and `msgTransferencia:false`
   * suppresses the platform's own notice too, which put the beneficiary in a
   * human queue with no word at all while Omni recorded the message as sent.
   */
  private async runHandoff(
    state: AscFlowInstanceState,
    instanceId: string,
    cod: number,
    meta: Record<string, unknown>,
    farewell: string,
  ): Promise<HandoffPlan['fields'] | null> {
    const plan = planHandoff(state.config.ascFlowHandoffMode, meta, state.config.ascFlowHandoffServico, this.logger);
    if (!plan) return null;
    if (!plan.transfer) return plan.fields;

    if (farewell.trim()) {
      try {
        await state.client.call('/callbackFlowMsg', {
          cod_atendimento: cod,
          sendMsg: 1,
          msg_usuario: farewell,
          entrante: 0,
        });
      } catch (err) {
        // Best-effort: a missed goodbye must not cost the transfer.
        this.logger.warn('[asc-flow] could not push the handoff farewell before transferring', {
          cod,
          err: String(err),
        });
      }
    }

    try {
      await state.client.call('/transferirHumano', {
        cod,
        cod_servico: plan.transfer.codServico,
        cod_prioridade: plan.transfer.codPrioridade,
        msgTransferencia: false,
      });
      return plan.fields;
    } catch (err) {
      this.logger.warn('[asc-flow] transferirHumano refused; turn answers without handoff', {
        instanceId,
        cod,
        err: String(err),
      });
      return null;
    }
  }

  /**
   * Park the answer on the turn. The next `api_rest` poll takes it, which is
   * what makes `{#BODY.pronto} = 1` fire and the flow advance.
   *
   * A parked handoff is never overwritten by an ordinary answer. In `flow` mode
   * the handoff leaves `agentPaused` false, so the dispatcher's suppression gate
   * does not trip and it still sends the agent's remaining parts after the tool
   * returns. That second `sendMessage` used to replace the `hand_off:'sim'`
   * body with a `hand_off:'nao'` one, and if the ~2s poll had not collected in
   * between, the flow read "no handoff" and never reached the Genesys node —
   * silently, which is the worst way to lose a transfer. The bubble that guard
   * displaces is PUSHED rather than dropped — the agent's leading bubbles are
   * already on the handset by then, so discarding the last one left the
   * beneficiary reading half a paragraph.
   *
   * `answering` is the turn this answer belongs to, by identity. A late answer
   * whose own window already closed must not be written into whatever window
   * happens to occupy the cod now: that delivered turn A's answer as the reply
   * to message B, and left B's own answer parked where no poll could ever
   * collect it.
   */
  private resolveTurn(
    state: AscFlowInstanceState,
    chatId: string,
    ready: AscFlowTurnReady,
    answering?: AscFlowTurnState,
    correlationId?: string,
  ): void {
    const cod = chatId.trim();
    const entry = state.inFlight.get(cod);

    // The trace is the strongest signal: an answer carries the correlationId of
    // the turn that asked for it, so a mismatch is proof this body belongs to a
    // turn that already closed — the case identity alone cannot catch, since a
    // late send captures whatever window occupies the cod by then.
    if (entry?.correlationId && correlationId && entry.correlationId !== correlationId) {
      this.logger.warn('[asc-flow] discarding an answer from a different turn', {
        cod,
        reason: 'correlationId does not match the turn now in flight',
      });
      return;
    }

    if (entry && answering && entry !== answering) {
      this.logger.warn('[asc-flow] discarding an answer whose turn already closed', {
        cod,
        reason: 'the window now holds a newer turn — delivering this would answer the wrong message',
      });
      return;
    }
    // A proactive send (no turn of its own) must not resolve someone else's
    // turn: its content already left through `/mensagem`, and writing an empty
    // `resposta` here would close a turn the agent is still answering.
    if (entry && !answering) {
      this.logger.debug('[asc-flow] proactive send leaves the in-flight turn alone', { cod });
      return;
    }

    if (entry) {
      if (entry.ready?.hand_off === 'sim' && ready.hand_off !== 'sim') {
        this.logger.debug('[asc-flow] keeping the parked handoff over a later ordinary answer', { cod });
        this.pushDisplacedBubble(state, cod, ready.resposta);
        return;
      }
      entry.ready = ready;
      entry.at = Date.now();
      return;
    }
    // An outbound with no inbound turn in flight (a proactive send): still park
    // it, so a poll that arrives for this cod collects it.
    state.inFlight.set(cod, { text: '', at: Date.now(), ready });
  }

  /**
   * Deliver a bubble the poll body can no longer carry.
   *
   * Used when the parked-handoff guard keeps an earlier body: the displaced
   * `resposta` still belongs on the handset, and `/callbackFlowMsg` is the one
   * path that puts it there without touching the turn. Best-effort and
   * fire-and-forget — the handoff must not wait on it.
   */
  private pushDisplacedBubble(state: AscFlowInstanceState, cod: string, text: string): void {
    if (!text.trim()) return;
    void state.client
      .call('/callbackFlowMsg', { cod_atendimento: Number(cod), sendMsg: 1, msg_usuario: text, entrante: 0 })
      .catch((err) => {
        this.logger.warn('[asc-flow] could not push the bubble displaced by the handoff', { cod, err: String(err) });
      });
  }

  /**
   * Split the turn into bubbles and resolve whatever rich fields it carries.
   *
   * Media, location and contact cannot ride the poll body (it carries a
   * string), so they leave through `/mensagem`; a failure to build their
   * fields degrades to text, and a file with no caption degrades to a line
   * saying so rather than to a silent turn.
   */
  private async prepareTurn(
    message: OutgoingMessage,
    text: string,
  ): Promise<{ rich: Record<string, unknown> | null; bubbles: string[] }> {
    const isRich = isRichContent(message.content);
    const rich = isRich ? await buildRichFields(message, this.logger) : null;
    const bubbles = splitBubbles(text);

    if (bubbles.length > 0) return { rich, bubbles };
    if (isRich && !rich) return { rich, bubbles: [OUTBOUND_MEDIA_FALLBACK_TEXT] };
    if (rich) return { rich, bubbles };
    throw new AscFlowApiError(AscFlowErrorCode.INVALID_REQUEST, 'refusing to send an empty turn');
  }

  /**
   * Put the turn on the handset and report whether the LAST bubble already
   * went out through `/mensagem`. When it did, `resposta` must go back empty:
   * the flow's message node renders it, and a non-empty one would show the
   * same bubble twice.
   */
  private async deliver(
    state: AscFlowInstanceState,
    cod: number,
    turn: {
      text: string;
      bubbles: string[];
      lastBubble: string;
      rich: Record<string, unknown> | null;
      ura: AscFlowUra | null;
      message: OutgoingMessage;
    },
  ): Promise<{ delivered: boolean }> {
    const reply = buildReplyField(turn.message.replyTo);

    // One `/mensagem` carries the file/pin/card plus its caption.
    if (turn.rich) {
      return { delivered: await this.sendMensagem(state, cod, turn.text, { ...turn.rich, ...reply }) };
    }

    // Everything except the last bubble is PUSHED now, so the handset shows the
    // turn with rhythm while the flow is still polling. Best-effort: a refused
    // push must not cost the beneficiary the answer, which is the canonical one
    // in `resposta`.
    await this.pushLeadingBubbles(state, cod, turn.bubbles);

    // The URA rides in the poll body too, but that only renders once the flow
    // has a URA node consuming it. `/mensagem` is the endpoint that injects
    // real buttons/list into the running atendimento, so the last bubble goes
    // out there as well — the numbered text it carries stays the canonical
    // fallback either way.
    if (turn.ura) {
      return { delivered: await this.sendMensagem(state, cod, turn.lastBubble, { ...turn.ura, ...reply }) };
    }
    return { delivered: false };
  }

  /**
   * `POST /mensagem` — the only endpoint that injects rich content (file, pin,
   * contact card, URA) into a running atendimento. Best-effort like the leading
   * bubbles: `false` means the caller must fall back to `resposta`, never that
   * the turn fails.
   */
  private async sendMensagem(
    state: AscFlowInstanceState,
    cod: number,
    text: string,
    extra: Record<string, unknown>,
  ): Promise<boolean> {
    try {
      await state.client.call('/mensagem', {
        cod,
        mensagem: text,
        entrante: 0,
        bolFlow: true,
        ...extra,
      });
      return true;
    } catch (err) {
      this.logger.warn('[asc-flow] /mensagem refused — degrading to the text turn', {
        cod,
        fields: Object.keys(extra),
        err: String(err),
      });
      return false;
    }
  }

  /**
   * Every bubble EXCEPT the last one, in order, with typing after each so the
   * next one lands with a beat (the first typing was raised on the inbound
   * path). The last bubble is not pushed — it goes back in `resposta`.
   *
   * Best-effort: a push refused by the platform must not cost the beneficiary
   * the answer, which the flow will render from `resposta` anyway. Stop at the
   * first failure — the remaining bubbles would arrive out of order.
   */
  private async pushLeadingBubbles(state: AscFlowInstanceState, cod: number, bubbles: string[]): Promise<void> {
    for (const bubble of bubbles.slice(0, -1)) {
      try {
        await state.client.call('/callbackFlowMsg', {
          cod_atendimento: cod,
          sendMsg: 1,
          msg_usuario: bubble,
          entrante: 0,
        });
        await state.client.call('/sendIndicador', { cod, tipo: 1 });
      } catch (err) {
        this.logger.warn('[asc-flow] leading bubble push failed — degrading to resposta', {
          cod,
          err: String(err),
        });
        return;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Inbound
  // ─────────────────────────────────────────────────────────────

  async handleWebhook(request: Request): Promise<Response> {
    const url = new URL(request.url);
    // /api/v2/channels/asc-flow/{instanceId}/webhook
    const pathParts = url.pathname.split('/');
    const instanceId = pathParts[pathParts.indexOf('asc-flow') + 1] ?? '';

    const state = this.ascFlowInstances.get(instanceId);
    if (!state) {
      return new Response('Instance not found', { status: 404 });
    }

    return handleAscFlowWebhookRequest(request, this, instanceId, state.config.webhookVerifyToken, state.dedupeCache);
  }

  /**
   * Publish one inbound turn. The chat id is the `cod_atendimento` — the flow's
   * own conversation identity, and the only handle every outbound endpoint
   * accepts. The phone, when the flow supplies it, is the sender identity.
   */
  async handleInboundTurn(instanceId: string, turn: ParsedAscFlowTurn): Promise<void> {
    const sanitized = sanitizeMessage(turn.text, this.logger, { instanceId, messageId: turn.messageId });
    if (!sanitized.ok) return;

    // Open the in-flight window BEFORE anything awaits: the flow re-POSTs every
    // ~2s while it waits, and those re-POSTs must find the mark already set.
    const inboundState = this.ascFlowInstances.get(instanceId);
    if (inboundState) {
      this.sweepInFlight(instanceId, inboundState);
      inboundState.inFlight.set(turn.codAtendimento, { text: turn.text, at: Date.now() });
    }

    // Raise "digitando…" as soon as the turn lands: the agent run is the slow
    // part, and the beneficiary is already waiting.
    await this.sendTyping(instanceId, turn.codAtendimento);

    const externalId = turn.messageId ?? crypto.randomUUID();

    // Media arrives as a FILE NAME in `chatInput`; the bytes live on the
    // atendimento. Only a name-shaped input pays for that fetch — see
    // `utils/media.ts`. A failed resolution degrades to a short text so the
    // agent gets something it can answer instead of the raw file name.
    const isMediaName = isAscMediaFilename(turn.text);
    const client = this.ascFlowInstances.get(instanceId)?.client;
    const media =
      isMediaName && client
        ? await resolveAscInboundMedia({
            client,
            instanceId,
            codAtendimento: turn.codAtendimento,
            filename: turn.text,
            externalId,
            logger: this.logger,
          })
        : null;

    const timings = this.captureInboundTimings(Date.now());
    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId,
      chatId: turn.codAtendimento,
      from: turn.phone || turn.codAtendimento,
      content: media
        ? {
            type: media.type,
            mimeType: media.mimeType,
            localPath: media.localPath,
            // `mediaUrl` is what the dispatcher filters on to decide a message
            // is media worth waiting for (`collectProcessedMedia`, gated by the
            // instance's `agentWaitForMedia`). With only `localPath` the file
            // persisted and was transcribed/described fine, but the agent was
            // called BEFORE that finished and skipped the turn as "no text or
            // media content" — measured on the live number 01/09. The bytes are
            // already local, so the path doubles as the URL.
            mediaUrl: media.localPath,
          }
        : {
            type: 'text' as import('@omni/core/types').ContentType,
            text: isMediaName ? mediaFallbackText(turn.text) : sanitized.text,
          },
      rawPayload: {
        ascFlow: {
          codAtendimento: turn.codAtendimento,
          hasPhone: Boolean(turn.phone),
          ...(isMediaName ? { mediaFilename: turn.text, mediaResolved: Boolean(media) } : {}),
        },
        ...(media ? { mediaLocalPath: media.localPath } : {}),
      },
      timings,
    });

    // Stamp the trace on the turn — but only if this is still the same window.
    // A slow publish can be overtaken by the beneficiary's next message, and
    // labelling THAT turn with this trace would defeat the correlation.
    const stamped = this.ascFlowInstances.get(instanceId)?.inFlight.get(turn.codAtendimento);
    if (stamped && stamped.text === turn.text && !stamped.correlationId) stamped.correlationId = correlationId;

    if (timings) this.captureT2(correlationId, timings);
  }

  // ─────────────────────────────────────────────────────────────
  // Internal helpers (used by the webhook handler)
  // ─────────────────────────────────────────────────────────────

  getLogger(): Logger {
    return this.logger;
  }

  /**
   * Drop turn windows nothing will ever collect, so `inFlight` stays bounded by
   * arrival rate rather than by process lifetime.
   *
   * An entry is freed by the poll that takes its answer. When the flow stops
   * polling — the beneficiary walked away, the atendimento was closed on the
   * platform side — nothing ever touches that key again and its per-key TTL is
   * never consulted. Over a month of Hapvida volume that is the whole leak.
   *
   * Runs on the inbound path (throttled), not on a timer: a timer is a handle
   * to leak on every reconnect, and there is nothing to sweep while no turns
   * are arriving anyway.
   */
  private sweepInFlight(instanceId: string, state: AscFlowInstanceState): void {
    const now = Date.now();
    if (now - state.lastSweepAt < IN_FLIGHT_SWEEP_MS && state.inFlight.size < IN_FLIGHT_MAX_ENTRIES) return;
    state.lastSweepAt = now;

    let expired = 0;
    for (const [cod, entry] of state.inFlight) {
      if (now - entry.at > IN_FLIGHT_TTL_MS) {
        state.inFlight.delete(cod);
        expired++;
      }
    }

    // A burst that outran one sweep interval: evict oldest-first until the map
    // is back under the ceiling. Only reachable when live turns really are
    // arriving faster than they resolve, and dropping the oldest is the same
    // outcome its TTL was about to produce.
    let evicted = 0;
    if (state.inFlight.size > IN_FLIGHT_MAX_ENTRIES) {
      const oldestFirst = [...state.inFlight.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [cod] of oldestFirst.slice(0, state.inFlight.size - IN_FLIGHT_MAX_ENTRIES)) {
        state.inFlight.delete(cod);
        evicted++;
      }
    }

    if (expired || evicted) {
      this.logger.debug('[asc-flow] swept the turn window', {
        instanceId,
        expired,
        evicted,
        remaining: state.inFlight.size,
      });
    }
  }

  /**
   * The answer parked by `sendMessage`, if the agent already produced one for
   * this `cod_atendimento` — or, past the TTL, the empty body that releases a
   * turn nobody answered. Taking either CLOSES the turn: the next call with the
   * same text is a genuinely new one.
   *
   * `text` is the `chatInput` the flow just POSTed, and it GATES the take. An
   * answer belongs to the turn that asked for it: the poll re-sends the same
   * `chatInput` until it collects, so a match is the re-poll and a mismatch is
   * the beneficiary saying something new. Without the gate a parked body (a
   * proactive send parks one under `text: ''`, and any answer outlives its poll
   * by up to the TTL) was handed to that new message and `handleInboundTurn`
   * was never reached — the message vanished with nothing logged.
   */
  takeReadyTurn(instanceId: string, codAtendimento: string, text: string): AscFlowTurnReady | null {
    const state = this.ascFlowInstances.get(instanceId);
    const entry = state?.inFlight.get(codAtendimento);
    if (!state || !entry) return null;

    // A new message: leave the entry alone. It is not consumed here and not
    // treated as a redelivery either (`isRedeliveryOfTurnInFlight` compares the
    // same way), so the turn publishes and overwrites the stale window.
    if (entry.text !== text) return null;

    const ageMs = Date.now() - entry.at;

    // Nobody resolved this turn. `sendMessage` is the ONLY thing that does, and
    // the dispatcher can skip it for reasons this channel never hears about
    // (agent paused, reply filter, unresolved route, dispatch error). Leaving
    // the mark set makes the dedupe drop every re-poll for the same text, so
    // the flow polls forever and the beneficiary reads nothing — measured on
    // atendimento 22289496. Release the flow instead: `pronto:1` with an empty
    // `resposta` is the same shape a `/mensagem`-delivered turn answers with,
    // so the message node renders nothing and the flow moves on to wait for the
    // next input. A real answer is never lost to this — `entry.ready` is
    // checked first, and a late `sendMessage` re-parks its answer for the next
    // poll.
    if (!entry.ready) {
      if (ageMs <= IN_FLIGHT_TTL_MS) return null;
      state.inFlight.delete(codAtendimento);
      this.logger.warn('[asc-flow] no agent answer for this turn — releasing the flow empty', {
        instanceId,
        codAtendimento,
        ageMs,
        reason: 'no sendMessage resolved the turn (agent paused, filtered or not dispatched)',
      });
      return { pronto: 1, resposta: '', hand_off: 'nao', bolhas: [] };
    }

    state.inFlight.delete(codAtendimento);
    // Past the TTL the answer is handed over anyway. The text already matched,
    // so this IS the answer to the question being asked, and the alternative —
    // dropping it — left no entry behind for `isRedeliveryOfTurnInFlight` to
    // recognise, so the very same POST republished the turn: a second billed
    // agent run and a duplicate bubble on the handset.
    if (ageMs > IN_FLIGHT_TTL_MS) {
      this.logger.warn('[asc-flow] answering with a turn the flow was slow to collect', {
        instanceId,
        codAtendimento,
        ageMs,
      });
    }
    return entry.ready;
  }

  /**
   * True when this exact turn is the platform re-POSTing a delivery we are
   * still answering.
   *
   * The flow's `api_rest` node in async mode re-calls the webhook every ~2s
   * until `callbackFlow` releases the step — one measured user message produced
   * ~22 POSTs, so the agent ran (and was billed) three times for one turn. The
   * key is `codAtendimento` + the exact text, scoped to the window between the
   * publish and the `sendMessage` that resumes the flow. That window is what
   * keeps a legitimately repeated answer ("1" twice in a two-step menu) alive:
   * the second "1" arrives after the first turn was answered, so the mark is
   * already gone and it publishes normally.
   */
  isRedeliveryOfTurnInFlight(instanceId: string, turn: ParsedAscFlowTurn): boolean {
    const state = this.ascFlowInstances.get(instanceId);
    const entry = state?.inFlight.get(turn.codAtendimento);
    if (!state || !entry) return false;

    if (Date.now() - entry.at > IN_FLIGHT_TTL_MS) {
      state.inFlight.delete(turn.codAtendimento);
      return false;
    }
    if (entry.text !== turn.text) return false;

    this.logger.debug('[asc-flow] dropping webhook re-delivery: turn still in flight', {
      instanceId,
      codAtendimento: turn.codAtendimento,
      ageMs: Date.now() - entry.at,
      reason: 'async api_rest re-poll',
    });
    return true;
  }

  // ─────────────────────────────────────────────────────────────
  // History (not supported — the platform exposes no transcript API)
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }
}
