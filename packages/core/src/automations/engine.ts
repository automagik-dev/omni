/**
 * Automation Engine
 *
 * Orchestrates event handling with:
 * - Per-instance queues with bounded concurrency
 * - Message debouncing per conversation
 * - Condition evaluation
 * - Action execution
 */

import type { EventBus, Subscription } from '../events/bus';
import type { EventType, GenericEventPayload, OmniEvent } from '../events/types';
import { generateId } from '../ids';
import { createLogger } from '../logger';
import { type ActionDependencies, executeActions } from './actions';
import { evaluateConditionsWithDetails } from './conditions';
import { type ConversationKey, DebounceManager, type DebouncedMessage, buildConversationKey } from './debounce';
import { type TemplateContext, createTemplateContext } from './templates';
import type { ActionExecutionResult, Automation, AutomationLogStatus, DebounceConfig, NewAutomationLog } from './types';

const logger = createLogger('automations:engine');

/**
 * Per-instance queue for bounded concurrency
 */
interface InstanceQueue {
  instanceId: string;
  activeCount: number;
  maxConcurrency: number;
  pending: Array<{
    automation: Automation;
    event: OmniEvent;
    context: TemplateContext;
    resolve: (result: ExecutionResult) => void;
  }>;
}

/**
 * Result of running an automation
 */
export interface ExecutionResult {
  automationId: string;
  automationName: string;
  eventId: string;
  status: AutomationLogStatus;
  conditionsMatched: boolean;
  actionsExecuted: ActionExecutionResult[];
  error?: string;
  executionTimeMs: number;
}

/**
 * Callback for logging execution results
 */
export type ExecutionLogger = (log: NewAutomationLog) => Promise<void>;

/**
 * Configuration for the automation engine
 */
export interface EngineConfig {
  defaultConcurrency: number;
  instanceConcurrencyOverrides?: Record<string, number>;
}

/**
 * Automation Engine
 */
export class AutomationEngine {
  private subscriptions: Subscription[] = [];
  private instanceQueues = new Map<string, InstanceQueue>();
  private debounceManagers = new Map<string, DebounceManager>(); // automationId -> manager
  private automations: Automation[] = [];
  private eventBus: EventBus | null = null;
  private deps: ActionDependencies;
  private logger: ExecutionLogger | null = null;

  constructor(private config: EngineConfig) {
    this.deps = {
      eventBus: null,
      sendMessage: undefined,
    };
  }

  /**
   * Start the engine with automations
   */
  async start(eventBus: EventBus, automations: Automation[], deps: Partial<ActionDependencies> = {}): Promise<void> {
    this.eventBus = eventBus;
    this.deps = {
      eventBus,
      sendMessage: deps.sendMessage,
    };
    this.automations = automations.filter((a) => a.enabled);

    // Subscribe to all unique trigger event types
    const triggerTypes = new Set(this.automations.map((a) => a.triggerEventType));

    for (const eventType of triggerTypes) {
      const subscription = await eventBus.subscribePattern(`${eventType}.>`, async (event) => {
        await this.handleEvent(event);
      });
      this.subscriptions.push(subscription);
      logger.info(`Subscribed to ${eventType}.*`);
    }

    // Set up debounce managers for automations that have debounce config
    for (const automation of this.automations) {
      if (automation.debounce && automation.debounce.mode !== 'none') {
        this.setupDebounceManager(automation);
      }
    }

    logger.info(`Automation engine started with ${this.automations.length} automations`);
  }

  /**
   * Stop the engine
   */
  async stop(): Promise<void> {
    // Unsubscribe from all events
    for (const subscription of this.subscriptions) {
      await subscription.unsubscribe();
    }
    this.subscriptions = [];

    // Flush all debounce windows
    for (const manager of this.debounceManagers.values()) {
      manager.flushAll();
    }
    this.debounceManagers.clear();

    logger.info('Automation engine stopped');
  }

  /**
   * Set the execution logger
   */
  setLogger(logger: ExecutionLogger): void {
    this.logger = logger;
  }

  /**
   * Reload automations (e.g., when CRUD changes)
   */
  async reload(automations: Automation[]): Promise<void> {
    await this.stop();
    if (this.eventBus) {
      await this.start(this.eventBus, automations, this.deps);
    }
  }

