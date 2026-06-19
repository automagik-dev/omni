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
 */

import { createLogger } from '@omni/core';
import type { NatsConnection, Subscription } from 'nats';
import { StringCodec } from 'nats';
import type { AgentHeartbeatEvent } from './turn-events';
import type { TurnService } from './turns';

const log = createLogger('agent-heartbeat');
const sc = StringCodec();

const HEARTBEAT_SUBJECT = 'omni.agent.heartbeat.>';

export interface AgentHeartbeatStartOptions {
  natsConnection: NatsConnection;
  turnService: TurnService;
}

export class AgentHeartbeatConsumer {
  private subscription: Subscription | null = null;
  private loop: Promise<void> | null = null;

  start(options: AgentHeartbeatStartOptions): void {
    if (this.subscription) return;

    const { natsConnection, turnService } = options;

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

          turnService.recordActivity(parsed.turnId).catch((error) => {
            log.warn('recordActivity failed for heartbeat (turn likely closed)', {
              turnId: parsed.turnId,
              error: error instanceof Error ? error.message : String(error),
            });
          });

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
