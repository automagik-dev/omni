/**
 * Action implementations for automations
 *
 * Actions are the "do Y" part of "when X happens, do Y".
 */

import { brokeredFetch } from '../egress';
import type { EventBus } from '../events/bus';
import { resolveAmbientTenantId } from '../events/envelope';
import type { CustomEventType, GenericEventPayload } from '../events/types';
import { createLogger } from '../logger';
import { type TemplateContext, substituteTemplate, substituteTemplateObject } from './templates';
import type {
  ActionExecutionResult,
  AutomationAction,
  CallAgentActionConfig,
  EmitEventActionConfig,
  LogActionConfig,
  SendMessageActionConfig,
  WebhookActionConfig,
} from './types';

const logger = createLogger('automations:actions');

/**
 * Result of running an agent
 */
export interface AgentRunResult {
  /** Response content (may be split into parts) */
  parts: string[];
  /** Full response content (joined parts) */
  fullResponse: string;
  /** Run metadata */
  metadata: {
    runId: string;
    sessionId: string;
    status: 'completed' | 'failed';
  };
}

/**
 * Context needed for agent call
 */
export interface AgentCallContext {
  /** Instance ID (resolved from template) */
  instanceId: string;
  /** Agent FK ID (resolved from template, may be empty to use instance default) */
  agentId?: string;
  /** Provider ID (optional, resolved from template or instance default) */
  providerId?: string;
  /** Chat ID for session continuity */
  chatId: string;
  /** Thread/topic identifier (e.g. Telegram forum topic) — drives per_thread session keys */
  threadId?: string;
  /** Sender ID for user identification */
  senderId: string;
  /** Sender's display name */
  senderName?: string;
  /** The message(s) to send to the agent */
  messages: string[];
  /**
   * Envelope of the event that woke this agent (#960) — threaded from the
   * engine's TemplateContext so the agent (and the callAgent implementation)
   * knows which event it is responding to. Absent for envelope-less
   * invocations (route-side manual execute, legacy tests).
   */
  event?: {
    id: string;
    type: string;
    correlationId?: string;
  };
}

/**
 * Dependencies needed by action executors
 *
 * TENANT THREADING (G5, ADR-0008): the engine classifies each consumed
 * envelope (`classifyEnvelope`) and threads the producer-stamped trusted
 * tenant into `sendMessage` / `callAgent` as the trailing `trustedTenantId`
 * argument — `null` for a legacy envelope. The value is derived from envelope
 * METADATA, never from the event payload, and the callback implementations
 * (packages/api `automation-actions.ts`) scope their DB blocks with it. A
 * caller that threads nothing (the route-side manual `execute`, existing
 * tests) leaves it `undefined` and the callbacks behave exactly as before.
 */
