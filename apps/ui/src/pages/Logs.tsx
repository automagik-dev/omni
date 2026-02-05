import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useLogs } from '@/hooks/useLogs';
import { cn, formatDateTime } from '@/lib/utils';
import type { ListLogsParams } from '@omni/sdk';
import { FileText, RefreshCw } from 'lucide-react';
import { useState } from 'react';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelColors: Record<LogLevel, string> = {
  debug: 'text-muted-foreground',
  info: 'text-blue-500',
  warn: 'text-yellow-500',
  error: 'text-red-500',
};

const levelBadgeVariants: Record<LogLevel, 'secondary' | 'default' | 'warning' | 'destructive'> = {
  debug: 'secondary',
  info: 'default',
  warn: 'warning',
  error: 'destructive',
};

export function Logs() {
  const [level, setLevel] = useState<LogLevel | undefined>();
  const [modules, setModules] = useState<string>('');
  const [limit, setLimit] = useState(100);

  const params: ListLogsParams = {
    level,
    modules: modules || undefined,
    limit,
  };

  const { data, isLoading, error, refetch, isRefetching } = useLogs(params);

  return (
    <>
      <Header
        title="Logs"
        subtitle="View system logs"
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isRefetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-hidden p-6">
        {/* Filters */}
        <div className="mb-4 flex flex-wrap gap-4">
          <select
            value={level ?? ''}
            onChange={(e) => setLevel((e.target.value as LogLevel) || undefined)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All levels</option>
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warning</option>
            <option value="error">Error</option>
          </select>

          <input
            type="text"
            placeholder="Filter by module (e.g., api,whatsapp)"
            value={modules}
            onChange={(e) => setModules(e.target.value)}
            className="flex-1 min-w-[200px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          />

          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value={50}>50 logs</option>
            <option value={100}>100 logs</option>
            <option value={200}>200 logs</option>
            <option value={500}>500 logs</option>
          </select>
        </div>

        {/* Logs */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-destructive">Failed to load logs</p>
              <p className="mt-2 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : 'Unknown error'}
              </p>
            </CardContent>
          </Card>
        ) : data?.items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No logs found</p>
            </CardContent>
          </Card>
        ) : (
          <div className="h-[calc(100vh-280px)] overflow-auto rounded-lg border bg-card">
            <div className="font-mono text-sm">
              {data?.items.map((log) => (
                <div
                  key={`${log.time}-${log.module}-${log.msg.slice(0, 20)}`}
                  className="flex items-start gap-2 border-b px-4 py-2 hover:bg-muted/50"
                >
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(log.time)}</span>
                  <Badge
                    variant={levelBadgeVariants[log.level as LogLevel] ?? 'secondary'}
                    className="shrink-0 text-xs"
                  >
                    {log.level}
                  </Badge>
                  <span className="shrink-0 text-xs text-muted-foreground">[{log.module}]</span>
                  <span className={cn('flex-1', levelColors[log.level as LogLevel])}>{log.msg}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Stats */}
        {data?.meta && (
          <div className="mt-4 text-sm text-muted-foreground">
            Showing {data.items.length} of {data.meta.total} logs (buffer: {data.meta.bufferSize})
          </div>
        )}
      </div>
    </>
  );
}
