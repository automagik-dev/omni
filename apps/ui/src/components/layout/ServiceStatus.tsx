import { cn } from '@/lib/utils';

interface ServiceStatusProps {
  name: string;
  status: 'ok' | 'error' | 'unknown';
  latency?: number;
}

export function ServiceStatus({ name, status, latency }: ServiceStatusProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="relative flex h-2 w-2">
        {status === 'ok' && (
          <span className="absolute inline-flex h-full w-full animate-pulse-slow rounded-full bg-success opacity-75" />
        )}
        <span
          className={cn(
            'relative inline-flex h-2 w-2 rounded-full',
            status === 'ok' && 'bg-success',
            status === 'error' && 'bg-destructive',
            status === 'unknown' && 'bg-warning',
          )}
          aria-label={`${name} status: ${status}`}
        />
      </span>
      <span className="text-muted-foreground">{name}</span>
      {latency !== undefined && status === 'ok' && (
        <span className="font-mono text-muted-foreground/60">{latency}ms</span>
      )}
    </div>
  );
}
