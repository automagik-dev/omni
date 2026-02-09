/**
 * ActivityFeedItem - Single event row with expandable details
 */

import { Badge } from '@/components/ui/badge';
import { getEventTypeBadge, getEventTypeBorder } from '@/lib/event-colors';
import { fadeInUp } from '@/lib/motion';
import { cn, formatRelativeTime } from '@/lib/utils';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';

interface ActivityFeedItemProps {
  event: {
    id: string;
    eventType: string;
    receivedAt: string;
    instanceId?: string;
    payload?: unknown;
  };
}

export function ActivityFeedItem({ event }: ActivityFeedItemProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const borderClass = getEventTypeBorder(event.eventType);
  const badgeVariant = getEventTypeBadge(event.eventType);

  return (
    <motion.div variants={fadeInUp}>
      <div
        className={cn(
          'group relative rounded-md border-l-4 bg-card/50 p-3 transition-all hover:bg-card/80',
          borderClass,
          isExpanded && 'bg-card/80',
        )}
      >
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex w-full items-center justify-between text-left"
        >
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="flex-shrink-0">
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={badgeVariant} className="font-mono text-[10px] shrink-0">
                  {event.eventType}
                </Badge>
                {event.instanceId && (
                  <span className="text-xs text-muted-foreground font-mono truncate">
                    {event.instanceId.slice(0, 12)}...
                  </span>
                )}
              </div>
            </div>
          </div>
          <span className="text-xs text-muted-foreground shrink-0 ml-2">{formatRelativeTime(event.receivedAt)}</span>
        </button>

        {isExpanded && event.payload ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-3 border-t pt-3"
          >
            <pre className="overflow-auto rounded-md bg-muted/50 p-2 text-xs">
              <code>{JSON.stringify(event.payload, null, 2)}</code>
            </pre>
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}
