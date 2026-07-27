import { useInstances } from '@/hooks/useInstances';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { ServiceStatus } from './ServiceStatus';

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
  if (status === 'healthy') return 'bg-success/10 text-success';
  if (status === 'degraded') return 'bg-warning/10 text-warning';
  if (status === 'unhealthy') return 'bg-destructive/10 text-destructive';
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

  // Instance inventory is no longer part of the unauthenticated /health
  // response (privacy contract); count from the authenticated list instead.
  // `limit: 100` is the endpoint's maximum page size (routes/v2/instances.ts) —
  // the default of 50 silently undercounted deployments past 50 instances. The
  // response carries no total, so `meta.hasMore` is surfaced as a "+" rather
  // than reported as a wrong exact count. Refreshed on the same 30s cadence as
  // the health query so the footer does not go stale.
  const { data: instancesData } = useInstances({ limit: 100 }, { refetchInterval: 30000 });
  const instanceItems = instancesData?.items;
  const activeInstances = instanceItems?.filter((i) => i.isActive).length ?? 0;
  const moreInstances = instancesData?.meta?.hasMore === true;

  const dbStatus = getServiceStatus(isLoading, isError, health?.checks?.database?.status);
  const natsStatus = getServiceStatus(isLoading, isError, health?.checks?.nats?.status);

  return (
    <footer className="flex h-8 items-center justify-between border-t border-border/20 bg-card/30 px-4 backdrop-blur-md">
      <div className="flex items-center gap-4">
        <ServiceStatus name="Database" status={dbStatus} latency={health?.checks?.database?.latency} />
        <ServiceStatus name="NATS" status={natsStatus} latency={health?.checks?.nats?.latency} />
      </div>

      <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
        {instanceItems && (
          <span>
            {activeInstances}/{instanceItems.length}
            {moreInstances ? '+' : ''} instances
          </span>
        )}
        {health?.uptime !== undefined && <span>Uptime: {formatUptime(health.uptime)}</span>}
        <span className={cn('rounded px-1.5 py-0.5', getStatusBadgeClass(health?.status))}>
          {health?.status ?? 'loading'}
        </span>
        {health?.version && <span className="text-muted-foreground/60">v{health.version}</span>}
      </div>
    </footer>
  );
}
