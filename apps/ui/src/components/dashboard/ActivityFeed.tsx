/**
 * ActivityFeed - Real-time event timeline
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { staggerFeed } from '@/lib/motion';
import { Activity } from 'lucide-react';
import { motion } from 'motion/react';
import { ActivityFeedItem } from './ActivityFeedItem';

interface ActivityFeedProps {
  events?: Array<{
    id: string;
    eventType: string;
    receivedAt: string;
    instanceId?: string;
    payload?: unknown;
  }>;
  isLoading?: boolean;
  maxItems?: number;
}

export function ActivityFeed({ events, isLoading, maxItems = 10 }: ActivityFeedProps) {
  const displayEvents = events?.slice(0, maxItems) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Activity Feed
        </CardTitle>
        <CardDescription>Recent events across all instances</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : displayEvents.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">
            <Activity className="mx-auto h-12 w-12 opacity-20" />
            <p className="mt-2">No recent events</p>
          </div>
        ) : (
          <motion.div
            variants={staggerFeed}
            initial="hidden"
            animate="visible"
            className="space-y-2 max-h-[500px] overflow-y-auto pr-2"
          >
            {displayEvents.map((event) => (
              <ActivityFeedItem key={event.id} event={event} />
            ))}
          </motion.div>
        )}
      </CardContent>
    </Card>
  );
}