export interface ActionDependencies {
  eventBus: EventBus | null;
  sendMessage?: (instanceId: string, to: string, content: string, trustedTenantId?: string | null) => Promise<void>;
  /**
   * Call an AI agent and return the response.
   * The response is stored in variables for use in subsequent actions.
   */
  callAgent?: (
    context: AgentCallContext,
    config: CallAgentActionConfig,
    trustedTenantId?: string | null,
  ) => Promise<AgentRunResult>;
  /**
   * Optional consumer-side stale-event gate. Invoked by the engine for
   * `chat.idle_timeout` events before matching automations execute.
   * Returns `{ skip: true, reason }` when the event is no longer relevant:
   *   - chat in active close-contact state (`closed:true` or
   *     `closeUntil` still in window)
   *   - follow-up row already disarmed (`sequence_complete`,
   *     `customer_replied`, `handoff`, `contact_closed`, etc.)
   *   - this exact event was already delivered to the engine (an event's
   *     identity is chat + instance + arm epoch + `sequenceIndex`, and the
   *     gate remembers the identities it let through)
   *   - the row's `sequenceIndex` is 2+ ahead of the event's — a bulk replay
   *     of history the gate never claimed
   *
   * Defense-in-depth against NATS replay of historical or duplicate
   * idle-timeout events that the sweeper had already processed before a
   * restart drained the durable consumer's ack state, or that NATS
   * redelivered after a transient handler failure.
   *
   * `eventSequenceIndex` is the `sequenceIndex` field from the
   * `chat.idle_timeout` payload at publish time. It is NOT compared as a
   * distance against the row's current `sequence_index` for the ambiguous
   * 0/1 gap: the sweeper publishes index N and then immediately advances the
   * row to N+1, so `row > event` also matches every healthy first delivery —
   * the comparison that dropped ~14% of legitimate follow-ups (f149179a).
   * Event identity is what discriminates a redelivery from a first delivery.
   *
   * Returning `{ skip: false }` (or omitting the gate entirely) lets the
   * engine proceed with normal matching+execution. A `claimToken` on that
   * verdict must be handed back to `releaseIdleTimeoutClaim` if the engine
   * then fails to handle the event.
   */
  staleIdleTimeoutGate?: (
    chatId: string,
    instanceId: string,
    eventSequenceIndex: number | null,
    /**
     * Trusted tenant of the consumed envelope (G5, ADR-0008) — the engine
     * classifies the event's producer-stamped metadata and threads the result;
     * `null` for a legacy envelope. The gate scopes its DB reads from it.
     */
    trustedTenantId?: string | null,
  ) => Promise<{ skip: boolean; reason?: string; claimToken?: string }>;
  /**
   * Release a claim previously granted by `staleIdleTimeoutGate`. The gate
   * records the claim before the event is executed, so a delivery that throws
   * (queue full → `nak`, dispatcher error) must give the claim back or its own
   * NATS redelivery is dropped as a "duplicate" and the follow-up is lost
   * permanently — a fail-CLOSED outcome the gate explicitly forbids.
   */
  releaseIdleTimeoutClaim?: (claimToken: string) => void | Promise<void>;
}

/**
 * Build headers for webhook request.
 *
 * Envelope headers (#960, the khal/brain push-ingress contract):
 *   - `X-Omni-Event-Id`: the triggering event's id.
 *   - `X-Omni-Delivery-Id`: `{event.id}:{automation.id}:{actionIndex}` —
 *     stable across retries of the SAME delivery attempt chain, so a receiver
 *     can dedupe on an id Omni minted. `manual` stands in for the automation
 *     id on route-side manual executions that still thread an envelope.
 * Both are only stamped when the engine threaded a triggering envelope;
 * envelope-less invocations send exactly the headers they always did.
 * Config-declared headers are applied last so an operator can override.
 */
function buildWebhookHeaders(
  config: WebhookActionConfig,
  context: TemplateContext,
  actionIndex: number,
): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (context.event) {
    headers['X-Omni-Event-Id'] = context.event.id;
    headers['X-Omni-Delivery-Id'] = `${context.event.id}:${context.automation?.id ?? 'manual'}:${actionIndex}`;
  }
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = substituteTemplate(value, context);
    }
  }
  return headers;
}

/**
 * Default webhook body (#960): the FULL OmniEvent envelope when one was
 * threaded and `includeEnvelope` is not explicitly false; the bare payload
 * otherwise (legacy default, and always the fallback for envelope-less
 * invocations). A configured `bodyTemplate` bypasses this entirely.
 */
function buildDefaultWebhookBody(config: WebhookActionConfig, context: TemplateContext): string {
  if (context.event && config.includeEnvelope !== false) {
    return JSON.stringify({
      id: context.event.id,
      type: context.event.type,
      payload: context.payload,
      metadata: context.event.metadata,
      timestamp: context.event.timestamp,
    });
  }
  return JSON.stringify(context.payload);
}

/**
 * Parse webhook response
 */
