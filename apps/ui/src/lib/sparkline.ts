/**
 * Sparkline utility functions for generating SVG paths from data
 */

/**
 * Normalize an array of numbers to a 0-100 range
 */
export function normalizeData(data: number[]): number[] {
  if (data.length === 0) return [];

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min;

  // Avoid division by zero
  if (range === 0) return data.map(() => 50);

  return data.map((value) => ((value - min) / range) * 100);
}

/**
 * Generate an SVG path from normalized data points
 */
export function generateSparklinePath(data: number[], width: number, height: number, padding = 2): string {
  if (data.length === 0) return '';
  if (data.length === 1) {
    const y = height - padding;
    return `M 0,${y} L ${width},${y}`;
  }

  const normalized = normalizeData(data);
  const stepX = (width - padding * 2) / (data.length - 1);
  const effectiveHeight = height - padding * 2;

  const points = normalized.map((value, index) => {
    const x = padding + index * stepX;
    // Invert Y axis (SVG Y increases downward)
    const y = height - padding - (value / 100) * effectiveHeight;
    return { x, y };
  });

  // Generate smooth path using bezier curves
  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 0; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const midX = (current.x + next.x) / 2;

    // Create smooth curve
    path += ` Q ${current.x},${current.y} ${midX},${(current.y + next.y) / 2}`;
    path += ` Q ${next.x},${next.y} ${next.x},${next.y}`;
  }

  return path;
}
