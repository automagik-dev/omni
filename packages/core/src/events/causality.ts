/**
 * Ambient event-causality context (#957, RFC #925 G3).
 *
 * The stamping rule is "causationId = the event I am reacting to", but the
 * code that PUBLISHES the reaction is often several layers away from the code
 * that CONSUMED the trigger — the automation engine calls an API-side
 * `sendMessage` callback which calls a channel plugin whose
 * `emitMessageSent` publishes the event. Threading an explicit parameter
 * through every plugin's `sendMessage` signature would touch every channel
 * package for a value that is pure observability metadata.
 *
 * Instead, a consumer that is about to react to an event wraps its reaction
 * in `runWithEventCausality({ correlationId, causationId: event.id }, ...)`,
 * and the publish factory (`createOmniEvent`) falls back to the ambient
 * context for whichever of the two fields the publish did not set explicitly.
 * AsyncLocalStorage propagates through the entire await chain, so every
 * publish the reaction performs — however deep — is stamped as caused by the
 * trigger.
 *
 * Trust and precedence:
 *   - EXPLICIT metadata always wins (a republish that already derived its
 *     parent — e.g. the emit_event action — is more precise than ambient).
 *   - The context carries only ids the CONSUMER read from a delivered
 *     envelope, never payload claims. It is deliberately NOT used for the
 *     tenant — the trusted tenant has its own explicit threading (G5,
 *     ADR-0008) precisely because it is a security boundary; causality is
 *     lineage metadata, where an ambient default is the right trade.
 *   - Outside any context (HTTP ingress, boot, timers armed outside a
 *     consumer scope) the store is empty and publishes behave byte-identical
 *     to pre-#957: roots self-reference their correlation and carry no
 *     causation.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface EventCausalityContext {
  /** Correlation of the flow being continued. */
  correlationId?: string;
  /** Id of the event being reacted to — the parent of every publish inside the scope. */
  causationId?: string;
}

const storage = new AsyncLocalStorage<EventCausalityContext>();

/** Run `fn` with `context` as the ambient causality for every publish inside it. */
export function runWithEventCausality<T>(context: EventCausalityContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The ambient causality context, or undefined outside any consumer scope. */
export function currentEventCausality(): EventCausalityContext | undefined {
  return storage.getStore();
}
