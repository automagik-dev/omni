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
import { classifyEnvelope } from '../events/envelope';
import type { EventType, GenericEventPayload, OmniEvent } from '../events/types';
import { generateId } from '../ids';
import { createLogger } from '../logger';
import { type ActionDependencies, executeActions } from './actions';
import { evaluateConditionsWithDetails } from './conditions';
import {
  type ConversationKey,
  type DebounceEnvelopeStamp,
  DebounceManager,
  type DebouncedMessage,
  buildConversationKey,
} from './debounce';
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
 *
 * `trustedTenantId` is the executed event's classified envelope tenant (G5,
 * ADR-0008) — `null` for a legacy envelope or a refused quarantine. The
 * API-side logger currently CANNOT scope its `automation_logs` write with it:
 * that table derives its tenant from the G2-`unowned` `automations` parent,
 * so scoping is G6-gated — but the value is threaded now so the G6 unblock is
 * a service-side change only.
 */
export type ExecutionLogger = (log: NewAutomationLog, trustedTenantId?: string | null) => Promise<void>;

/**
 * Configuration for the automation engine
 */
export interface EngineConfig {
  defaultConcurrency: number;
  instanceConcurrencyOverrides?: Record<string, number>;
  /** Maximum pending items per queue before applying backpressure (default: 100) */
  maxQueueDepth?: number;
  /**
   * Interval in milliseconds for the subscription reconciler to verify each
   * enabled trigger has a live subscription and re-subscribe if missing or
   * dead. Default: 30_000ms. Set to 0 to disable (tests).
   *
   * The reconciler closes the gap diagnosed in #546 where a disable→enable
   * toggle (or NATS server reset) leaves the engine without a working
   * subscription even though the API reports the automation as enabled.
   */
  reconcileIntervalMs?: number;
}

/**
 * Error thrown when queue is full, triggering NATS backpressure
 */
export class QueueFullError extends Error {
  constructor(
    public readonly instanceId: string,
    public readonly queueDepth: number,
    public readonly maxDepth: number,
  ) {
    super(`Queue full for instance ${instanceId}: ${queueDepth}/${maxDepth} pending`);
    this.name = 'QueueFullError';
  }
}

/**
 * Automation Engine
 */
export class AutomationEngine {
  private subscriptions = new Map<string, Subscription>();
  private instanceQueues = new Map<string, InstanceQueue>();
  private debounceManagers = new Map<string, DebounceManager>(); // automationId -> manager
  private automations: Automation[] = [];
  private eventBus: EventBus | null = null;
  private deps: ActionDependencies;
  private logger: ExecutionLogger | null = null;
  private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
  private reconcileEnabled = false;
  private reconcilePromise: Promise<void> | null = null;

  constructor(private config: EngineConfig) {
    this.deps = {
      eventBus: null,
      sendMessage: undefined,
      callAgent: undefined,
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
      callAgent: deps.callAgent,
      staleIdleTimeoutGate: deps.staleIdleTimeoutGate,
      releaseIdleTimeoutClaim: deps.releaseIdleTimeoutClaim,
    };
    this.automations = automations.filter((a) => a.enabled);

    await this.reconcileSubscriptions();
    this.rebuildDebounceManagers();
    this.startReconcileTimer();

    logger.info(`Automation engine started with ${this.automations.length} automations`);
  }

