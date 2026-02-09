/**
 * InstanceHealthCard - Single instance status card
 */

import { Badge } from '@/components/ui/badge';
import { scaleIn } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { MessageSquare, Server } from 'lucide-react';
import { motion } from 'motion/react';

interface InstanceHealthCardProps {
  instance: {
    id: string;
    name: string;
    channel: string;
    isActive: boolean;
  };
  onClick?: () => void;
}

const channelIcons: Record<string, typeof MessageSquare> = {
  whatsapp: MessageSquare,
  telegram: MessageSquare,
  discord: MessageSquare,
};

export function InstanceHealthCard({ instance, onClick }: InstanceHealthCardProps) {
  const ChannelIcon = channelIcons[instance.channel.toLowerCase()] ?? Server;
  const statusColor = instance.isActive ? 'success' : 'muted';
  const statusRing = instance.isActive ? 'ring-success/30' : 'ring-muted/30';

  return (
    <motion.button
      type="button"
      variants={scaleIn}
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-3 rounded-xl border bg-card/50 p-4 text-center transition-all hover:bg-card/80 hover:shadow-lg',
        !instance.isActive && 'opacity-60',
      )}
    >
      {/* Status indicator with glow */}
      <div className="absolute top-2 right-2">
        <div className={cn('h-2 w-2 rounded-full', instance.isActive ? 'bg-success animate-pulse' : 'bg-muted')} />
      </div>

      {/* Channel icon with status ring */}
      <div
        className={cn(
          'flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 ring-4 transition-all group-hover:ring-8',
          statusRing,
        )}
      >
        <ChannelIcon className={cn('h-6 w-6', instance.isActive ? 'text-primary' : 'text-muted-foreground')} />
      </div>

      {/* Instance info */}
      <div className="w-full space-y-1">
        <p className="truncate font-medium text-sm">{instance.name}</p>
        <Badge variant={statusColor as 'success' | 'secondary'} className="text-[10px]">
          {instance.channel}
        </Badge>
      </div>

      {/* Connection status */}
      <div className="w-full border-t pt-2">
        <p className={cn('text-xs font-medium', instance.isActive ? 'text-success' : 'text-muted-foreground')}>
          {instance.isActive ? 'Connected' : 'Disconnected'}
        </p>
      </div>
    </motion.button>
  );
}
