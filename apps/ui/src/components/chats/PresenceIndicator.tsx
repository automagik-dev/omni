import { cn } from '@/lib/utils';

interface PresenceIndicatorProps {
  status: 'online' | 'away' | 'offline';
  className?: string;
}

/**
 * Small presence indicator dot (online/away/offline)
 * Typically positioned absolute bottom-right of avatar
 */
export function PresenceIndicator({ status, className }: PresenceIndicatorProps) {
  return (
    <div
      className={cn(
        'h-2 w-2 rounded-full border-2 border-background',
        {
          'bg-green-500 animate-pulse': status === 'online',
          'bg-amber-500': status === 'away',
          'bg-gray-400': status === 'offline',
        },
        className,
      )}
      aria-label={`Status: ${status}`}
    />
  );
}
