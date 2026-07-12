/**
 * Top-level entity diff for {@link MutationResult}'s read-back evidence: compare
 * the entity as it was before a mutation with the freshly re-fetched version and
 * report which fields actually changed. Pure and JSON-based so it's testable and
 * order-independent.
 */
export interface FieldChange {
  key: string;
  before: unknown;
  after: unknown;
}

function stable(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Fields whose JSON representation differs between `before` and `after`. */
export function diffEntities(before: unknown, after: unknown): FieldChange[] {
  const a = (before && typeof before === 'object' ? before : {}) as Record<string, unknown>;
  const b = (after && typeof after === 'object' ? after : {}) as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const changes: FieldChange[] = [];
  for (const key of keys) {
    if (stable(a[key]) !== stable(b[key])) {
      changes.push({ key, before: a[key], after: b[key] });
    }
  }
  return changes.sort((x, y) => x.key.localeCompare(y.key));
}
