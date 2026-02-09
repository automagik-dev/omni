import { ActivityFeed, InstanceHealthGrid, MetricTile, QuickActions } from '@/components/dashboard';
import { Header } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useInstances } from '@/hooks/useInstances';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { formatRelativeTime } from '@/lib/utils';
import type { EventAnalytics, EventMetrics } from '@omni/sdk';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, Database, Gauge, Radio, RefreshCw, Server, TrendingUp } from 'lucide-react';

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
    data: metricsResponse,
    refetch: refetchMetrics,
    dataUpdatedAt,
  } = useQuery({
    queryKey: ['event-metrics'],
    queryFn: async () => {
      const response = await getClient().eventOps.metrics();
      return response.data;
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch analytics for sparkline data
  const { data: analytics } = useQuery({
    queryKey: ['event-analytics', { granularity: 'hourly' }],
    queryFn: async () => {
      const response = await getClient().events.analytics({ granularity: 'hourly' });
      return response as EventAnalytics;
    },
    refetchInterval: 30000,
  });

  // Fetch system health
  const { data: health, refetch: refetchHealth } = useQuery({
    queryKey: queryKeys.systemHealth(),
    queryFn: () => getClient().system.health(),
  });

  const metrics = metricsResponse as EventMetrics | undefined;
  const connectedInstances = instances?.items.filter((i) => i.isActive).length ?? 0;
  const totalInstances = instances?.items.length ?? 0;

  const handleRefreshAll = () => {
    refetchInstances();
    refetchEvents();
    refetchMetrics();
    refetchHealth();
  };

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  // Extract sparkline data from analytics timeline
  const sparklineData = analytics?.timeline?.map((bucket) => bucket.count) ?? [];

  return (
    <>
      <Header
        title="Dashboard"
        subtitle="Midnight Command Center"
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
        <div className="space-y-6">
          {/* Quick Actions */}
          <QuickActions />

          {/* Metric Tiles Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <MetricTile
              icon={Server}
              label="Instances"
              value={`${connectedInstances}/${totalInstances}`}
              subtitle="connected"
              accentColor="info"
            />

            <MetricTile
              icon={TrendingUp}
              label="Events/Hour"
              value={metrics?.eventsPerHour ?? 0}
              subtitle="average rate"
              format="decimal"
              accentColor="primary"
              sparklineData={sparklineData}
            />

            <MetricTile
              icon={Activity}
              label="Last 24h"
              value={metrics?.eventsLast24h ?? 0}
              subtitle="total events"
              format="number"
              accentColor="success"
            />

            <MetricTile
              icon={AlertCircle}
              label="Failure Rate"
              value={metrics?.failureRate ?? 0}
              subtitle="percentage"
              format="percentage"
              accentColor={metrics && metrics.failureRate > 5 ? 'warning' : 'success'}
            />
          </div>

          {/* Two-Column Layout */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Activity Feed */}
            <ActivityFeed events={events?.items} isLoading={loadingEvents} maxItems={10} />

            {/* Instance Health Grid */}
            <InstanceHealthGrid instances={instances?.items} isLoading={loadingInstances} />
          </div>

          {/* System Health - Collapsible */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gauge className="h-5 w-5 text-primary" />
                System Health
              </CardTitle>
              <CardDescription>Service status and performance</CardDescription>
            </CardHeader>
            <CardContent>
              {!health ? (
                <div className="flex justify-center py-4">
                  <Spinner size="sm" />
                </div>
              ) : (
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Services */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium text-muted-foreground">Services</h4>
                    <div className="space-y-3">
                      {/* Database */}
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Database</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {health.checks?.database?.latency && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {health.checks.database.latency}ms
                            </span>
                          )}
                          <div
                            className={`h-2 w-2 rounded-full ${health.checks?.database?.status === 'ok' ? 'bg-success animate-pulse' : 'bg-destructive'}`}
                          />
                        </div>
                      </div>

                      {/* NATS */}
                      <div className="flex items-center justify-between rounded-md border p-3">
                        <div className="flex items-center gap-2">
                          <Radio className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">NATS</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {health.checks?.nats?.latency && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {health.checks.nats.latency}ms
                            </span>
                          )}
                          <div
                            className={`h-2 w-2 rounded-full ${health.checks?.nats?.status === 'ok' ? 'bg-success animate-pulse' : 'bg-destructive'}`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* System Info */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium text-muted-foreground">System Info</h4>
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Version</p>
                        <p className="font-mono text-sm font-medium">{health.version ?? '-'}</p>
                      </div>
                      <div className="rounded-md border p-3">
                        <p className="text-xs text-muted-foreground">Uptime</p>
                        <p className="font-mono text-sm font-medium">
                          {health.uptime
                            ? `${Math.floor(health.uptime / 3600)}h ${Math.floor((health.uptime % 3600) / 60)}m`
                            : '-'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
