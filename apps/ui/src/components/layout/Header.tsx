import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { queryKeys } from '@/lib/query';
import { getClient } from '@/lib/sdk';
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
    refetchInterval: 30000, // Refresh every 30s
  });

  return (
    <header className="flex h-16 items-center justify-between border-b bg-card px-6">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-4">
        {actions}

        {/* System status */}
        <div className="flex items-center gap-2">
          <Badge variant={health?.status === 'healthy' ? 'success' : 'destructive'}>
            {health?.status ?? 'unknown'}
          </Badge>
          <Button variant="ghost" size="icon" onClick={() => refetch()} disabled={isRefetching}>
            <RefreshCw className={cn('h-4 w-4', isRefetching && 'animate-spin')} />
          </Button>
        </div>
      </div>
    </header>
  );
}

function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
