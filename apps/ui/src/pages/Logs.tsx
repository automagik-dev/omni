import { Header } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { useLogs } from '@/hooks/useLogs';
import { cn, formatDateTime } from '@/lib/utils';
import type { ListLogsParams } from '@omni/sdk';
import { Check, ChevronDown, ChevronRight, Copy, FileText, RefreshCw } from 'lucide-react';
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

// Available module filters
const MODULE_OPTIONS = [
  { value: 'api', label: 'API', color: 'bg-blue-500' },
  { value: 'whatsapp', label: 'WhatsApp', color: 'bg-green-500' },
  { value: 'discord', label: 'Discord', color: 'bg-indigo-500' },
  { value: 'nats', label: 'NATS', color: 'bg-purple-500' },
  { value: 'db', label: 'Database', color: 'bg-orange-500' },
  { value: 'events', label: 'Events', color: 'bg-pink-500' },
  { value: 'sync', label: 'Sync', color: 'bg-teal-500' },
  { value: 'batch', label: 'Batch', color: 'bg-yellow-500' },
];

// Preset filters
const PRESETS = [
  { id: 'all', label: 'All', modules: [] },
  { id: 'channels', label: 'Channels', modules: ['whatsapp', 'discord'] },
  { id: 'api', label: 'API', modules: ['api'] },
  { id: 'events', label: 'Events', modules: ['events', 'nats'] },
  { id: 'errors', label: 'Errors Only', modules: [], level: 'error' as LogLevel },
];

