import { cn } from '@/lib/utils';
import { forwardRef } from 'react';

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number;
  max?: number;
}

const Progress = forwardRef<HTMLDivElement, ProgressProps>(({ className, value = 0, max = 100, ...props }, ref) => {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <div
      ref={ref}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label="Progress"
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <div
        className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary shadow-[0_0_8px_oklch(0.72_0.17_195_/_0.3)] transition-all duration-500 ease-out"
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
});
Progress.displayName = 'Progress';

export { Progress };
