/**
 * Animated number count-up hook using Framer Motion
 */

import { animate } from 'motion';
import { useEffect, useState } from 'react';

type NumberFormat = 'integer' | 'decimal' | 'percentage';

interface UseCountUpOptions {
  duration?: number;
  format?: NumberFormat;
  decimals?: number;
}

/**
 * Animated number count-up effect
 *
 * @param end - Target number to count up to
 * @param options - Animation options
 * @returns Formatted animated value as string
 */
export function useCountUp(end: number, options: UseCountUpOptions = {}): string {
  const { duration = 1000, format = 'integer', decimals = 1 } = options;
  const [current, setCurrent] = useState(0);

  useEffect(() => {
    const controls = animate(0, end, {
      duration: duration / 1000,
      ease: [0.25, 0.46, 0.45, 0.94],
      onUpdate: (value) => {
        setCurrent(value);
      },
    });

    return () => controls.stop();
  }, [end, duration]);

  return formatNumber(current, format, decimals);
}

/**
 * Format a number according to the specified format
 */
function formatNumber(value: number, format: NumberFormat, decimals: number): string {
  switch (format) {
    case 'integer':
      return Math.round(value).toLocaleString();
    case 'decimal':
      return value.toFixed(decimals);
    case 'percentage':
      return `${value.toFixed(decimals)}%`;
    default:
      return value.toString();
  }
}