// Time range options
const TIME_RANGES = [
  { value: '', label: 'All time' },
  { value: '1h', label: 'Last hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
];

interface LogEntry {
  time: string | number;
  level: string;
  module: string;
  msg: string;
  [key: string]: unknown;
}

export function Logs() {
  const [level, setLevel] = useState<LogLevel | undefined>();
  const [selectedModules, setSelectedModules] = useState<string[]>([]);
  const [limit, setLimit] = useState(100);
  const [timeRange, setTimeRange] = useState('');
  const [expandedLogs, setExpandedLogs] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const params: ListLogsParams = {
    level,
    modules: selectedModules.length > 0 ? selectedModules.join(',') : undefined,
    limit,
  };

  const { data, isLoading, error, refetch, isRefetching } = useLogs(params);

  const toggleModule = (module: string) => {
    setSelectedModules((prev) => (prev.includes(module) ? prev.filter((m) => m !== module) : [...prev, module]));
  };

  const applyPreset = (preset: (typeof PRESETS)[0]) => {
    setSelectedModules(preset.modules);
    setLevel(preset.level || undefined);
  };

  const toggleLogExpansion = (logId: string) => {
    setExpandedLogs((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  const copyLogEntry = async (log: LogEntry, logId: string) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(log, null, 2));
      setCopiedId(logId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  const getLogId = (log: LogEntry, index: number) => `${log.time}-${index}`;

  // Filter logs by time range if set (client-side filtering)
  let filteredLogs = data?.items || [];
  if (timeRange) {
    const now = Date.now();
    const ranges: Record<string, number> = {
      '1h': 60 * 60 * 1000,
      '6h': 6 * 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    };
    const cutoff = now - (ranges[timeRange] || 0);
    filteredLogs = filteredLogs.filter((log) => new Date(log.time).getTime() >= cutoff);
  }

  return (
    <>
      <Header
        title="Logs"
        subtitle="View and filter system logs"
        actions={
          <Button variant="outline" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn('mr-2 h-4 w-4', isRefetching && 'animate-spin')} />
            Refresh
          </Button>
        }
      />

      <div className="flex-1 overflow-hidden p-6">
        {/* Preset buttons */}
        <div className="mb-4 flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Presets:</span>
          {PRESETS.map((preset) => (
            <Button
              key={preset.id}
              variant={
                (preset.modules.length === 0 && selectedModules.length === 0 && !preset.level && !level) ||
                (preset.modules.length > 0 &&
                  preset.modules.every((m) => selectedModules.includes(m)) &&
                  selectedModules.length === preset.modules.length)
                  ? 'default'
                  : 'outline'
              }
              size="sm"
              onClick={() => applyPreset(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>

        {/* Module chips */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Modules:</span>
          {MODULE_OPTIONS.map((module) => (
            <button
              key={module.value}
              type="button"
              onClick={() => toggleModule(module.value)}
              className={cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                selectedModules.includes(module.value)
                  ? `${module.color} text-white`
                  : 'bg-muted text-muted-foreground hover:bg-muted/80',
              )}
            >
              {selectedModules.includes(module.value) && <Check className="h-3 w-3" />}
              {module.label}
            </button>
          ))}
          {selectedModules.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedModules([])}>
              Clear
            </Button>
          )}
        </div>

        {/* Additional filters */}
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

          <select
            value={timeRange}
            onChange={(e) => setTimeRange(e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {TIME_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>

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
        ) : filteredLogs.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <FileText className="mx-auto h-12 w-12 text-muted-foreground" />
              <p className="mt-4 text-muted-foreground">No logs found</p>
              {(selectedModules.length > 0 || timeRange) && (
                <p className="mt-2 text-sm text-muted-foreground">Try adjusting your filters</p>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="h-[calc(100vh-340px)] overflow-auto rounded-lg border bg-card">
            <div className="font-mono text-sm">
              {filteredLogs.map((log, index) => {
                const logId = getLogId(log, index);
                const isExpanded = expandedLogs.has(logId);
                const hasExtraData = Object.keys(log).some((k) => !['time', 'level', 'module', 'msg'].includes(k));

                return (
                  <div key={logId} className="border-b">
                    <div
                      className={cn('flex items-start gap-2 px-4 py-2 hover:bg-muted/50', isExpanded && 'bg-muted/30')}
                    >
                      {/* Expand button */}
                      {hasExtraData && (
                        <button
                          type="button"
                          onClick={() => toggleLogExpansion(logId)}
                          className="mt-0.5 shrink-0 p-0.5 hover:bg-muted rounded"
                        >
                          {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                        </button>
                      )}
                      {!hasExtraData && <div className="w-4" />}

                      <span className="shrink-0 text-xs text-muted-foreground">{formatDateTime(log.time)}</span>
                      <Badge
                        variant={levelBadgeVariants[log.level as LogLevel] ?? 'secondary'}
                        className="shrink-0 text-xs"
                      >
                        {log.level}
                      </Badge>
                      <span className="shrink-0 text-xs text-muted-foreground">[{log.module}]</span>
                      <span className={cn('flex-1', levelColors[log.level as LogLevel])}>{log.msg}</span>

                      {/* Copy button */}
                      <button
                        type="button"
                        onClick={() => copyLogEntry(log, logId)}
                        className="shrink-0 p-1 hover:bg-muted rounded opacity-50 hover:opacity-100 transition-opacity"
                        title="Copy log entry"
                      >
                        {copiedId === logId ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>

                    {/* Expanded JSON view */}
                    {isExpanded && hasExtraData && (
                      <div className="border-t bg-muted/20 px-4 py-2">
                        <pre className="text-xs text-muted-foreground overflow-auto max-h-48">
                          {JSON.stringify(
                            Object.fromEntries(
                              Object.entries(log).filter(([k]) => !['time', 'level', 'module', 'msg'].includes(k)),
                            ),
                            null,
                            2,
                          )}
                        </pre>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Stats */}
        {data?.meta && (
          <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              Showing {filteredLogs.length}
              {timeRange && filteredLogs.length !== data.items.length && ` of ${data.items.length}`} logs
              {data.meta.total > data.items.length && ` (${data.meta.total} total)`}
            </span>
            <span>Buffer: {data.meta.bufferSize}</span>
          </div>
        )}
      </div>
    </>
  );
}
