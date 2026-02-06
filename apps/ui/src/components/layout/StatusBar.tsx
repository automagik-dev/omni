import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ServiceStatus } from './ServiceStatus';

/**
 * Status bar footer showing service health and system info
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function getServiceStatus(
  isLoading: boolean,
  isError: boolean,
  checkStatus: 'ok' | 'error' | undefined,
): 'ok' | 'error' | 'unknown' {
  if (isLoading) return 'unknown';
  if (isError) return 'error';
  return checkStatus ?? 'unknown';
}

function getStatusBadgeClass(status: string | undefined): string {
  if (status === 'healthy') return 'bg-green-500/10 text-green-500';
  if (status === 'degraded') return 'bg-yellow-500/10 text-yellow-500';
  if (status === 'unhealthy') return 'bg-red-500/10 text-red-500';
  return 'bg-muted text-muted-foreground';
}

export function StatusBar() {
  const {
    data: health,
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.systemHealth(),
    queryFn: () => getClient().system.health(),
    refetchInterval: 30000,
  });

  const dbStatus = getServiceStatus(isLoading, isError, health?.checks?.database?.status);
  const natsStatus = getServiceStatus(isLoading, isError, health?.checks?.nats?.status);

  return (
    <footer className="flex h-8 items-center justify-between border-t bg-card px-4">
      <div className="flex items-center gap-4">
        <ServiceStatus name="Database" status={dbStatus} latency={health?.checks?.database?.latency} />
        <ServiceStatus name="NATS" status={natsStatus} latency={health?.checks?.nats?.latency} />
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        {health?.instances && (
          <span>
            {health.instances.connected}/{health.instances.total} instances
          </span>
        )}
        {health?.uptime !== undefined && <span>Uptime: {formatUptime(health.uptime)}</span>}
        <span className={cn('rounded px-1.5 py-0.5', getStatusBadgeClass(health?.status))}>
          {health?.status ?? 'loading'}
        </span>
        {health?.version && <span>v{health.version}</span>}
      </div>
    </footer>
  );
}
