/**
 * Sync engine — barrel exports.
 *
 * Provides the diff engine, feed poller, and inbox poller for
 * automated LinkedIn data synchronization.
 */

export { diffByExternalId } from './differ';
export type { DiffResult } from './differ';

export { FeedPoller } from './feed-poller';
export type { FeedPollerConfig, FeedPollerDataAccess } from './feed-poller';

export { InboxPoller } from './inbox-poller';
export type { InboxPollerConfig } from './inbox-poller';