async function parseWebhookResponse(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

/**
 * Execute a webhook action
 */
async function executeWebhookAction(
  config: WebhookActionConfig,
  context: TemplateContext,
  _deps: ActionDependencies,
  trustedTenantId?: string | null,
  actionIndex = 0,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const url = substituteTemplate(config.url, context);
    const method = config.method ?? 'POST';
    const headers = buildWebhookHeaders(config, context, actionIndex);
    const body = config.bodyTemplate
      ? substituteTemplate(config.bodyTemplate, context)
      : buildDefaultWebhookBody(config, context);

    logger.debug(`Webhook ${method} ${url}`, { method, url, waitForResponse: config.waitForResponse });

    // ADR-0009: tenant-controlled egress goes through the audited egress broker.
    // With no tenant policy bound (flag-off / no tenant scope) this is a
    // byte-identical passthrough to the previous raw `fetch`; with a bound policy
    // it enforces the default-deny SSRF broker. The `egress` marker carries the
    // audit context; the request init is otherwise unchanged.
    //
    // G5 tenant threading: a consumer-side execution binds the CONSUMED
    // envelope's trusted tenant (threaded by the engine), so the broker can
    // resolve that tenant's policy; the request-side ambient resolver only
    // applies when no envelope tenant exists. A legacy envelope threads null
    // and the marker stays `(unbound)` — passthrough, byte-identical.
    const response = await brokeredFetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
      signal: AbortSignal.timeout(config.timeoutMs ?? 30000),
      egress: {
        tenantId: trustedTenantId ?? resolveAmbientTenantId() ?? '(unbound)',
        actorCredentialId: null,
        integration: 'automations.webhook',
      },
    });

    if (!config.waitForResponse) {
      return {
        success: response.ok,
        result: { status: response.status },
        error: response.ok ? undefined : `HTTP ${response.status}`,
      };
    }

    const responseData = await parseWebhookResponse(response);
    return { success: response.ok, result: responseData, error: response.ok ? undefined : `HTTP ${response.status}` };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Webhook action failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute a send_message action
 */
