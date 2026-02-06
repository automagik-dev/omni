import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useInstances } from '@/hooks/useInstances';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { formatRelativeTime } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, Database, Gauge, MessageSquare, Radio, Server } from 'lucide-react';
import { Link } from 'react-router-dom';

export function Dashboard() {
  // Fetch instances
  const { data: instances, isLoading: loadingInstances } = useInstances();

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
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="instances">Instances</TabsTrigger>
            <TabsTrigger value="system">System</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview">
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
          </TabsContent>

          {/* Instances Tab */}
          <TabsContent value="instances">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Server className="h-5 w-5" />
                  All Instances
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingInstances ? (
                  <div className="flex justify-center py-8">
                    <Spinner />
                  </div>
                ) : instances?.items.length === 0 ? (
                  <p className="py-8 text-center text-muted-foreground">No instances configured</p>
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
                            className={`h-2 w-2 rounded-full ${instance.isActive ? 'bg-green-500' : 'bg-muted-foreground'}`}
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
