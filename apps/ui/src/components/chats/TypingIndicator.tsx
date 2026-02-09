import { cn } from '@/lib/utils';

interface TypingIndicatorProps {
  displayName: string;
  className?: string;
}

/**
 * Animated typing indicator for chat
 * Shows bouncing dots with user's name
 */
export function TypingIndicator({ displayName, className }: TypingIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground', className)}>
      <span>{displayName} is typing</span>
      <div className="flex gap-1">
        <Dot delay={0} />
        <Dot delay={150} />
        <Dot delay={300} />
      </div>
    </div>
  );
}

/**
 * Single bouncing dot
 */
function Dot({ delay }: { delay: number }) {
  return (
    <div
      className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
      style={{
        animationDelay: `${delay}ms`,
        animationDuration: '1s',
      }}
    />
  );
}
