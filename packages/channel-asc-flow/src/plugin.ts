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
 *   → callbackFlowMsg / mensagem (the bubbles) → callbackFlow (variables, and
 *     the flow resumes) → transferirHumano when the turn hands off
 *
 * Turn boundary. One `sendMessage` is one flow turn: the bubbles go out, then
 * ONE `callbackFlow` resumes the flow. A turn's paragraphs (blank-line
 * separated) become separate bubbles, which is how the scheduling agent writes
 * and what the adapter proved against the ASC emulator.
 * ponytail: if an agent ever emits two `sendMessage` calls for one user turn,
 * the flow advances twice. Upgrade path is a per-`cod` turn buffer flushed on
 * an end-of-turn signal — not built until a dispatcher actually does that.
 *
 * Handoff. Detected from `metadata.isHandoff` (the Gupshup precedent), not by
 * sniffing the agent's prose: the adapter only regex-matched the invitation
 * because it called the agent itself and had no metadata channel. Two of the
 * Genesys component's fourteen userdata fields are ours to fill — `fila_vq`
 * (destination queue) and `motivo_transf_vq` (reason) — and they travel as
 * flow variables on `callbackFlow`, per HANDOFF-GENESYS.md.
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
import type { Logger } from '@omni/core';
import type { ChannelType } from '@omni/core/types';

import { ASC_FLOW_CAPABILITIES } from './capabilities';
import { AscFlowClient } from './client';
import { type ParsedAscFlowTurn, handleAscFlowWebhookRequest } from './handlers/webhook';
import type { AscFlowConfig, AscFlowUra } from './types';
import { AscFlowApiError, AscFlowErrorCode, isRetryable } from './utils/errors';
import { buildUra, splitBubbles } from './utils/interactive';

/** Platform default — the NotreDame tenant this channel was built against. */
export const DEFAULT_ASC_FLOW_BASE_URL = 'https://sac-notredame.ascbrazil.com.br';
/** The REST prefix every endpoint sits under. */
const REST_PREFIX = '/rest/v2';

interface AscFlowInstanceState {
  client: AscFlowClient;
  config: AscFlowConfig;
  dedupeCache: DedupeCache;
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
    const text = content.text ?? content.caption ?? '';

    const correlationId = meta.correlationId as string | undefined;
    if (correlationId) this.captureT10(correlationId);

