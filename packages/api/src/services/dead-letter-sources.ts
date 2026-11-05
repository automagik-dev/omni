/**
 * `metadata.source` of every generic dead-letter retry publish (manual, auto).
 * Kept dependency-free so consumers can recognise a replay without importing
 * the dead-letter service.
 */
export const DEAD_LETTER_RETRY_SOURCES = ['dead-letter-retry', 'dead-letter-auto-retry'] as const;