  /**
   * Stop the engine
   */
  async stop(): Promise<void> {
    this.stopReconcileTimer();

    // Unsubscribe from all events
    for (const subscription of this.subscriptions.values()) {
      await subscription.unsubscribe();
    }
    this.subscriptions.clear();

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
   *
   * Reconciles subscriptions in place rather than tearing down and rebuilding,
   * so the durable consumer's iterator is preserved when the trigger set is
   * unchanged. The reconciler is also responsible for re-creating subscriptions
   * for triggers that became enabled (toggle false→true) and dropping
   * subscriptions for triggers that became orphaned (last automation disabled).
   * See #546.
   */
  async reload(automations: Automation[]): Promise<void> {
    if (!this.eventBus) {
      // Engine never started — nothing to do.
      this.automations = automations.filter((a) => a.enabled);
      return;
    }
    this.automations = automations.filter((a) => a.enabled);
    await this.reconcileSubscriptions();
    this.rebuildDebounceManagers();
  }

  /**
   * Run the subscription reconciler on demand.
   *
   * Public so operators / health checks can force a sync. Idempotent.
   */
  async reconcile(): Promise<void> {
    if (!this.eventBus) return;
    await this.reconcileSubscriptions();
  }

  /**
   * Diff expected (from current automations) vs active subscriptions and
   * subscribe / unsubscribe to converge. Also re-subscribes any subscription
   * whose underlying iterator has died (e.g., NATS server reset).
   *
   * Single-flight: concurrent callers (periodic timer, manual reconcile(),
   * reload()) await the same in-flight pass instead of mutating the
   * subscriptions Map in parallel — without this guard a timer tick that
   * overlaps a reload could double-subscribe a trigger and leak the second
   * handle. See gemini review on PR #587.
   */
  private async reconcileSubscriptions(): Promise<void> {
    if (!this.eventBus) return;
    if (this.reconcilePromise) return this.reconcilePromise;
    this.reconcilePromise = this.doReconcileSubscriptions().finally(() => {
      this.reconcilePromise = null;
    });
    return this.reconcilePromise;
  }

  private async doReconcileSubscriptions(): Promise<void> {
    if (!this.eventBus) return;

    const expectedTriggers = new Set(this.automations.map((a) => a.triggerEventType));

    // Drop subscriptions whose trigger is no longer enabled.
    for (const [eventType, subscription] of this.subscriptions) {
      if (!expectedTriggers.has(eventType)) {
        await subscription.unsubscribe().catch((err) => {
          logger.warn('Failed to unsubscribe orphan trigger', { eventType, error: String(err) });
        });
        this.subscriptions.delete(eventType);
        logger.info(`Unsubscribed from ${eventType}.* (no enabled automations)`);
      }
    }

    // Subscribe (or re-subscribe if dead) for each expected trigger.
    for (const eventType of expectedTriggers) {
      const existing = this.subscriptions.get(eventType);
      if (existing && this.isSubscriptionAlive(existing)) {
        continue;
      }
      if (existing) {
        // Stale handle — best-effort unsubscribe before replacing.
        await existing.unsubscribe().catch(() => {});
        this.subscriptions.delete(eventType);
        logger.warn('Replacing dead subscription', { eventType });
      }
      const subscription = await this.subscribeForTrigger(eventType);
      this.subscriptions.set(eventType, subscription);
    }
  }

  /**
   * Create one durable subscription for a trigger event type.
   */
  private async subscribeForTrigger(eventType: string): Promise<Subscription> {
    if (!this.eventBus) {
      throw new Error('Event bus not initialized');
    }
    // Durable consumer name — ephemeral consumers are GC'd by NATS after 5s
    // idle, which silently stops automations with low-frequency triggers
    // (chat.idle_timeout, chat.archived, handoff, etc.). See #445.
    const durable = `automation-engine-${eventType.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const subscription = await this.eventBus.subscribePattern(
      `${eventType}.>`,
      async (event) => {
        await this.handleEvent(event);
      },
      {
        durable,
        queue: 'automation-engine',
        startFrom: 'new',
        maxRetries: 3,
        retryDelayMs: 1000,
      },
    );
    logger.info(`Subscribed to ${eventType}.*`, { durable });
    return subscription;
  }

  private isSubscriptionAlive(subscription: Subscription): boolean {
    // Default to alive when the bus implementation does not expose liveness.
    return subscription.isAlive ? subscription.isAlive() : true;
  }

  private rebuildDebounceManagers(): void {
    // Drop debounce managers whose automation is no longer enabled.
    const enabledIds = new Set(this.automations.map((a) => a.id));
    for (const id of this.debounceManagers.keys()) {
      if (!enabledIds.has(id)) {
        this.debounceManagers.get(id)?.flushAll();
        this.debounceManagers.delete(id);
      }
    }
    for (const automation of this.automations) {
      if (automation.debounce && automation.debounce.mode !== 'none' && !this.debounceManagers.has(automation.id)) {
        this.setupDebounceManager(automation);
      }
    }
  }

  /**
   * Start the periodic reconciler.
   *
   * Recursive setTimeout pattern (not setInterval) so a slow reconcile cannot
   * stack ticks — the next tick is only scheduled after the current pass
   * resolves. Combined with the single-flight guard in reconcileSubscriptions,
   * this gives at-most-one in-flight reconcile across all callers. See gemini
   * review on PR #587.
   */
  private startReconcileTimer(): void {
    this.stopReconcileTimer();
    const intervalMs = this.config.reconcileIntervalMs ?? 30_000;
    if (intervalMs <= 0) return;
    this.reconcileEnabled = true;
    this.scheduleNextReconcile(intervalMs);
  }

  private scheduleNextReconcile(intervalMs: number): void {
    if (!this.reconcileEnabled) return;
    this.reconcileTimer = setTimeout(() => {
      // Run the reconcile then schedule the next tick. We chain in finally so
      // a thrown error doesn't stop the loop — only stopReconcileTimer does.
      this.reconcileSubscriptions()
        .catch((err) => {
          logger.error('Reconciler tick failed', { error: String(err) });
        })
        .finally(() => {
          this.scheduleNextReconcile(intervalMs);
        });
    }, intervalMs);
    // Don't keep the process alive just for the reconciler.
    if (typeof this.reconcileTimer === 'object' && this.reconcileTimer && 'unref' in this.reconcileTimer) {
      (this.reconcileTimer as { unref: () => void }).unref();
    }
  }

  private stopReconcileTimer(): void {
    this.reconcileEnabled = false;
    if (this.reconcileTimer) {
      clearTimeout(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  /**
   * Consumer-side stale-event gate for `chat.idle_timeout` — defense in depth
   * against NATS replay of historical idle-timeout events whose chat state
   * has since changed (sequence completed, customer replied, handoff,
   * close-contact). The sweeper already filters these at publish time, but a
   * durable-consumer reset (e.g. config-incompat delete+recreate on toggle
   * or restart — see #546 follow-on) replays anything still in the SYSTEM
   * stream's retention window. Without this gate the engine fires
   * call_agent + send_message for every replayed event regardless of the
   * chat's current state — the spam pattern reported on 2026-05-01.
   *
   * Returns `{ skip: true }` when the event should be dropped (gate said skip).
   * Returns `{ skip: false }` when the event should proceed (no gate, missing
   * payload fields, gate said proceed, or gate threw — fail-open by design);
   * `claimToken` is set when the gate recorded a delivery claim that must be
   * released if handling the event then fails.
   */
  private async shouldSkipStaleIdleTimeout(event: OmniEvent): Promise<{ skip: boolean; claimToken?: string }> {
    if (event.type !== 'chat.idle_timeout' || !this.deps.staleIdleTimeoutGate) return { skip: false };
    const payload = event.payload as { chatId?: string; instanceId?: string; sequenceIndex?: number };
    const chatId = payload?.chatId;
    const payloadInstanceId = payload?.instanceId ?? event.metadata.instanceId;
    if (!chatId || !payloadInstanceId) return { skip: false };
    const eventSequenceIndex = typeof payload?.sequenceIndex === 'number' ? payload.sequenceIndex : null;

    try {
      // Thread the envelope's trusted tenant (G5): the gate's DB reads scope
      // themselves from it. A legacy envelope threads null and the gate reads
      // ambient exactly as before. A quarantine-class envelope never reaches
      // here (the subscription layer terms it before any handler runs); if one
      // does, classify refuses a tenant and the gate stays unscoped rather
      // than trusting a malformed claim.
      const classification = classifyEnvelope(event.metadata);
      const trustedTenantId = classification.world === 'tenant' ? classification.tenantId : null;
      const verdict = await this.deps.staleIdleTimeoutGate(
        chatId,
        payloadInstanceId,
        eventSequenceIndex,
        trustedTenantId,
      );
      if (verdict.skip) {
        logger.info('Skipping stale chat.idle_timeout event', {
          eventId: event.id,
          chatId,
          instanceId: payloadInstanceId,
          eventSequenceIndex,
          reason: verdict.reason ?? 'unknown',
        });
        return { skip: true };
      }
      return { skip: false, ...(verdict.claimToken ? { claimToken: verdict.claimToken } : {}) };
    } catch (err) {
      // Fail-open — better to fire a redundant follow-up than to silently
      // drop legitimate events when the DB is flaky.
      logger.warn('staleIdleTimeoutGate threw, proceeding without skip', {
        eventId: event.id,
        chatId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
    return { skip: false };
  }

  /**
   * Give back a delivery claim after the event failed to be handled, so the
   * NATS redelivery is treated as a first delivery instead of a duplicate.
   * Never throws — the caller is already propagating a failure.
   */
  private async releaseIdleTimeoutClaim(claimToken: string, event: OmniEvent): Promise<void> {
    if (!this.deps.releaseIdleTimeoutClaim) return;
    try {
      await this.deps.releaseIdleTimeoutClaim(claimToken);
    } catch (err) {
      logger.warn('releaseIdleTimeoutClaim failed', {
        eventId: event.id,
        error: err instanceof Error ? err.message : String(err),
      });
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

    const gate = await this.shouldSkipStaleIdleTimeout(event);
    if (gate.skip) {
      return;
    }

    logger.debug(`Processing event ${eventType} for ${matchingAutomations.length} automation(s)`, {
      eventId: event.id,
      instanceId,
    });

    // Sort by priority (higher first)
    const sortedAutomations = [...matchingAutomations].sort((a, b) => b.priority - a.priority);

    try {
      for (const automation of sortedAutomations) {
        // Check if this automation has debounce
        if (automation.debounce && automation.debounce.mode !== 'none') {
          await this.handleDebounced(automation, event);
        } else {
          await this.handleImmediate(automation, event);
        }
      }
    } catch (err) {
      // The delivery failed (e.g. QueueFullError → the subscriber naks and
      // NATS redelivers). Hand the claim back before rethrowing, otherwise the
      // redelivery meets this event's own claim and the follow-up is dropped
      // forever — fail-closed, which this gate must never do.
      if (gate.claimToken) await this.releaseIdleTimeoutClaim(gate.claimToken, event);
      throw err;
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

    // Classify the envelope BEFORE the event enters a window (G5, ADR-0008):
    // the flush callback builds a SYNTHETIC event, so the window must carry the
    // producer-stamped world or a debounced tenant automation would silently
    // degrade to legacy at flush. A quarantine-class envelope never enters a
    // window — it goes through the immediate path, whose central refusal in
    // `executeAutomation` logs it without running any action.
    const classification = classifyEnvelope(event.metadata);
    if (classification.world === 'quarantine') {
      await this.handleImmediate(automation, event);
      return;
    }
    const stamp: DebounceEnvelopeStamp | null =
      classification.world === 'tenant'
        ? { envelopeVersion: classification.envelopeVersion, tenantId: classification.tenantId }
        : null;

    // Build debounced message
    const content = payload.content as { type: string; text?: string } | undefined;
    const message: DebouncedMessage = {
      type: content?.type ?? 'unknown',
      text: content?.text,
      timestamp: event.timestamp,
      payload,
    };

    manager.addMessage(key, message, from, instanceId, stamp);
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
      stamp: DebounceEnvelopeStamp | null,
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

      // Create a synthetic event. The window's envelope stamp (G5) is carried
      // onto the synthetic metadata — same fields, same version the producer
      // stamped — so `executeAutomation`'s classification sees exactly the
      // world the original events belonged to. A legacy window stamps nothing.
      const syntheticEvent: OmniEvent = {
        id: generateId(),
        type: automation.triggerEventType as EventType,
        payload: lastMessage.payload as GenericEventPayload,
        metadata: {
          correlationId: generateId(),
          instanceId,
          ...(stamp ? { envelopeVersion: stamp.envelopeVersion, tenantId: stamp.tenantId } : {}),
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

    // Check if queue is at capacity (backpressure)
    const maxQueueDepth = this.config.maxQueueDepth ?? 100;
    if (queue.pending.length >= maxQueueDepth) {
      logger.warn('Queue full, applying backpressure', {
        instanceId,
        queueDepth: queue.pending.length,
        maxDepth: maxQueueDepth,
      });
      throw new QueueFullError(instanceId, queue.pending.length, maxQueueDepth);
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

    // Classify the envelope ONCE for the whole execution (G5, ADR-0008). The
    // trusted tenant is read from producer-stamped METADATA — the payload can
    // carry any claim it likes and it never reaches this decision.
    const classification = classifyEnvelope(event.metadata);
    const trustedTenantId = classification.world === 'tenant' ? classification.tenantId : null;

    try {
      if (classification.world === 'quarantine') {
        // Defence in depth: the subscription layer already refuses quarantined
        // envelopes before any handler runs. If one reaches here anyway,
        // executing its actions "globally" is exactly the fallback ADR-0008
        // forbids — refuse, log, alert.
        logger.error('Refusing to execute automation for a quarantine-class envelope', {
          automationId: automation.id,
          eventId: event.id,
          reason: classification.reason,
        });
        const result: ExecutionResult = {
          automationId: automation.id,
          automationName: automation.name,
          eventId: event.id,
          status: 'failed',
          conditionsMatched: false,
          actionsExecuted: [],
          error: `refused quarantine-class envelope (${classification.reason})`,
          executionTimeMs: Date.now() - start,
        };
        await this.logExecution(result, null);
        return result;
      }

      // Evaluate conditions — merge metadata so conditions can reference
      // fields like instanceId, channelType, correlationId etc.
      const conditionPayload = {
        ...(event.metadata as unknown as Record<string, unknown>),
        ...(event.payload as Record<string, unknown>),
      };
      const conditionResult = evaluateConditionsWithDetails(
        automation.triggerConditions as Parameters<typeof evaluateConditionsWithDetails>[0],
        conditionPayload,
        automation.conditionLogic ?? 'and',
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

        await this.logExecution(result, trustedTenantId);
        return result;
      }

      // Execute actions, threading the envelope's trusted tenant (null = legacy).
      const actionsExecuted = await executeActions(
        automation.actions as Parameters<typeof executeActions>[0],
        context,
        this.deps,
        trustedTenantId,
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

      await this.logExecution(result, trustedTenantId);
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

      await this.logExecution(result, trustedTenantId);
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
  private async logExecution(result: ExecutionResult, trustedTenantId: string | null = null): Promise<void> {
    if (this.logger) {
      await this.logger(
        {
          automationId: result.automationId,
          eventId: result.eventId,
          status: result.status,
          conditionsMatched: result.conditionsMatched,
          actionsExecuted: result.actionsExecuted,
          error: result.error,
          executionTimeMs: result.executionTimeMs,
        },
        trustedTenantId,
      );
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
      automation.conditionLogic ?? 'and',
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
    maxQueueDepth: config?.maxQueueDepth ?? 100,
  });
}
