import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import {
  useAbandonDeadLetter,
  useDeadLetterStats,
  useDeadLetters,
  useResolveDeadLetter,
  useRetryDeadLetter,
} from '@/hooks/useDeadLetters';
import { cn, formatDateTime } from '@/lib/utils';
import type { DeadLetter } from '@omni/sdk';
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileWarning,
  RefreshCw,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';

type StatusType = 'pending' | 'retrying' | 'resolved' | 'abandoned';

const statusConfig: Record<StatusType, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: 'Pending', color: 'text-yellow-500 bg-yellow-500/10', icon: Clock },
  retrying: { label: 'Retrying', color: 'text-blue-500 bg-blue-500/10', icon: RotateCcw },
  resolved: { label: 'Resolved', color: 'text-green-500 bg-green-500/10', icon: CheckCircle2 },
  abandoned: { label: 'Abandoned', color: 'text-muted-foreground bg-muted', icon: XCircle },
};

export function DeadLetters() {
  const [statusFilter, setStatusFilter] = useState<StatusType | 'all'>('pending');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [resolveNote, setResolveNote] = useState('');

  const { data: stats, isLoading: loadingStats, refetch: refetchStats } = useDeadLetterStats();
  const {
    data: deadLetters,
    isLoading: loadingList,
    refetch: refetchList,
  } = useDeadLetters({
    status: statusFilter === 'all' ? undefined : statusFilter,
    limit: 50,
  });

  const retryDeadLetter = useRetryDeadLetter();
  const resolveDeadLetter = useResolveDeadLetter();
  const abandonDeadLetter = useAbandonDeadLetter();

  const handleRefresh = () => {
    refetchStats();
    refetchList();
  };

  const handleRetry = async (id: string) => {
    await retryDeadLetter.mutateAsync(id);
  };

  const handleResolve = async () => {
    if (!resolveId) return;
    await resolveDeadLetter.mutateAsync({
      id: resolveId,
      body: { note: resolveNote || 'Manually resolved' },
    });
    setResolveId(null);
    setResolveNote('');
  };

  const handleAbandon = async (id: string) => {
    if (!confirm('Are you sure you want to abandon this dead letter? This cannot be undone.')) return;
    await abandonDeadLetter.mutateAsync(id);
  };

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <>
      <Header
        title="Dead Letters"
        subtitle="Failed events that need attention"
        actions={
          <Button variant="outline" onClick={handleRefresh}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        {/* Stats cards */}
        <div className="mb-6 grid gap-4 md:grid-cols-4">
          <StatsCard
            title="Pending"
            value={stats?.pending ?? 0}
            icon={Clock}
            color="text-yellow-500"
            loading={loadingStats}
            active={statusFilter === 'pending'}
            onClick={() => setStatusFilter('pending')}
          />
          <StatsCard
            title="Retrying"
            value={stats?.retrying ?? 0}
            icon={RotateCcw}
            color="text-blue-500"
            loading={loadingStats}
            active={statusFilter === 'retrying'}
            onClick={() => setStatusFilter('retrying')}
          />
          <StatsCard
            title="Resolved"
            value={stats?.resolved ?? 0}
            icon={CheckCircle2}
            color="text-green-500"
            loading={loadingStats}
            active={statusFilter === 'resolved'}
            onClick={() => setStatusFilter('resolved')}
          />
          <StatsCard
            title="Abandoned"
            value={stats?.abandoned ?? 0}
            icon={XCircle}
            color="text-muted-foreground"
            loading={loadingStats}
            active={statusFilter === 'abandoned'}
            onClick={() => setStatusFilter('abandoned')}
          />
        </div>

        {/* Filter tabs */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Filter:</span>
          <Button
            variant={statusFilter === 'all' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter('all')}
          >
            All ({stats?.total ?? 0})
          </Button>
          {(Object.keys(statusConfig) as StatusType[]).map((status) => (
            <Button
              key={status}
              variant={statusFilter === status ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStatusFilter(status)}
            >
              {statusConfig[status].label}
            </Button>
          ))}
        </div>

        {/* List */}
        {loadingList ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : !deadLetters?.items || deadLetters.items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileWarning className="mx-auto h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 font-semibold">No {statusFilter === 'all' ? '' : statusFilter} dead letters</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {statusFilter === 'pending'
                  ? 'All events are processing successfully!'
                  : 'No dead letters match this filter'}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {deadLetters.items.map((item) => (
              <DeadLetterItem
                key={item.id}
                item={item}
                expanded={expandedId === item.id}
                onToggle={() => toggleExpand(item.id)}
                onRetry={() => handleRetry(item.id)}
                onResolve={() => setResolveId(item.id)}
                onAbandon={() => handleAbandon(item.id)}
                isRetrying={retryDeadLetter.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Resolve Dialog */}
      <Dialog open={!!resolveId} onOpenChange={(open) => !open && setResolveId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Dead Letter</DialogTitle>
            <DialogDescription>Add a note explaining how this issue was resolved</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label htmlFor="resolve-note" className="text-sm font-medium">
                Resolution Note
              </label>
              <Input
                id="resolve-note"
                value={resolveNote}
                onChange={(e) => setResolveNote(e.target.value)}
                placeholder="e.g., Fixed upstream service, manually processed"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveId(null)}>
              Cancel
            </Button>
            <Button onClick={handleResolve} disabled={resolveDeadLetter.isPending}>
              {resolveDeadLetter.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Resolving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Resolve
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// Stats card component
function StatsCard({
  title,
  value,
  icon: Icon,
  color,
  loading,
  active,
  onClick,
}: {
  title: string;
  value: number;
  icon: typeof Clock;
  color: string;
  loading: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Card
      className={cn('cursor-pointer transition-all hover:shadow-md', active && 'ring-2 ring-primary')}
      onClick={onClick}
    >
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn('h-5 w-5', color)} />
      </CardHeader>
      <CardContent>
        {loading ? <Spinner size="sm" /> : <div className="text-2xl font-bold">{value.toLocaleString()}</div>}
      </CardContent>
    </Card>
  );
}

// Dead letter item component
function DeadLetterItem({
  item,
  expanded,
  onToggle,
  onRetry,
  onResolve,
  onAbandon,
  isRetrying,
}: {
  item: DeadLetter;
  expanded: boolean;
  onToggle: () => void;
  onRetry: () => void;
  onResolve: () => void;
  onAbandon: () => void;
  isRetrying: boolean;
}) {
  const config = statusConfig[item.status];
  const Icon = config.icon;

  return (
    <Card>
      <button
        type="button"
        className="flex w-full cursor-pointer items-center justify-between p-4 text-left"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </span>

          <Badge variant="outline" className={cn('shrink-0', config.color)}>
            <Icon className="mr-1 h-3 w-3" />
            {config.label}
          </Badge>

          <div className="min-w-0">
            <p className="font-mono text-sm truncate">{item.eventType}</p>
            <p className="text-xs text-muted-foreground truncate">{item.errorMessage}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {item.retryCount > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {item.retryCount} retries
            </Badge>
          )}
          <span className="text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 space-y-3">
          {/* Error details */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground">ERROR MESSAGE</p>
            <p className="text-sm text-destructive">{item.errorMessage}</p>
          </div>

          {item.errorStack && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">STACK TRACE</p>
              <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-32">{item.errorStack}</pre>
            </div>
          )}

          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Event ID</p>
              <p className="font-mono text-xs">{item.eventId}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Created</p>
              <p>{formatDateTime(item.createdAt)}</p>
            </div>
            {item.lastRetryAt && (
              <div>
                <p className="text-xs text-muted-foreground">Last Retry</p>
                <p>{formatDateTime(item.lastRetryAt)}</p>
              </div>
            )}
            {item.resolvedAt && (
              <div>
                <p className="text-xs text-muted-foreground">Resolved</p>
                <p>{formatDateTime(item.resolvedAt)}</p>
              </div>
            )}
          </div>

          {item.resolutionNote && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">RESOLUTION NOTE</p>
              <p className="text-sm">{item.resolutionNote}</p>
            </div>
          )}

          {/* Actions */}
          {(item.status === 'pending' || item.status === 'retrying') && (
            <div className="flex gap-2 pt-2 border-t">
              <Button size="sm" variant="outline" onClick={onRetry} disabled={isRetrying}>
                <RotateCcw className="mr-2 h-3 w-3" />
                Retry
              </Button>
              <Button size="sm" variant="outline" onClick={onResolve}>
                <CheckCircle2 className="mr-2 h-3 w-3" />
                Resolve
              </Button>
              <Button size="sm" variant="ghost" className="text-destructive" onClick={onAbandon}>
                <Archive className="mr-2 h-3 w-3" />
                Abandon
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