  /**
   * Handle an incoming event
   */
  private async handleEvent(event: OmniEvent): Promise<void> {
    const eventType = event.type;
    const instanceId = event.metadata.instanceId ?? 'global';

    // Find matching automations
    const matchingAutomations = this.automations.filter((a) => a.triggerEventType === eventType);

    if (matchingAutomations.length === 0) {
      return;
    }

    logger.debug(`Processing event ${eventType} for ${matchingAutomations.length} automation(s)`, {
      eventId: event.id,
      instanceId,
    });

    // Sort by priority (higher first)
    const sortedAutomations = [...matchingAutomations].sort((a, b) => b.priority - a.priority);

    for (const automation of sortedAutomations) {
      // Check if this automation has debounce
      if (automation.debounce && automation.debounce.mode !== 'none') {
        await this.handleDebounced(automation, event);
      } else {
        await this.handleImmediate(automation, event);
      }
    }
  }

  /**
   * Handle an event with debouncing
   */
  private async handleDebounced(automation: Automation, event: OmniEvent): Promise<void> {
    const manager = this.debounceManagers.get(automation.id);
    if (!manager) {
      // Fallback to immediate if manager not set up
      await this.handleImmediate(automation, event);
      return;
    }

    const payload = event.payload as Record<string, unknown>;
    const instanceId = event.metadata.instanceId ?? 'global';

    // Extract person/sender ID from payload
    const from = payload.from as { id: string; name?: string } | undefined;
    if (!from?.id) {
      // No sender info, can't debounce per-conversation
      await this.handleImmediate(automation, event);
      return;
    }

    const key = buildConversationKey(instanceId, from.id);

    // Check if this is a presence event (for presence-based debounce)
    if (event.type.startsWith('presence.')) {
      manager.handlePresenceEvent(key, event.type);
      return;
    }

    // Build debounced message
    const content = payload.content as { type: string; text?: string } | undefined;
    const message: DebouncedMessage = {
      type: content?.type ?? 'unknown',
      text: content?.text,
      timestamp: event.timestamp,
      payload,
    };

    manager.addMessage(key, message, from, instanceId);
  }

  /**
   * Handle an event immediately (no debounce)
   */
  private async handleImmediate(automation: Automation, event: OmniEvent): Promise<void> {
    const instanceId = event.metadata.instanceId ?? 'global';
    const context = createTemplateContext(event.payload as Record<string, unknown>);

    await this.queueExecution(automation, event, context, instanceId);
  }

  /**
   * Set up debounce manager for an automation
   */
  private setupDebounceManager(automation: Automation): void {
    const callback = async (
      key: ConversationKey,
      messages: DebouncedMessage[],
      from: { id: string; name?: string },
      instanceId: string,
    ) => {
      // Get the last message (should always exist since callback only fires with messages)
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage) {
        logger.warn('Debounce callback fired with empty messages array', { key });
        return;
      }

      // Build context with grouped messages
      const context = createTemplateContext(lastMessage.payload, {
        debounce: {
          messages: messages.map((m) => ({
            type: m.type,
            text: m.text,
            timestamp: m.timestamp,
          })),
          from,
          instanceId,
        },
      });

      // Create a synthetic event
      const syntheticEvent: OmniEvent = {
        id: generateId(),
        type: automation.triggerEventType as EventType,
        payload: lastMessage.payload as GenericEventPayload,
        metadata: {
          correlationId: generateId(),
          instanceId,
        },
        timestamp: Date.now(),
      };

      await this.queueExecution(automation, syntheticEvent, context, instanceId);
    };

