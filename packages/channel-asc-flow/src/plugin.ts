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
 * Turn boundary. One `sendMessage` is one flow turn. A turn's paragraphs
 * (blank-line separated) become separate bubbles, which is how the scheduling
 * agent writes and what the adapter proved against the ASC emulator. The
 * bubbles before the last one are PUSHED through `callbackFlowMsg` (with typing
 * between them, for rhythm); the LAST one rides back in `resposta`, which is
 * the single slot the flow's `message` node renders.
 * ponytail: if an agent ever emits two `sendMessage` calls for one user turn,
 * the flow advances twice. Upgrade path is a per-`cod` turn buffer flushed on
 * an end-of-turn signal — not built until a dispatcher actually does that.
 *
 * Handoff. Detected from `metadata.isHandoff` (the Gupshup precedent), not by
 * sniffing the agent's prose: the adapter only regex-matched the invitation
 * because it called the agent itself and had no metadata channel. Two of the
 * Genesys component's fourteen userdata fields are ours to fill — `fila_vq`
 * (destination queue) and `motivo_transf_vq` (reason) — and they ride in the
 * same response body, per HANDOFF-GENESYS.md.
 */

import { BaseChannelPlugin, createInboundDedupeCache, sanitizeMessage } from '@omni/channel-sdk';
import type {
  ChannelCapabilities,
  DedupeCache,
  FetchHistoryOptions,
  FetchHistoryResult,
  InstanceConfig,
  OutgoingMessage,
  PluginContext,
  SendResult,
} from '@omni/channel-sdk';
import { type Logger, markdownToWhatsApp } from '@omni/core';
import type { ChannelType } from '@omni/core/types';

import { ASC_FLOW_CAPABILITIES } from './capabilities';
import { AscFlowClient } from './client';
import { type ParsedAscFlowTurn, handleAscFlowWebhookRequest } from './handlers/webhook';
import type { AscFlowConfig } from './types';
import { encodeAscEmoji } from './utils/emoji';
import { AscFlowApiError, AscFlowErrorCode, isRetryable } from './utils/errors';
import { buildUra, splitBubbles } from './utils/interactive';
import { isAscMediaFilename, mediaFallbackText, resolveAscInboundMedia } from './utils/media';

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
  /** Set by `sendMessage`; the next poll takes it and the turn is over. */
  ready?: AscFlowTurnReady;
}

interface AscFlowInstanceState {
  client: AscFlowClient;
  config: AscFlowConfig;
  dedupeCache: DedupeCache;
  /** `cod_atendimento` → the turn being answered. See `isRedeliveryOfTurnInFlight`. */
  inFlight: Map<string, AscFlowTurnState>;
}

/**
 * Safety valve for the turn window: if a turn never produces a `sendMessage`
 * (agent crash, dispatcher drop), or the flow stops polling before it collects
 * the answer, the entry would otherwise wedge that `cod_atendimento` forever.
 * Far longer than any agent run, far shorter than a human's next answer to the
 * same menu.
 */
