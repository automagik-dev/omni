import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/ui/theme-toggle';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

interface HeaderProps {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

export function Header({ title, subtitle, actions }: HeaderProps) {
  const {
    data: health,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: queryKeys.systemHealth(),
    queryFn: () => getClient().system.health(),
    refetchInterval: 30000,
  });

  const isHealthy = health?.status === 'healthy';

  return (
    <header className="flex h-16 items-center justify-between border-b border-border/30 bg-transparent px-6">
      <div>
        <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="font-mono text-xs uppercase tracking-wider text-muted-foreground/60">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-4">
        {actions}

        <ThemeToggle />

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={cn('relative flex h-2 w-2')}>
              {isHealthy && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              )}
              <span
                className={cn('relative inline-flex h-2 w-2 rounded-full', isHealthy ? 'bg-success' : 'bg-destructive')}
              />
            </span>
            <span className="text-xs text-muted-foreground">{health?.status ?? 'loading'}</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isRefetching} className="h-8 w-8">
            <RefreshCw className={cn('h-3.5 w-3.5', isRefetching && 'animate-spin')} />
          </Button>
        </div>
      </div>
    </header>
  );
}
