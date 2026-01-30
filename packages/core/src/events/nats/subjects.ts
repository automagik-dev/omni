/**
 * NATS subject utilities for hierarchical event addressing
 *
 * Subject pattern: {domain}.{action}.{channelType}.{instanceId}
 * Examples:
 *   message.received.whatsapp-baileys.wa-001
 *   instance.connected.discord.dc-002
 *
 * Subscribe patterns:
 *   message.received.>              - All message.received events
 *   message.received.whatsapp-baileys.> - All WhatsApp message.received events
 *   message.*.whatsapp-baileys.>    - All WhatsApp message events
 *   instance.connected.>            - All instance connections
 */

import type { ChannelType } from '../../types/channel';
import type { CoreEventType, EventType } from '../types';

/**
 * Build a full subject for publishing an event
 *
 * @param eventType - The event type (e.g., 'message.received')
 * @param channelType - The channel type (e.g., 'whatsapp-baileys')
 * @param instanceId - The instance ID (e.g., 'wa-001')
 * @returns Full subject string
 *
 * @example
 * buildSubject('message.received', 'whatsapp-baileys', 'wa-001')
 * // → 'message.received.whatsapp-baileys.wa-001'
 */
export function buildSubject(eventType: EventType, channelType: ChannelType, instanceId: string): string {
  return `${eventType}.${channelType}.${instanceId}`;
}

/**
 * Build a subject pattern for subscribing
 *
 * @param options - Pattern options
 * @returns Subject pattern string with wildcards
 *
 * @example
 * // All message.received events
 * buildSubscribePattern({ eventType: 'message.received' })
 * // → 'message.received.>'
 *
 * // All WhatsApp message events
 * buildSubscribePattern({ channelType: 'whatsapp-baileys' })
 * // → '*.whatsapp-baileys.>'
 *
 * // Specific instance
 * buildSubscribePattern({ eventType: 'message.received', channelType: 'whatsapp-baileys', instanceId: 'wa-001' })
 * // → 'message.received.whatsapp-baileys.wa-001'
 */
export function buildSubscribePattern(
  options: {
    eventType?: CoreEventType | EventType | '*';
    channelType?: ChannelType | '*';
    instanceId?: string | '>';
  } = {},
): string {
  const { eventType = '>', channelType, instanceId = '>' } = options;

  // If only eventType is provided, use simple wildcard
  if (!channelType && instanceId === '>') {
    return eventType === '>' ? '>' : `${eventType}.>`;
  }

  // Build full pattern
  const parts: string[] = [];

  // Event type part (can be specific or wildcard)
  if (eventType === '>') {
    parts.push('*');
    parts.push('*'); // domain.action needs two wildcards
  } else {
    // Event type like 'message.received' becomes two parts
    parts.push(...eventType.split('.'));
  }

  // Channel type part
  parts.push(channelType ?? '*');

  // Instance ID part
  parts.push(instanceId);

  return parts.join('.');
}

/**
 * Parsed subject structure
 */
export interface ParsedSubject {
  domain: string;
  action: string;
  eventType: string;
  channelType: string;
  instanceId: string;
}

/**
 * Parse a subject back into its components
 *
 * @param subject - Full subject string
 * @returns Parsed components or null if invalid
 *
 * @example
 * parseSubject('message.received.whatsapp-baileys.wa-001')
 * // → { domain: 'message', action: 'received', channelType: 'whatsapp-baileys', instanceId: 'wa-001' }
 */
export function parseSubject(subject: string): ParsedSubject | null {
  const parts = subject.split('.');

  // Minimum 4 parts: domain.action.channelType.instanceId
  if (parts.length < 4) {
    return null;
  }

  const [domain, action, channelType, ...rest] = parts;
  const instanceId = rest.join('.'); // Instance ID can contain dots

  // All parts must be defined
  if (!domain || !action || !channelType || !instanceId) {
    return null;
  }

  return {
    domain,
    action,
    eventType: `${domain}.${action}`,
    channelType,
    instanceId,
  };
}

/**
 * Convert a simple event type to a subject pattern
 * Used for backward compatibility with simple subscribe(type, handler) calls
 *
 * @param eventType - Event type like 'message.received'
 * @returns Subject pattern for subscribing
 */
export function eventTypeToPattern(eventType: EventType): string {
  // For core events, subscribe to all channels and instances
  return `${eventType}.>`;
}

/**
 * Check if a subject matches a pattern
 *
 * @param subject - The actual subject
 * @param pattern - The pattern to match against
 * @returns true if subject matches pattern
 */
export function matchesPattern(subject: string, pattern: string): boolean {
  const subjectParts = subject.split('.');
  const patternParts = pattern.split('.');

  let si = 0;
  let pi = 0;

  while (pi < patternParts.length && si < subjectParts.length) {
    const pp = patternParts[pi];

    if (pp === '>') {
      // '>' matches everything remaining
      return true;
    }

    if (pp === '*') {
      // '*' matches exactly one token
      si++;
      pi++;
      continue;
    }

    // Exact match required
    if (pp !== subjectParts[si]) {
      return false;
    }

    si++;
    pi++;
  }

  // Both must be exhausted (unless pattern ends with >)
  return si === subjectParts.length && pi === patternParts.length;
}
