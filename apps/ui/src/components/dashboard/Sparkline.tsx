/**
 * Sparkline - Simple SVG mini chart
 */

import { generateSparklinePath } from '@/lib/sparkline';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
}

export function Sparkline({
  data,
  width = 120,
  height = 32,
  color = 'currentColor',
  strokeWidth = 2,
  className = '',
}: SparklineProps) {
  if (!data || data.length === 0) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="No data available"
      >
        <title>No data available</title>
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke={color}
          strokeWidth={strokeWidth}
          opacity={0.2}
        />
      </svg>
    );
  }

  const path = generateSparklinePath(data, width, height);

  return (
    <svg
      width={width}
      height={height}
      className={className}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Metric trend sparkline"
    >
      <title>Metric trend sparkline</title>
      <defs>
        <linearGradient id="sparkline-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.05} />
        </linearGradient>
      </defs>
      {/* Fill area under the line */}
      <path d={`${path} L ${width},${height} L 0,${height} Z`} fill="url(#sparkline-gradient)" />
      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
