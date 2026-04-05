/**
 * NATS turn event helpers — plain NATS signaling for turn lifecycle.
 *
 * Turn events use plain NATS (not JetStream) for real-time signaling.
 * Topic format: omni.turn.{event}.{instanceId}.{chatId}
 *
 * Events:
 *   omni.turn.open.{instanceId}.{chatId}
 *   omni.turn.done.{instanceId}.{chatId}
 *   omni.turn.nudge.{instanceId}.{chatId}
 *   omni.turn.timeout.{instanceId}.{chatId}
 */

import { createLogger } from '@omni/core';
import { type NatsConnection, StringCodec, connect } from 'nats';

const log = createLogger('turn-events');
const sc = StringCodec();

let nc: NatsConnection | null = null;

/**
 * Initialize the turn events NATS connection.
 * Should be called once during API startup.
 */
export async function initTurnEvents(natsUrl: string): Promise<void> {
  if (nc && !nc.isClosed()) return;

  try {
    nc = await connect({
      servers: natsUrl,
      name: 'omni-turn-events',
      reconnect: true,
      maxReconnectAttempts: -1,
      reconnectTimeWait: 2000,
    });
    log.info('Turn events NATS connected', { url: natsUrl });
  } catch (error) {
    log.warn('Failed to connect NATS for turn events', { error: String(error) });
  }
}

/**
 * Close the turn events NATS connection.
 */
export async function closeTurnEvents(): Promise<void> {
  if (nc && !nc.isClosed()) {
    await nc.drain();
    nc = null;
  }
}

function publish(topic: string, payload: object): void {
  if (!nc || nc.isClosed()) {
    log.warn('Cannot publish turn event: NATS not connected', { topic });
    return;
  }
  nc.publish(topic, sc.encode(JSON.stringify(payload)));
}

// ============================================================================
// Event publishers
// ============================================================================

export interface TurnOpenEvent {
  turnId: string;
  messageId: string;
  agentId: string;
  timestamp: string;
}

export function publishTurnOpen(instanceId: string, chatId: string, event: TurnOpenEvent): void {
  const topic = `omni.turn.open.${instanceId}.${chatId}`;
  publish(topic, event);
  log.debug('Published turn.open', { turnId: event.turnId, instanceId, chatId });
}

export interface TurnDoneEvent {
  turnId: string;
  action: string;
  messageId?: string;
  emoji?: string;
  reason?: string;
  duration: number;
  nudgeCount: number;
  messagesSent?: number;
}

export function publishTurnDone(instanceId: string, chatId: string, event: TurnDoneEvent): void {
  const topic = `omni.turn.done.${instanceId}.${chatId}`;
  publish(topic, event);
  log.debug('Published turn.done', { turnId: event.turnId, action: event.action, instanceId });
}

export interface TurnNudgeEvent {
  turnId: string;
  nudgeCount: number;
  idleSec: number;
  message: string;
}

export function publishTurnNudge(instanceId: string, chatId: string, event: TurnNudgeEvent): void {
  const topic = `omni.turn.nudge.${instanceId}.${chatId}`;
  publish(topic, event);
  log.debug('Published turn.nudge', { turnId: event.turnId, nudgeCount: event.nudgeCount, instanceId });
}

export interface TurnTimeoutEvent {
  turnId: string;
  duration: number;
  nudgeCount: number;
  fallbackSent: boolean;
}

export function publishTurnTimeout(instanceId: string, chatId: string, event: TurnTimeoutEvent): void {
  const topic = `omni.turn.timeout.${instanceId}.${chatId}`;
  publish(topic, event);
  log.debug('Published turn.timeout', { turnId: event.turnId, instanceId });
}
