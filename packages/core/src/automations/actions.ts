/**
 * Action implementations for automations
 *
 * Actions are the "do Y" part of "when X happens, do Y".
 */

import type { EventBus } from '../events/bus';
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
  /** Provider ID (optional, resolved from template or instance default) */
  providerId?: string;
  /** Chat ID for session continuity */
  chatId: string;
  /** Sender ID for user identification */
  senderId: string;
  /** Sender's display name */
  senderName?: string;
  /** The message(s) to send to the agent */
  messages: string[];
}

/**
 * Dependencies needed by action executors
 */
export interface ActionDependencies {
  eventBus: EventBus | null;
  sendMessage?: (instanceId: string, to: string, content: string) => Promise<void>;
  /**
   * Call an AI agent and return the response.
   * The response is stored in variables for use in subsequent actions.
   */
  callAgent?: (context: AgentCallContext, config: CallAgentActionConfig) => Promise<AgentRunResult>;
}

/**
 * Build headers for webhook request
 */
function buildWebhookHeaders(config: WebhookActionConfig, context: TemplateContext): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.headers) {
    for (const [key, value] of Object.entries(config.headers)) {
      headers[key] = substituteTemplate(value, context);
    }
  }
  return headers;
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
): Promise<{ success: boolean; result?: unknown; error?: string }> {
  try {
    const url = substituteTemplate(config.url, context);
    const method = config.method ?? 'POST';
    const headers = buildWebhookHeaders(config, context);
    const body = config.bodyTemplate
      ? substituteTemplate(config.bodyTemplate, context)
      : JSON.stringify(context.payload);

    logger.debug(`Webhook ${method} ${url}`, { method, url, waitForResponse: config.waitForResponse });

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? body : undefined,
      signal: AbortSignal.timeout(config.timeoutMs ?? 30000),
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

    await deps.sendMessage(instanceId, to, content);

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

    const result = await deps.eventBus.publishGeneric(eventType, payload, {
      correlationId: (context.payload.correlationId as string) ?? undefined,
      source: 'automation',
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
  const senderId = fromObj?.id ?? (context.payload.senderId as string);
  const senderName = fromObj?.name ?? (context.payload.senderName as string);

  if (!chatId) return { error: 'chatId not found in payload' };
  if (!senderId) return { error: 'senderId not found in payload' };

  // Get message content from payload
  const messageContent = (context.payload.content as string) ?? (context.payload.text as string) ?? '';
  if (!messageContent) return { error: 'message content not found in payload' };

  // Resolve agentId (may be a template)
  const agentId = substituteTemplate(config.agentId, context);
  if (!agentId) return { error: 'agentId is required' };

  return {
    context: {
      instanceId,
      providerId: config.providerId ? substituteTemplate(config.providerId, context) : undefined,
      chatId,
      senderId,
      senderName,
      messages: [messageContent],
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
    const result = await deps.callAgent(agentContext, config);

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
): Promise<ActionExecutionResult> {
  const start = Date.now();

  let result: { success: boolean; result?: unknown; error?: string };

  switch (action.type) {
    case 'webhook':
      result = await executeWebhookAction(action.config, context, deps);
      break;
    case 'send_message':
      result = await executeSendMessageAction(action.config, context, deps);
      break;
    case 'emit_event':
      result = await executeEmitEventAction(action.config, context, deps);
      break;
    case 'log':
      result = await executeLogAction(action.config, context, deps);
      break;
    case 'call_agent':
      result = await executeCallAgentAction(action.config, context, deps);
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
): Promise<ActionExecutionResult[]> {
  const results: ActionExecutionResult[] = [];
  const variables = { ...context.variables };

  for (const action of actions) {
    // Create context with updated variables
    const actionContext: TemplateContext = {
      ...context,
      variables,
    };

    const result = await executeAction(action, actionContext, deps);
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
