import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInstances } from '@/hooks/useInstances';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Database,
  Gauge,
  MessageSquare,
  Radio,
  RefreshCw,
  Server,
  TrendingUp,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';

// Event metrics type from API
interface EventMetrics {
  total: number;
  byType: Record<string, number>;
  byInstance: Record<string, number>;
  last24Hours: number;
  lastHour: number;
  avgPerMinute: number;
  avgPerHour: number;
}

export function Dashboard() {
  // Fetch instances
  const { data: instances, isLoading: loadingInstances, refetch: refetchInstances } = useInstances();

  // Fetch recent events
  const {
    data: events,
    isLoading: loadingEvents,
    refetch: refetchEvents,
  } = useQuery({
    queryKey: queryKeys.eventsList({ limit: 20 }),
    queryFn: () => getClient().events.list({ limit: 20 }),
  });

  // Fetch event metrics
  const {
    data: metrics,
    isLoading: loadingMetrics,
    refetch: refetchMetrics,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['event-metrics'],
    queryFn: async () => {
      const data = await getClient().eventOps.metrics();
      return data as unknown as EventMetrics;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch system health
  const { data: health, refetch: refetchHealth } = useQuery({
    queryKey: queryKeys.systemHealth(),
    queryFn: () => getClient().system.health(),
  });

  const connectedInstances = instances?.items.filter((i) => i.isActive).length ?? 0;
  const totalInstances = instances?.items.length ?? 0;

  const handleRefreshAll = () => {
    refetchInstances();
    refetchEvents();
    refetchMetrics();
    refetchHealth();
  };

  // Get top event types from metrics
  const topEventTypes = metrics?.byType
    ? Object.entries(metrics.byType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  return (
    <>
      <Header
        title="Dashboard"
        subtitle="Overview of your Omni installation"
        actions={
          <div className="flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground">
                Updated {formatRelativeTime(lastUpdated.toISOString())}
              </span>
            )}
            <Button variant="outline" size="sm" onClick={handleRefreshAll}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="instances">Instances</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
            {/* Stats cards */}
            <div className="mb-8 grid gap-4 md:grid-cols-4">
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
                      <Progress value={connectedInstances} max={totalInstances || 1} className="mt-2 h-1" />
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Events/Hour</CardTitle>
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {loadingMetrics ? (
                    <Spinner size="sm" />
                  ) : (
                    <>
                      <div className="text-2xl font-bold">{metrics?.avgPerHour?.toFixed(1) ?? '0'}</div>
                      <p className="text-xs text-muted-foreground">average rate</p>
                    </>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Last 24h</CardTitle>
                  <Activity className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  {loadingMetrics ? (
                    <Spinner size="sm" />
                  ) : (
                    <>
                      <div className="text-2xl font-bold">{metrics?.last24Hours?.toLocaleString() ?? '0'}</div>
                      <p className="text-xs text-muted-foreground">total events</p>
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

            {/* Two column layout */}
            <div className="grid gap-6 md:grid-cols-2">
              {/* Recent events list */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Recent Events
                  </CardTitle>
                  <CardDescription>Latest {events?.items.length ?? 0} events</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingEvents ? (
                    <div className="flex justify-center py-8">
                      <Spinner />
                    </div>
                  ) : events?.items.length === 0 ? (
                    <p className="py-8 text-center text-muted-foreground">No recent events</p>
                  ) : (
                    <div className="space-y-2 max-h-[400px] overflow-auto">
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

              {/* Top event types */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5" />
                    Event Distribution
                  </CardTitle>
                  <CardDescription>Top event types by volume</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingMetrics ? (
                    <div className="flex justify-center py-8">
                      <Spinner />
                    </div>
                  ) : topEventTypes.length === 0 ? (
                    <p className="py-8 text-center text-muted-foreground">No event data</p>
                  ) : (
                    <div className="space-y-4">
                      {topEventTypes.map(([type, count]) => {
                        const total = metrics?.total || 1;
                        const percentage = Math.round((count / total) * 100);
                        return (
                          <div key={type} className="space-y-1">
                            <div className="flex items-center justify-between text-sm">
                              <span className="font-medium">{type}</span>
                              <span className="text-muted-foreground">
                                {count.toLocaleString()} ({percentage}%)
                              </span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-muted">
                              <div className="h-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Metrics Tab */}
          <TabsContent value="metrics">
            <div className="grid gap-4 md:grid-cols-3 mb-6">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Zap className="h-4 w-4" />
                    Events/Minute
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{metrics?.avgPerMinute?.toFixed(2) ?? '0'}</div>
                  <p className="text-xs text-muted-foreground mt-1">average rate</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Events/Hour
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{metrics?.avgPerHour?.toFixed(1) ?? '0'}</div>
                  <p className="text-xs text-muted-foreground mt-1">average rate</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    Total Events
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{metrics?.total?.toLocaleString() ?? '0'}</div>
                  <p className="text-xs text-muted-foreground mt-1">all time</p>
                </CardContent>
              </Card>
            </div>

            {/* Events by type breakdown */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Events by Type
                </CardTitle>
                <CardDescription>Complete breakdown of event types</CardDescription>
              </CardHeader>
              <CardContent>
                {loadingMetrics ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : !metrics?.byType || Object.keys(metrics.byType).length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">No event data available</p>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(metrics.byType)
                      .sort((a, b) => b[1] - a[1])
                      .map(([type, count]) => {
                        const total = metrics.total || 1;
                        const percentage = Math.round((count / total) * 100);
                        return (
                          <div key={type} className="rounded-lg border p-3">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm font-medium truncate">{type}</span>
                              <Badge variant="secondary" className="text-xs">
                                {percentage}%
                              </Badge>
                            </div>
                            <div className="text-2xl font-bold">{count.toLocaleString()}</div>
                            <div className="h-1.5 overflow-hidden rounded-full bg-muted mt-2">
                              <div className="h-full bg-primary transition-all" style={{ width: `${percentage}%` }} />
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Instances Tab */}
          <TabsContent value="instances">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  All Instances
                </CardTitle>
                <CardDescription>
                  {connectedInstances} of {totalInstances} instances connected
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loadingInstances ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : instances?.items.length === 0 ? (
                  <div className="py-8 text-center">
                    <Server className="mx-auto h-12 w-12 text-muted-foreground" />
                    <p className="mt-4 text-muted-foreground">No instances configured</p>
                    <Link to="/instances">
                      <Button className="mt-4">Create Instance</Button>
                    </Link>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {instances?.items.map((instance) => (
                      <Link
                        key={instance.id}
                        to={`/instances/${instance.id}`}
                        className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-accent"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              'h-3 w-3 rounded-full',
                              instance.isActive ? 'bg-green-500' : 'bg-muted-foreground',
                            )}
                          />
                          <div>
                            <p className="font-medium">{instance.name}</p>
                            <p className="text-xs text-muted-foreground">{instance.channel}</p>
                          </div>
                        </div>
                        <Badge variant={instance.isActive ? 'success' : 'secondary'}>
                          {instance.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* System Tab */}
          <TabsContent value="system">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Services Health */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Gauge className="h-5 w-5" />
                    Services
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Database */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Database className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">Database</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {health?.checks?.database?.latency && (
                        <span className="text-xs text-muted-foreground">{health.checks.database.latency}ms</span>
                      )}
                      <Badge variant={health?.checks?.database?.status === 'ok' ? 'success' : 'destructive'}>
                        {health?.checks?.database?.status ?? 'unknown'}
                      </Badge>
                    </div>
                  </div>

                  {/* NATS */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Radio className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">NATS</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {health?.checks?.nats?.latency && (
                        <span className="text-xs text-muted-foreground">{health.checks.nats.latency}ms</span>
                      )}
                      <Badge variant={health?.checks?.nats?.status === 'ok' ? 'success' : 'destructive'}>
                        {health?.checks?.nats?.status ?? 'unknown'}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* System Info */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <AlertCircle className="h-5 w-5" />
                    System Info
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">Version</p>
                      <p className="font-mono">{health?.version ?? '-'}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Uptime</p>
                      <p className="font-mono">
                        {health?.uptime
                          ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`
                          : '-'}
                      </p>
                    </div>
                    {health?.instances && (
                      <>
                        <div>
                          <p className="text-muted-foreground">Instances</p>
                          <p>
                            {health.instances.connected}/{health.instances.total}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Connection Rate</p>
                          <div className="mt-1">
                            <Progress
                              value={health.instances.connected}
                              max={health.instances.total || 1}
                              className="h-1.5"
                            />
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}
