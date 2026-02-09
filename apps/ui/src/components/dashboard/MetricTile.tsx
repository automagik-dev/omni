/**
 * MetricTile - Animated stat card with sparkline
 */

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { numberRoll, pulseGlow } from '@/lib/motion';
import { useCountUp } from '@/lib/number-animation';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { Sparkline } from './Sparkline';

type AccentColor = 'primary' | 'success' | 'warning' | 'info';
type NumberFormat = 'number' | 'decimal' | 'percentage';

interface MetricTileProps {
  icon: LucideIcon;
  label: string;
  value: number | string;
  subtitle?: string;
  accentColor?: AccentColor;
  sparklineData?: number[];
  format?: NumberFormat;
  className?: string;
}

const accentStyles: Record<AccentColor, { border: string; icon: string; color: string }> = {
  primary: {
    border: 'border-l-primary',
    icon: 'bg-primary/10 text-primary',
    color: 'hsl(var(--primary))',
  },
  success: {
    border: 'border-l-success',
    icon: 'bg-success/10 text-success',
    color: 'hsl(var(--success))',
  },
  warning: {
    border: 'border-l-warning',
    icon: 'bg-warning/10 text-warning',
    color: 'hsl(var(--warning))',
  },
  info: {
    border: 'border-l-info',
    icon: 'bg-info/10 text-info',
    color: 'hsl(var(--info))',
  },
};

export function MetricTile({
  icon: Icon,
  label,
  value,
  subtitle,
  accentColor = 'primary',
  sparklineData,
  format = 'number',
  className,
}: MetricTileProps) {
  const styles = accentStyles[accentColor];

  // Animate number if it's numeric
  const numericValue = typeof value === 'number' ? value : null;
  const animatedValue = useCountUp(numericValue ?? 0, {
    duration: 1000,
    format: format === 'number' ? 'integer' : format === 'percentage' ? 'percentage' : 'decimal',
    decimals: format === 'decimal' ? 1 : 0,
  });

  const displayValue = typeof value === 'number' ? animatedValue : value;

  return (
    <motion.div variants={pulseGlow} initial="hidden" animate="visible" whileHover="hover">
      <Card className={cn('border-l-4 shadow-md hover:shadow-lg transition-shadow', styles.border, className)}>
        <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <div className={cn('rounded-lg p-2', styles.icon)}>
            <Icon className="h-4 w-4" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <motion.div
            variants={numberRoll}
            initial="hidden"
            animate="visible"
            className="text-3xl font-bold tracking-tight"
          >
            {displayValue}
          </motion.div>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          {sparklineData && sparklineData.length > 0 && (
            <div className="pt-2">
              <Sparkline data={sparklineData} width={100} height={24} color={styles.color} strokeWidth={1.5} />
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
