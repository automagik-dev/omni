import { Badge } from '@/components/ui/badge';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { Person } from '@omni/sdk';
import { User } from 'lucide-react';

interface PersonCardProps {
  person: Person;
  isSelected?: boolean;
  onClick?: () => void;
}

/**
 * Card displaying a person's information
 */
export function PersonCard({ person, isSelected = false, onClick }: PersonCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg border p-4 text-left transition-colors',
        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-accent',
      )}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="h-5 w-5 text-muted-foreground" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{person.displayName ?? 'Unknown'}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{formatRelativeTime(person.updatedAt)}</span>
        </div>

        <div className="mt-1 space-y-1 text-sm text-muted-foreground">
          {person.email && <p className="truncate">{person.email}</p>}
          {person.phone && <p className="truncate">{person.phone}</p>}
        </div>

        {/* Quick info */}
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge variant="secondary" className="text-[10px]">
            ID: {person.id.slice(0, 8)}...
          </Badge>
        </div>
      </div>
    </button>
  );
}