    const manager = new DebounceManager(automation.debounce as DebounceConfig, callback);
    this.debounceManagers.set(automation.id, manager);
  }

  /**
   * Queue an execution with per-instance concurrency control
   */
  private async queueExecution(
    automation: Automation,
    event: OmniEvent,
    context: TemplateContext,
    instanceId: string,
  ): Promise<ExecutionResult> {
    // Get or create queue for this instance
    let queue = this.instanceQueues.get(instanceId);
    if (!queue) {
      const maxConcurrency = this.config.instanceConcurrencyOverrides?.[instanceId] ?? this.config.defaultConcurrency;
      queue = {
        instanceId,
        activeCount: 0,
        maxConcurrency,
        pending: [],
      };
      this.instanceQueues.set(instanceId, queue);
    }

    // If under capacity, execute immediately
    if (queue.activeCount < queue.maxConcurrency) {
      return this.executeAutomation(automation, event, context, queue);
    }

    // Otherwise, queue it
    // Note: queue is guaranteed to be defined here since we set it above
    const queueRef = queue;
    return new Promise<ExecutionResult>((resolve) => {
      queueRef.pending.push({
        automation,
        event,
        context,
        resolve,
      });
      logger.debug('Execution queued', {
        automationId: automation.id,
        instanceId,
        queueLength: queueRef.pending.length,
      });
    });
  }

  /**
   * Execute an automation
   */
  private async executeAutomation(
    automation: Automation,
    event: OmniEvent,
    context: TemplateContext,
    queue: InstanceQueue,
  ): Promise<ExecutionResult> {
    const start = Date.now();
    queue.activeCount++;

    try {
      // Evaluate conditions
      const conditionResult = evaluateConditionsWithDetails(
        automation.triggerConditions as Parameters<typeof evaluateConditionsWithDetails>[0],
        event.payload as Record<string, unknown>,
      );

      if (!conditionResult.matched) {
        const result: ExecutionResult = {
          automationId: automation.id,
          automationName: automation.name,
          eventId: event.id,
          status: 'skipped',
          conditionsMatched: false,
          actionsExecuted: [],
          executionTimeMs: Date.now() - start,
        };

        await this.logExecution(result);
        return result;
      }

      // Execute actions
      const actionsExecuted = await executeActions(
        automation.actions as Parameters<typeof executeActions>[0],
        context,
        this.deps,
      );

      // Determine overall status
      const allSucceeded = actionsExecuted.every((a) => a.status === 'success');
      const status: AutomationLogStatus = allSucceeded ? 'success' : 'failed';

      const result: ExecutionResult = {
        automationId: automation.id,
        automationName: automation.name,
        eventId: event.id,
        status,
        conditionsMatched: true,
        actionsExecuted,
        executionTimeMs: Date.now() - start,
      };

      await this.logExecution(result);
      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      const result: ExecutionResult = {
        automationId: automation.id,
        automationName: automation.name,
        eventId: event.id,
        status: 'failed',
        conditionsMatched: true,
        actionsExecuted: [],
        error: errorMessage,
        executionTimeMs: Date.now() - start,
      };

      await this.logExecution(result);
      return result;
    } finally {
      queue.activeCount--;

      // Process next in queue if any
      if (queue.pending.length > 0) {
        const next = queue.pending.shift();
        if (next) {
          const result = await this.executeAutomation(next.automation, next.event, next.context, queue);
          next.resolve(result);
        }
      }
    }
  }

  /**
   * Log execution result
   */
  private async logExecution(result: ExecutionResult): Promise<void> {
    if (this.logger) {
      await this.logger({
        automationId: result.automationId,
        eventId: result.eventId,
        status: result.status,
        conditionsMatched: result.conditionsMatched,
        actionsExecuted: result.actionsExecuted,
        error: result.error,
        executionTimeMs: result.executionTimeMs,
      });
    }

    logger.info('Automation executed', {
      automationId: result.automationId,
      automationName: result.automationName,
      eventId: result.eventId,
      status: result.status,
      conditionsMatched: result.conditionsMatched,
      actionsCount: result.actionsExecuted.length,
      executionTimeMs: result.executionTimeMs,
    });
  }

  /**
   * Get queue metrics
   */
  getMetrics(): { instanceQueues: Array<{ instanceId: string; activeCount: number; pendingCount: number }> } {
    const instanceQueues = Array.from(this.instanceQueues.values()).map((q) => ({
      instanceId: q.instanceId,
      activeCount: q.activeCount,
      pendingCount: q.pending.length,
    }));

    return { instanceQueues };
  }

  /**
   * Test an automation against a sample event (dry run)
   */
  async testAutomation(
    automation: Automation,
    event: { type: string; payload: Record<string, unknown> },
  ): Promise<{
    matched: boolean;
    conditions: Array<{ field: string; operator: string; matched: boolean }>;
    actions: Array<{ type: string; wouldExecute: boolean }>;
    dryRun: true;
  }> {
    // Evaluate conditions
    const conditionResult = evaluateConditionsWithDetails(
      automation.triggerConditions as Parameters<typeof evaluateConditionsWithDetails>[0],
      event.payload,
    );

    // Map actions
    const actions = (automation.actions as { type: string }[]).map((action) => ({
      type: action.type,
      wouldExecute: conditionResult.matched,
    }));

    return {
      matched: conditionResult.matched,
      conditions: conditionResult.conditions.map((c) => ({
        field: c.field,
        operator: c.operator,
        matched: c.matched,
      })),
      actions,
      dryRun: true,
    };
  }
}

/**
 * Create an automation engine
 */
export function createAutomationEngine(config?: Partial<EngineConfig>): AutomationEngine {
  return new AutomationEngine({
    defaultConcurrency: config?.defaultConcurrency ?? 5,
    instanceConcurrencyOverrides: config?.instanceConcurrencyOverrides,
  });
}