    try {
      const cod = toCodAtendimento(to);
      const bubbles = splitBubbles(text);
      if (bubbles.length === 0) {
        throw new AscFlowApiError(AscFlowErrorCode.INVALID_REQUEST, 'refusing to send an empty turn');
      }

      // The URA rides on the LAST bubble — the options attach to the last
      // thing the beneficiary read. `/mensagem` is the only endpoint that can
      // inject options into an atendimento that already exists.
      const lastBubble = bubbles[bubbles.length - 1] as string;
      const ura = buildUra(lastBubble, content.buttons, {
        ...(content.list?.sectionTitle !== undefined ? { sectionTitle: content.list.sectionTitle } : {}),
        ...(content.list?.forceList !== undefined ? { forceList: content.list.forceList } : {}),
      });

      await this.deliverTurn(state, cod, bubbles, ura);

      const isHandoff = meta.isHandoff === true;
      await this.resumeFlow(state, cod, this.buildFlowVariables(text, isHandoff, meta));

      if (isHandoff) {
        await state.client.call('/transferirHumano', {
          cod,
          cod_servico: Number(meta.handoffServico ?? state.config.ascFlowHandoffServico),
          cod_prioridade: Number(meta.handoffPriority ?? 0),
          msgTransferencia: false,
        });
      }

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

      return { success: false, error: errorMessage, retryable, timestamp: Date.now() };
    }
  }

  /**
   * Bubbles in order, typing between them (never before the first — the
   * inbound path already raised it), the last one carrying the URA when there
   * is one.
   */
  private async deliverTurn(
    state: AscFlowInstanceState,
    cod: number,
    bubbles: string[],
    ura: AscFlowUra | null,
  ): Promise<void> {
    for (let i = 0; i < bubbles.length; i++) {
      if (i > 0) {
        await state.client.call('/sendIndicador', { cod, tipo: 1 });
      }
      const isLast = i === bubbles.length - 1;
      if (ura && isLast) {
        await state.client.call('/mensagem', {
          cod,
          mensagem: bubbles[i],
          entrante: 0,
          bolFlow: true,
          ...ura,
        });
      } else {
        await state.client.call('/callbackFlowMsg', {
          cod_atendimento: cod,
          sendMsg: 1,
          msg_usuario: bubbles[i],
          entrante: 0,
        });
      }
    }
  }

  /**
   * `POST /callbackFlow` — writes the variables and lets the flow advance.
   *
   * The swagger is self-contradictory about `flow_variaveis`: the
   * `variaveis_flow` schema describes an object (`{var_1..var_4}`) while the
   * endpoint's own example sends `[]`. We send the object and, if the platform
   * refuses it, repeat as `[{nome, valor}]`. Retrying here is safe in a way it
   * is not for `/mensagem`: `callbackFlow` writes variables, it does not
   * deliver a bubble, so a rejected first attempt reached no handset.
   */
  private async resumeFlow(state: AscFlowInstanceState, cod: number, variables: Record<string, string>): Promise<void> {
    try {
      await state.client.call('/callbackFlow', { cod_atendimento: cod, flow_variaveis: variables });
    } catch (err) {
      this.logger.warn('[asc-flow] callbackFlow rejected the object form — retrying as a list', {
        cod,
        err: String(err),
      });
      await state.client.call('/callbackFlow', {
        cod_atendimento: cod,
        flow_variaveis: Object.entries(variables).map(([nome, valor]) => ({ nome, valor })),
      });
    }
  }

  /**
   * Flow variables set on `callbackFlow`. `resposta` and `hand_off` are the
   * flow's own branching inputs; `fila_vq` / `motivo_transf_vq` are the two
   * Genesys userdata fields the agent owns (HANDOFF-GENESYS.md) and are only
   * set when the turn actually hands off.
   */
  private buildFlowVariables(text: string, isHandoff: boolean, meta: Record<string, unknown>): Record<string, string> {
    const variables: Record<string, string> = {
      resposta: text,
      hand_off: isHandoff ? 'sim' : 'nao',
    };
    if (isHandoff) {
      const fila = meta.handoffQueue;
      const motivo = meta.handoffReason;
      if (typeof fila === 'string' || typeof fila === 'number') variables.fila_vq = String(fila);
      if (typeof motivo === 'string' && motivo.trim()) variables.motivo_transf_vq = motivo.trim();
    }
    return variables;
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

    // Raise "digitando…" as soon as the turn lands: the agent run is the slow
    // part, and the beneficiary is already waiting.
    await this.sendTyping(instanceId, turn.codAtendimento);

    const timings = this.captureInboundTimings(Date.now());
    const correlationId = await this.emitMessageReceived({
      instanceId,
      externalId: turn.messageId ?? crypto.randomUUID(),
      chatId: turn.codAtendimento,
      from: turn.phone || turn.codAtendimento,
      content: { type: 'text' as import('@omni/core/types').ContentType, text: sanitized.text },
      rawPayload: {
        ascFlow: { codAtendimento: turn.codAtendimento, hasPhone: Boolean(turn.phone) },
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

  // ─────────────────────────────────────────────────────────────
  // History (not supported — the platform exposes no transcript API)
  // ─────────────────────────────────────────────────────────────

  async fetchHistory(_instanceId: string, _options: FetchHistoryOptions): Promise<FetchHistoryResult> {
    return { totalFetched: 0, messages: [] };
  }
}
