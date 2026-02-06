import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ReactionBadgeProps {
  emoji: string;
  count: number;
  users: string[];
  isFromMe?: boolean;
}

/**
 * Display a reaction emoji with count as a badge on a message
 */
export function ReactionBadge({ emoji, count, users, isFromMe }: ReactionBadgeProps) {
  const tooltipContent =
    users.length > 3 ? `${users.slice(0, 3).join(', ')} +${users.length - 3} more` : users.join(', ');

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs',
              isFromMe ? 'bg-primary-foreground/20 text-primary-foreground' : 'bg-muted-foreground/20 text-foreground',
            )}
          >
            <span className="text-sm">{emoji}</span>
            {count > 1 && <span className="font-medium">{count}</span>}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[200px]">
          <p className="text-xs">{tooltipContent}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface ReactionListProps {
  reactions: { emoji: string; count: number; users: string[] }[];
  isFromMe?: boolean;
}

/**
 * Display a list of reaction badges
 */
export function ReactionList({ reactions, isFromMe }: ReactionListProps) {
  if (reactions.length === 0) return null;

  return (
    <div className={cn('mt-1 flex flex-wrap gap-1', isFromMe ? 'justify-end' : 'justify-start')}>
      {reactions.map(({ emoji, count, users }) => (
        <ReactionBadge key={emoji} emoji={emoji} count={count} users={users} isFromMe={isFromMe} />
      ))}
    </div>
  );
}
