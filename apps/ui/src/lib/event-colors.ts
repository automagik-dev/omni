/**
 * Event type color mapping for visual distinction
 */

import type { BadgeProps } from '@/components/ui/badge';

interface EventTypeStyle {
  border: string;
  badge: BadgeProps['variant'];
  bgClass?: string;
}

/**
 * Mapping of event types to their visual styles
 */
export const EVENT_TYPE_COLORS: Record<string, EventTypeStyle> = {
  'message.received': {
    border: 'border-l-info',
    badge: 'info',
    bgClass: 'bg-info/5',
  },
  'message.sent': {
    border: 'border-l-primary',
    badge: 'default',
    bgClass: 'bg-primary/5',
  },
  'instance.connected': {
    border: 'border-l-success',
    badge: 'success',
    bgClass: 'bg-success/5',
  },
  'instance.disconnected': {
    border: 'border-l-destructive',
    badge: 'destructive',
    bgClass: 'bg-destructive/5',
  },
  'instance.qr_code_generated': {
    border: 'border-l-warning',
    badge: 'warning',
    bgClass: 'bg-warning/5',
  },
  'automation.executed': {
    border: 'border-l-primary',
    badge: 'default',
    bgClass: 'bg-primary/5',
  },
  'person.created': {
    border: 'border-l-success',
    badge: 'success',
    bgClass: 'bg-success/5',
  },
  'person.updated': {
    border: 'border-l-info',
    badge: 'info',
    bgClass: 'bg-info/5',
  },
};

const DEFAULT_STYLE: EventTypeStyle = {
  border: 'border-l-muted',
  badge: 'secondary',
  bgClass: 'bg-muted/5',
};

/**
 * Get the border color class for an event type
 */
export function getEventTypeBorder(eventType: string): string {
  return EVENT_TYPE_COLORS[eventType]?.border || DEFAULT_STYLE.border;
}

/**
 * Get the badge variant for an event type
 */
export function getEventTypeBadge(eventType: string): BadgeProps['variant'] {
  return EVENT_TYPE_COLORS[eventType]?.badge || DEFAULT_STYLE.badge;
}

/**
 * Get the background class for an event type
 */
export function getEventTypeBgClass(eventType: string): string {
  return EVENT_TYPE_COLORS[eventType]?.bgClass || DEFAULT_STYLE.bgClass || '';
}

/**
 * Get complete style object for an event type
 */
export function getEventTypeStyle(eventType: string): EventTypeStyle {
  return EVENT_TYPE_COLORS[eventType] ?? DEFAULT_STYLE;
}
