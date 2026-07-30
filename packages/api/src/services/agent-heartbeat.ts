/**
 * Agent heartbeat consumer — converts inbound `omni.agent.heartbeat.*` events
 * into `turnService.recordActivity(turnId)` calls.
 *
 * Background: omni's turn-monitor decides "idle" by reading `lastActivityAt`,
 * which auth middleware bumps on every API call from the scoped key. Real
 * Claude Code work (tool calls, file edits, internal SDK loops) does not
 * round-trip through omni, so a 200s busy session looks identical to a 200s
 * idle session and trips the 120s nudge threshold incorrectly.
 *
 * The genie heartbeat publisher (see `automagik-dev/genie` wish
 * `omni-activity-heartbeat`) emits one event per active session every 30s on
 * `omni.agent.heartbeat.{instanceId}.{chatId}`. This consumer subscribes,
 * validates the payload, and calls `recordActivity(turnId)` — the same field
 * that gates the existing nudge logic. Genuinely idle sessions still nudge;
 * actively-working sessions stay below threshold.
 *
 * Backward compatibility: pre-publisher genie clients keep the current
 * behavior (they trip nudges); newer clients suppress their own false nudges.
 * No flag day.
 *
 * WORKER TENANT CONTEXT (wish: omni-full-multitenancy, G5; ADR-0008)
 * ------------------------------------------------------------------
 * This is a CONSUMER — a raw NATS subscription, not an eventBus one — and it
 * used to call `recordActivity` straight onto the ambient pool without ever
 * going through `classifyEnvelope`. It therefore had no world at all: no
 * tenant, no legacy/quarantine distinction, and a write on whatever handle
 * happened to be ambient. It is one of the two unscoped worker callers named in
 * the `services/turns.ts::turns` registry justification.
 *
 * WHERE THE TENANT COMES FROM. A heartbeat is published by an EXTERNAL client
 * as raw JSON, so nothing in the body may be believed — ADR-0008 requires the
 * tenant to come from an authenticated context or a LOADED resource's persisted
 * ownership. The message names an `instanceId`, and `instances` is the ownership
 * ROOT, so the instance-owner registry (fed only by `instances` rows this
 * process already read) is the trusted answer. `parseHeartbeat` returns ONLY its
 * four validated fields, so a publisher cannot smuggle a `tenantId` or an
 * `envelopeVersion` claim into the derivation. That tenant is then STAMPED onto
 * an envelope and handed to `runConsumerInTenantContext`, which classifies it —
 * so this consumer inherits exactly the same three worlds as every other one.
 *
 * DUAL WORLD: with no `db` wired (the shape every existing test constructs), or
 * for an instance whose ownership this process never observed (every instance,
 * flag-off), the call is the pre-G5 ambient one, byte for byte.
 */

import { createLogger, stampTenantEnvelope } from '@omni/core';
import type { Database } from '@omni/db';
import type { NatsConnection, Subscription } from 'nats';
import { StringCodec } from 'nats';
import { lookupInstanceOwner } from '../tenancy/instance-owner-registry';
import { runDetachedFromTenantScope } from '../tenancy/tenant-scope';
import { runConsumerInTenantContext } from '../tenancy/worker-tenant-context';
import type { AgentHeartbeatEvent } from './turn-events';
import type { TurnService } from './turns';

const log = createLogger('agent-heartbeat');
const sc = StringCodec();

const HEARTBEAT_SUBJECT = 'omni.agent.heartbeat.>';

export interface AgentHeartbeatStartOptions {
  natsConnection: NatsConnection;
  turnService: TurnService;
  /**
   * The runtime pool a per-message worker scope opens its transaction on.
   *
   * OPTIONAL, and its absence is the legacy world: without it the activity write
   * is the pre-G5 ambient call. Wiring it (`index.ts`) is what opts this consumer
   * into the tenant world.
   */
  db?: Database;
}

export class AgentHeartbeatConsumer {
  private subscription: Subscription | null = null;
  private loop: Promise<void> | null = null;

