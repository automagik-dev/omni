import { cn } from '@/lib/utils';

interface ServiceStatusProps {
  name: string;
  status: 'ok' | 'error' | 'unknown';
  latency?: number;
}

/**
 * Individual service status indicator
 */
export function ServiceStatus({ name, status, latency }: ServiceStatusProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className={cn(
          'h-2 w-2 rounded-full',
          status === 'ok' && 'bg-green-500',
          status === 'error' && 'bg-red-500',
          status === 'unknown' && 'bg-yellow-500',
        )}
        aria-label={`${name} status: ${status}`}
      />
      <span className="text-muted-foreground">{name}</span>
      {latency !== undefined && status === 'ok' && <span className="text-muted-foreground/60">{latency}ms</span>}
    </div>
  );
}