const IN_FLIGHT_TTL_MS = 60_000;

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
      ascFlowHandoffServico: Number.isFinite(handoffServico) ? handoffServico : 0,
      webhookVerifyToken,
    };

    this.ascFlowInstances.set(instanceId, {
      client,
      config: ascFlowConfig,
      dedupeCache: createInboundDedupeCache(),
      inFlight: new Map(),
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

    const { content, to } = message;
    const meta = message.metadata ?? {};
    const text = resolveOutboundText(message);

    const correlationId = meta.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      const cod = toCodAtendimento(to);
      const bubbles = splitBubbles(text);
      if (bubbles.length === 0) {
        throw new AscFlowApiError(AscFlowErrorCode.INVALID_REQUEST, 'refusing to send an empty turn');
      }

      // The URA rides on the LAST bubble — the options attach to the last thing
      // the beneficiary read, and that bubble is the one that goes back in
      // `resposta`.
      // ponytail: the api_rest node's return only becomes flow VARIABLES, so
      // these fields render as an interactive component only once the flow has
      // a URA node that consumes them; until then the options are the numbered
      // text the agent already writes into the bubble. Same ceiling the adapter
      // ships with. Upgrade path: a URA node in the flow, no code change here.
      const lastBubble = bubbles[bubbles.length - 1] as string;
      const ura = buildUra(lastBubble, content.buttons, {
        ...(content.list?.sectionTitle !== undefined ? { sectionTitle: content.list.sectionTitle } : {}),
        ...(content.list?.forceList !== undefined ? { forceList: content.list.forceList } : {}),
      });

      // Everything except the last bubble is PUSHED now, so the handset shows
      // the turn with rhythm while the flow is still polling. Best-effort: a
      // refused push must not cost the beneficiary the answer, which is the
      // canonical one in `resposta`.
      await this.pushLeadingBubbles(state, cod, bubbles);

      const isHandoff = meta.isHandoff === true;

      if (isHandoff) {
        await state.client.call('/transferirHumano', {
          cod,
          cod_servico: Number(meta.handoffServico ?? state.config.ascFlowHandoffServico),
          cod_prioridade: Number(meta.handoffPriority ?? 0),
          msgTransferencia: false,
        });
      }

      this.resolveTurn(state, to, {
        pronto: 1,
        resposta: lastBubble,
        hand_off: isHandoff ? 'sim' : 'nao',
        bolhas: bubbles,
        ...this.buildHandoffFields(isHandoff, meta),
        ...(ura ?? {}),
      });

      if (correlationId) this.captureT11(correlationId);

      // The platform returns no per-message id, so Omni's UUID stays canonical.
      const messageId = crypto.randomUUID();

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
            codAtendimento: cod,
            bubbles: bubbles.length,
            interactive: ura ? (ura.forcar_botoes ? 'buttons' : 'list') : 'text',
            uraOptions: ura ? Object.keys(ura.ura_opcoes).length : 0,
            handoff: isHandoff,
          },
        },
        senderAgentId: meta.senderAgentId as string | undefined,
      });

      return { success: true, messageId, timestamp: Date.now() };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const retryable = isRetryable(error);

      await this.emitMessageFailed({ instanceId, chatId: to, error: errorMessage, retryable });

      // No answer will ever be collected for this turn: drop the window so the
      // beneficiary's NEXT message is published even when it repeats the text.
      state.inFlight.delete(to.trim());

      return { success: false, error: errorMessage, retryable, timestamp: Date.now() };
    }
  }

  /**
   * Park the answer on the turn. The next `api_rest` poll takes it, which is
   * what makes `{#BODY.pronto} = 1` fire and the flow advance.
   */
  private resolveTurn(state: AscFlowInstanceState, chatId: string, ready: AscFlowTurnReady): void {
    const cod = chatId.trim();
    const entry = state.inFlight.get(cod);
    if (entry) {
      entry.ready = ready;
      entry.at = Date.now();
      return;
    }
    // An outbound with no inbound turn in flight (a proactive send): still park
    // it, so a poll that arrives for this cod collects it.
    state.inFlight.set(cod, { text: '', at: Date.now(), ready });
  }

  /**
   * The two Genesys userdata fields the agent owns (HANDOFF-GENESYS.md). Only
   * set when the turn actually hands off.
   */
  private buildHandoffFields(
    isHandoff: boolean,
    meta: Record<string, unknown>,
  ): Pick<AscFlowTurnReady, 'fila_vq' | 'motivo_transf_vq'> {
    if (!isHandoff) return {};
    const fila = meta.handoffQueue;
    const motivo = meta.handoffReason;
    return {
      ...(typeof fila === 'string' || typeof fila === 'number' ? { fila_vq: String(fila) } : {}),
      ...(typeof motivo === 'string' && motivo.trim() ? { motivo_transf_vq: motivo.trim() } : {}),
    };
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
    this.ascFlowInstances.get(instanceId)?.inFlight.set(turn.codAtendimento, { text: turn.text, at: Date.now() });

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

    if (timings) this.captureT2(correlationId, timings);
  }

  // ─────────────────────────────────────────────────────────────
  // Internal helpers (used by the webhook handler)
  // ─────────────────────────────────────────────────────────────

  getLogger(): Logger {
    return this.logger;
  }

  /**
   * The answer parked by `sendMessage`, if the agent already produced one for
   * this `cod_atendimento`. Taking it CLOSES the turn: the next call with the
   * same text is a genuinely new one.
   */
  takeReadyTurn(instanceId: string, codAtendimento: string): AscFlowTurnReady | null {
    const state = this.ascFlowInstances.get(instanceId);
    const entry = state?.inFlight.get(codAtendimento);
    if (!state || !entry?.ready) return null;

    state.inFlight.delete(codAtendimento);
    if (Date.now() - entry.at > IN_FLIGHT_TTL_MS) {
      this.logger.warn('[asc-flow] discarding a turn answer the flow never collected', {
        instanceId,
        codAtendimento,
        ageMs: Date.now() - entry.at,
      });
      return null;
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
