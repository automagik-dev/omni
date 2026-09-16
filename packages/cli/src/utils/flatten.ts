/**
 * Flatten a JSON value into dot-path → leaf value pairs (`a.b.0.c`).
 * Empty objects/arrays are kept as leaves so they stay visible.
 */
export function flattenPaths(value: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const isContainer = value !== null && typeof value === 'object';
  if (!isContainer || Object.keys(value).length === 0) {
    if (prefix) out[prefix] = value;
    return out;
  }
  for (const [key, child] of Object.entries(value)) {
    Object.assign(out, flattenPaths(child, prefix ? `${prefix}.${key}` : key));
  }
  return out;
}

/** Truncate long strings so a flattened line stays readable. */
export function truncateValue(value: unknown, max = 80): unknown {
  return typeof value === 'string' && value.length > max ? `${value.slice(0, max)}…` : value;
}
