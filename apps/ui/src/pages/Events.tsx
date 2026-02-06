import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useInstances } from '@/hooks/useInstances';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { cn, formatDateTime } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';

export function Events() {
  const [searchParams, setSearchParams] = useSearchParams();

  const instanceId = searchParams.get('instanceId') ?? undefined;
  const eventType = searchParams.get('eventType') ?? undefined;
  const limit = Number(searchParams.get('limit')) || 50;
  const expandedEvent = searchParams.get('eventId') ?? null;

  const setExpandedEvent = (eventId: string | null) => {
    setSearchParams((prev) => {
      if (eventId) {
        prev.set('eventId', eventId);
      } else {
        prev.delete('eventId');
      }
      return prev;
    });
  };

  const { data: instances } = useInstances();

  const { data, isLoading, error, refetch, isRefetching } = useQuery({
    queryKey: queryKeys.eventsList({ instanceId, eventType, limit }),
    queryFn: () =>
      getClient().events.list({
        instanceId,
        eventType,
        limit,
      }),
    refetchInterval: 10000, // Poll every 10 seconds
  });

  const handleInstanceFilter = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSearchParams((prev) => {
      if (e.target.value) {
        prev.set('instanceId', e.target.value);
      } else {
        prev.delete('instanceId');
      }
      return prev;
    });
  };

  const handleEventTypeFilter = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchParams((prev) => {
      if (e.target.value) {
        prev.set('eventType', e.target.value);
      } else {
        prev.delete('eventType');
      }
      return prev;
    });
  };

  return (
    <>
      <Header
        title="Events"
        subtitle="View event stream"
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isRefetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {/* Filters */}
        <div className="mb-6 flex flex-wrap gap-4">
          <select
            value={instanceId ?? ''}
            onChange={handleInstanceFilter}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All instances</option>
            {instances?.items.map((instance) => (
              <option key={instance.id} value={instance.id}>
                {instance.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Event type filter (e.g., message.received)"
            value={eventType ?? ''}
            onChange={handleEventTypeFilter}
            className="flex-1 min-w-[250px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        {/* Events */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">Failed to load events</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </CardContent>
          </Card>
        ) : data?.items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Activity className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No events found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {data?.items.map((event) => (
              <Card key={event.id}>
                <CardContent className="p-4">
                  <button
                    type="button"
                    className="flex w-full cursor-pointer items-center justify-between text-left"
                    onClick={() => setExpandedEvent(expandedEvent === event.id ? null : event.id)}
                  >
                    <div className="flex items-center gap-3">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">{event.eventType}</Badge>
                          {event.direction && <Badge variant="outline">{event.direction}</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatDateTime(event.receivedAt)}
                          {event.instanceId && (
                            <span className="ml-2">Instance: {event.instanceId.slice(0, 8)}...</span>
                          )}
                        </p>
                      </div>
                    </div>
                    {expandedEvent === event.id ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </button>

                  {expandedEvent === event.id && (
                    <div className="mt-4 rounded-md bg-muted p-4">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">Event Details</p>
                      <pre className="overflow-auto text-xs">
                        {JSON.stringify(
                          {
                            id: event.id,
                            eventType: event.eventType,
                            contentType: event.contentType,
                            textContent: event.textContent,
                            direction: event.direction,
                            instanceId: event.instanceId,
                            receivedAt: event.receivedAt,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {data?.meta.hasMore && (
          <div className="mt-4 text-center">
            <Button
              variant="outline"
              onClick={() => {
                setSearchParams((prev) => {
                  prev.set('limit', String(limit + 50));
                  return prev;
                });
              }}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
