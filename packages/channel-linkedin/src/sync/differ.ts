/**
 * Generic Diff Engine for sync operations.
 *
 * Compares scraped data against existing DB records by externalId to detect
 * additions, updates, removals, and unchanged entities. Used by both the
 * feed poller and inbox poller for DB-backed diffing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result of diffing two entity lists.
 *
 * @typeParam T - Entity type (must have an externalId string field)
 */
export interface DiffResult<T> {
  /** Entities present in scraped but not in existing */
  added: T[];
  /** Entities present in both but with changed data */
  updated: { old: T; new: T }[];
  /** Entities present in existing but not in scraped (potentially removed) */
  removed: T[];
  /** Entities present in both with no changes */
  unchanged: T[];
}

// ---------------------------------------------------------------------------
// Core diff function
// ---------------------------------------------------------------------------

/**
 * Diff two arrays of entities by their externalId field.
 *
 * Builds a map of existing entities keyed by externalId, then iterates
 * the scraped list to classify each entity as added, updated, or unchanged.
 * Any existing entities not seen in the scraped list are classified as removed.
 *
 * @param existing - Entities currently in the DB
 * @param scraped - Entities freshly scraped from LinkedIn
 * @param hasChanged - Comparator function that returns true if the entity changed
 * @returns Classification of all entities into added/updated/removed/unchanged
 */
export function diffByExternalId<T extends { externalId: string }>(
  existing: T[],
  scraped: T[],
  hasChanged: (old: T, new_: T) => boolean,
): DiffResult<T> {
  const result: DiffResult<T> = {
    added: [],
    updated: [],
    removed: [],
    unchanged: [],
  };

  // Build lookup map from existing entities
  const existingMap = new Map<string, T>();
  for (const item of existing) {
    existingMap.set(item.externalId, item);
  }

  // Track which existing entities we've seen in the scraped data
  const seenIds = new Set<string>();

  for (const scrapedItem of scraped) {
    const existingItem = existingMap.get(scrapedItem.externalId);
    seenIds.add(scrapedItem.externalId);

    if (!existingItem) {
      // New entity not in DB
      result.added.push(scrapedItem);
    } else if (hasChanged(existingItem, scrapedItem)) {
      // Entity exists but data changed
      result.updated.push({ old: existingItem, new: scrapedItem });
    } else {
      // Entity exists and data unchanged
      result.unchanged.push(scrapedItem);
    }
  }

  // Entities in DB but not in scraped data are considered removed
  for (const item of existing) {
    if (!seenIds.has(item.externalId)) {
      result.removed.push(item);
    }
  }

  return result;
}
