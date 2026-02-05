import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { formatRelativeTime } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, MessageSquare, Server } from 'lucide-react';

export function Dashboard() {
  // Fetch instances
  const { data: instances, isLoading: loadingInstances } = useQuery({
    queryKey: queryKeys.instancesList(),
    queryFn: () => getClient().instances.list({ limit: 100 }),
  });

  // Fetch recent events
  const { data: events, isLoading: loadingEvents } = useQuery({
    queryKey: queryKeys.eventsList({ limit: 10 }),
    queryFn: () => getClient().events.list({ limit: 10 }),
  });

  // Fetch system health
  const { data: health } = useQuery({
    queryKey: queryKeys.systemHealth(),
    queryFn: () => getClient().system.health(),
  });

  const connectedInstances = instances?.items.filter((i) => i.isActive).length ?? 0;
  const totalInstances = instances?.items.length ?? 0;

  return (
    <>
      <Header title="Dashboard" subtitle="Overview of your Omni installation" />

      <div className="flex-1 overflow-auto p-6">
        {/* Stats cards */}
        <div className="mb-8 grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Instances</CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingInstances ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {connectedInstances}/{totalInstances}
                  </div>
                  <p className="text-xs text-muted-foreground">connected</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Recent Events</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              {loadingEvents ? (
                <Spinner size="sm" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{events?.items.length ?? 0}</div>
                  <p className="text-xs text-muted-foreground">in last hour</p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">System Status</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Badge variant={health?.status === 'healthy' ? 'success' : 'destructive'}>
                  {health?.status ?? 'unknown'}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {health?.status === 'healthy' ? 'All systems operational' : 'Issues detected'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Recent events list */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Recent Events
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loadingEvents ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : events?.items.length === 0 ? (
              <p className="py-8 text-center text-muted-foreground">No recent events</p>
            ) : (
              <div className="space-y-2">
                {events?.items.map((event) => (
                  <div key={event.id} className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex items-center gap-3">
                      <MessageSquare className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">{event.eventType}</p>
                        <p className="text-xs text-muted-foreground">
                          {event.instanceId ? `Instance: ${event.instanceId.slice(0, 8)}...` : 'System'}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{formatRelativeTime(event.receivedAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