async function executeSendMessageAction(
  config: SendMessageActionConfig,
  context: TemplateContext,
  deps: ActionDependencies,
  trustedTenantId?: string | null,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    if (!deps.sendMessage) {
      return {
        success: false,
        error: 'sendMessage dependency not provided',
      };
    }

    // Substitute values
    const instanceId = config.instanceId ? substituteTemplate(config.instanceId, context) : undefined;
    const to = config.to ? substituteTemplate(config.to, context) : undefined;
    const content = substituteTemplate(config.contentTemplate, context);

    if (!instanceId) {
      return { success: false, error: 'instanceId is required' };
    }
    if (!to) {
      return { success: false, error: 'to is required' };
    }
    if (!content) {
      return { success: false, error: 'content is empty' };
    }

    logger.debug('Sending message', { instanceId, to, contentLength: content.length });

    await deps.sendMessage(instanceId, to, content, trustedTenantId);

    return {
      success: true,
      result: { instanceId, to, contentLength: content.length },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Send message action failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute an emit_event action
 */
async function executeEmitEventAction(
  config: EmitEventActionConfig,
  context: TemplateContext,
  deps: ActionDependencies,
  trustedTenantId?: string | null,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    if (!deps.eventBus) {
      return {
        success: false,
        error: 'eventBus not available',
      };
    }

    // Build payload
    let payload: GenericEventPayload;
    if (config.payloadTemplate) {
      payload = substituteTemplateObject(config.payloadTemplate, context) as GenericEventPayload;
    } else {
      payload = context.payload;
    }

    const eventType = substituteTemplate(config.eventType, context) as CustomEventType;

    logger.debug('Emitting event', { eventType });

    // G5 (ADR-0008): a tenant-world execution threads its trusted tenant into
    // the re-publish metadata, so the publisher seam
    // (`resolvePublishTenantId`, explicit-tenant precedence) stamps the NEXT
    // hop's envelope — a consumer chain never silently drops back to the
    // legacy world. With nothing threaded the metadata is unchanged and the
    // publish stays byte-identical.
    //
    // Correlation rides the same threading (#956): the next hop continues the
    // TRIGGERING event's envelope correlation, never a payload claim. The
    // payload fallback only applies to envelope-less invocations (route-side
    // manual execute), which is the pre-#956 behavior unchanged.
    const correlationId =
      context.event?.metadata.correlationId ?? (context.payload.correlationId as string) ?? undefined;
    const result = await deps.eventBus.publishGeneric(eventType, payload, {
      correlationId,
      source: 'automation',
      ...(trustedTenantId ? { tenantId: trustedTenantId } : {}),
    });

    return {
      success: true,
      result: { eventId: result.id, eventType },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Emit event action failed', { error: errorMessage });
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Execute a log action
 */
async function executeLogAction(
  config: LogActionConfig,
  context: TemplateContext,
  _deps: ActionDependencies,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const message = substituteTemplate(config.message, context);

    switch (config.level) {
      case 'debug':
        logger.debug(message);
        break;
      case 'info':
        logger.info(message);
        break;
      case 'warn':
        logger.warn(message);
        break;
      case 'error':
        logger.error(message);
        break;
    }

    return {
      success: true,
      result: { level: config.level, message },
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Build messages array from context: prefer debounce context (multiple messages),
 * fall back to single payload.
 *
 * When `promptOverride` is set on the `call_agent` config, the rendered
 * override replaces any payload- or debounce-derived messages entirely. The
 * override is not persisted as a chat message (that invariant is the
 * responsibility of the injected `callAgent` implementation — it should not
 * write `promptOverride` back to chat history or agent session memory).
 */
function extractMessages(context: TemplateContext, promptOverride?: string): string[] | { error: string } {
  if (promptOverride !== undefined) {
    const rendered = substituteTemplate(promptOverride, context);
    if (!rendered) return { error: 'promptOverride rendered to an empty string' };
    return [rendered];
  }
  if (context.debounce?.messages && context.debounce.messages.length > 0) {
    const messages = context.debounce.messages.map((m) => m.text).filter((t): t is string => !!t);
    if (messages.length === 0) {
      return { error: 'no text content found in debounced messages' };
    }
    return messages;
  }
  const messageContent = (context.payload.content as string) ?? (context.payload.text as string) ?? '';
  if (!messageContent) return { error: 'message content not found in payload' };
  return [messageContent];
}

/**
 * Extract agent call context from automation payload
 * Returns extracted context or error string
 */
function extractAgentCallContext(
  config: CallAgentActionConfig,
  context: TemplateContext,
): { context: AgentCallContext } | { error: string } {
  // Extract instanceId from config or payload
  const instanceId = config.providerId
    ? substituteTemplate(config.providerId, context)
    : (context.payload.instanceId as string);

  if (!instanceId) {
    return { error: 'instanceId is required (from payload or config.providerId template)' };
  }

  // Extract chat and sender info from payload
  const fromObj = context.payload.from as { id?: string; name?: string } | undefined;
  const chatId = (context.payload.chatId as string) ?? fromObj?.id;
  // System-initiated events (e.g. chat.idle_timeout) have no external sender;
  // fall back to chatId so the agent can act on behalf of the chat.
  const senderId = fromObj?.id ?? (context.payload.senderId as string) ?? chatId;
  const senderName =
    fromObj?.name ?? (context.payload.senderName as string) ?? (context.payload.chatName as string | undefined);

  if (!chatId) return { error: 'chatId not found in payload' };
  if (!senderId) return { error: 'senderId not found in payload' };

  // Thread identifier: message events carry it at payload.threadId; some
  // channels only stamp it inside rawPayload. Needed so a call_agent on a
  // per_thread instance resumes the thread's session, not the whole chat's.
  const rawPayload = (context.payload.rawPayload ?? {}) as Record<string, unknown>;
  const threadId = (context.payload.threadId as string | undefined) ?? (rawPayload.threadId as string | undefined);

  const messagesResult = extractMessages(context, config.promptOverride);
  if ('error' in messagesResult) return messagesResult;

  // Resolve agentId (may be a template). Empty string means "use instance default".
  const agentId = config.agentId ? substituteTemplate(config.agentId, context) : '';

  return {
    context: {
      instanceId,
      agentId: agentId || undefined,
      providerId: config.providerId ? substituteTemplate(config.providerId, context) : undefined,
      chatId,
      threadId,
      senderId,
      senderName,
      messages: messagesResult,
      // Envelope of the triggering event (#960) — lets the agent know which
      // event woke it. Derived from engine-threaded metadata, never payload.
      event: context.event
        ? {
            id: context.event.id,
            type: context.event.type,
            correlationId: context.event.metadata.correlationId,
          }
        : undefined,
    },
  };
}

/**
 * Execute a call_agent action
 * Invokes an AI agent and returns the response for use in subsequent actions.
 * This is a composable building block - use send_message to send the response.
 */
async function executeCallAgentAction(
  config: CallAgentActionConfig,
  context: TemplateContext,
  deps: ActionDependencies,
  trustedTenantId?: string | null,
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  if (!deps.callAgent) {
    return { success: false, error: 'callAgent dependency not provided' };
  }

  // Extract and validate context
  const extracted = extractAgentCallContext(config, context);
  if ('error' in extracted) {
    return { success: false, error: extracted.error };
  }

  const agentContext = extracted.context;

  logger.debug('Executing call_agent action', {
    instanceId: agentContext.instanceId,
    chatId: agentContext.chatId,
    senderId: agentContext.senderId,
    agentId: config.agentId,
  });

  try {
    // `agentContext` is payload-derived; the trusted tenant travels as its own
    // argument so the trust boundary stays visible at the callback signature.
    const result = await deps.callAgent(agentContext, config, trustedTenantId);

    logger.info('Agent call completed', {
      runId: result.metadata.runId,
      status: result.metadata.status,
      responseLength: result.fullResponse.length,
    });

    return {
      success: result.metadata.status === 'completed',
      result: {
        response: result.fullResponse,
        runId: result.metadata.runId,
        sessionId: result.metadata.sessionId,
      },
      error: result.metadata.status === 'failed' ? 'Agent call failed' : undefined,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Call agent action failed', { error: errorMessage });
    return { success: false, error: errorMessage };
  }
}

/**
 * Execute a single action
 */
export async function executeAction(
  action: AutomationAction,
  context: TemplateContext,
  deps: ActionDependencies,
  trustedTenantId?: string | null,
  /** Position of this action in its automation's action list — part of the
   * webhook delivery-id derivation (#960). Defaults to 0 for direct calls. */
  actionIndex = 0,
): Promise<ActionExecutionResult> {
  const start = Date.now();

  let result: { success: boolean; result?: unknown; error?: string };

  switch (action.type) {
    case 'webhook':
      result = await executeWebhookAction(action.config, context, deps, trustedTenantId, actionIndex);
      break;
    case 'send_message':
      result = await executeSendMessageAction(action.config, context, deps, trustedTenantId);
      break;
    case 'emit_event':
      result = await executeEmitEventAction(action.config, context, deps, trustedTenantId);
      break;
    case 'log':
      result = await executeLogAction(action.config, context, deps);
      break;
    case 'call_agent':
      result = await executeCallAgentAction(action.config, context, deps, trustedTenantId);
      break;
    default:
      // TypeScript should catch this, but just in case
      result = { success: false, error: `Unknown action type: ${(action as { type: string }).type}` };
  }

  const durationMs = Date.now() - start;

  return {
    action: action.type,
    status: result.success ? 'success' : 'failed',
    result: result.result,
    error: result.error,
    durationMs,
  };
}

/**
 * Execute a sequence of actions
 *
 * Actions are executed sequentially. If an action with waitForResponse: true
 * succeeds, its response is stored in variables[responseAs] for subsequent actions.
 */
export async function executeActions(
  actions: AutomationAction[],
  context: TemplateContext,
  deps: ActionDependencies,
  trustedTenantId?: string | null,
): Promise<ActionExecutionResult[]> {
  const results: ActionExecutionResult[] = [];
  const variables = { ...context.variables };

  for (const [actionIndex, action] of actions.entries()) {
    // Create context with updated variables
    const actionContext: TemplateContext = {
      ...context,
      variables,
    };

    const result = await executeAction(action, actionContext, deps, trustedTenantId, actionIndex);
    results.push(result);

    // Store response as variable if configured (for webhook and call_agent)
    if (action.type === 'webhook' && action.config.responseAs && result.status === 'success' && result.result) {
      variables[action.config.responseAs] = result.result;
    }
    if (action.type === 'call_agent' && action.config.responseAs && result.status === 'success' && result.result) {
      // Store the full response for chaining
      const agentResult = result.result as { response: string };
      variables[action.config.responseAs] = agentResult.response;
    }

    // Note: We don't stop on failure - just log and continue
    // This matches the wish requirement: "failures logged but don't stop sequence"
  }

  return results;
}