  start(options: AgentHeartbeatStartOptions): void {
    if (this.subscription) return;

    const { natsConnection, turnService, db } = options;

    if (natsConnection.isClosed()) {
      log.warn('Cannot start agent-heartbeat: NATS connection is closed');
      return;
    }

    this.subscription = natsConnection.subscribe(HEARTBEAT_SUBJECT);
    log.info('Agent heartbeat consumer started', { subject: HEARTBEAT_SUBJECT });

    const sub = this.subscription;
    this.loop = (async () => {
      for await (const msg of sub) {
        try {
          const raw = sc.decode(msg.data);
          const parsed = parseHeartbeat(raw);
          if (!parsed) {
            log.warn('Discarded malformed agent heartbeat', {
              subject: msg.subject,
              raw: raw.slice(0, 200),
            });
            continue;
          }

          // The activity write, in the heartbeat's world. Detached because this
          // is a fire-and-forget started from the subscription loop; scoped from
          // the instance's PERSISTED ownership, never from the payload.
          void runDetachedFromTenantScope(async () => recordHeartbeatActivity(turnService, db, parsed)).catch(
            (error) => {
              log.warn('recordActivity failed for heartbeat (turn likely closed)', {
                turnId: parsed.turnId,
                error: error instanceof Error ? error.message : String(error),
              });
            },
          );

          log.debug('Agent heartbeat applied', {
            turnId: parsed.turnId,
            instanceId: parsed.instanceId,
            chatId: parsed.chatId,
          });
        } catch (error) {
          log.warn('Failed to process agent heartbeat', {
            subject: msg.subject,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    })();
  }

  async stop(): Promise<void> {
    if (!this.subscription) return;
    this.subscription.unsubscribe();
    this.subscription = null;
    try {
      await this.loop;
    } catch {
      // loop iterator throws on connection drain — already logged above
    } finally {
      this.loop = null;
      log.info('Agent heartbeat consumer stopped');
    }
  }
}

/**
 * Apply one heartbeat's activity write in the right world.
 *
 * With no `db` wired this is the pre-G5 ambient call. With one, the instance's
 * PERSISTED tenant is looked up, stamped onto an envelope, and classified by
 * `runConsumerInTenantContext`: a known owner runs the write inside that
 * tenant's worker transaction; an instance whose ownership this process never
 * observed classifies `legacy` and runs ambient (which fails closed under
 * enforcement — the correct posture, never someone else's tenant).
 */
async function recordHeartbeatActivity(
  turnService: TurnService,
  db: Database | undefined,
  parsed: AgentHeartbeatEvent,
): Promise<void> {
  if (!db) {
    await turnService.recordActivity(parsed.turnId);
    return;
  }
  const trustedTenantId = lookupInstanceOwner(parsed.instanceId);
  const base = { correlationId: `heartbeat-${parsed.turnId}`, instanceId: parsed.instanceId };
  const metadata = trustedTenantId ? stampTenantEnvelope(base, trustedTenantId) : base;
  await runConsumerInTenantContext(db, { metadata }, () => turnService.recordActivity(parsed.turnId));
}

function parseHeartbeat(raw: string): AgentHeartbeatEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;

  const obj = value as Record<string, unknown>;
  const { turnId, instanceId, chatId, timestamp } = obj;

  if (
    typeof turnId !== 'string' ||
    turnId.length === 0 ||
    typeof instanceId !== 'string' ||
    instanceId.length === 0 ||
    typeof chatId !== 'string' ||
    chatId.length === 0 ||
    typeof timestamp !== 'string' ||
    timestamp.length === 0
  ) {
    return null;
  }

  return { turnId, instanceId, chatId, timestamp };
}

// Module-level singleton wired into API startup (mirrors initTurnEvents shape).
let consumer: AgentHeartbeatConsumer | null = null;

/**
 * Initialise the agent heartbeat consumer using the shared turn-events NATS
 * connection. Returns silently when no connection is available.
 */
export function initAgentHeartbeat(options: AgentHeartbeatStartOptions): void {
  if (consumer) return;
  consumer = new AgentHeartbeatConsumer();
  consumer.start(options);
}

/**
 * Stop the agent heartbeat consumer. Safe to call when not running.
 */
export async function closeAgentHeartbeat(): Promise<void> {
  if (!consumer) return;
  await consumer.stop();
  consumer = null;
}
