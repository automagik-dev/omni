/**
 * isHistoryPushBlocking (#1123): only a recent or progressing history-push job
 * blocks manual syncs; a stale one is auto-completed.
 */

import { describe, expect, mock, test } from 'bun:test';
import { HISTORY_PUSH_STALE_MS, SyncJobService } from '../sync-jobs';

const ago = (ms: number) => new Date(Date.now() - ms);

function serviceWith(jobs: Record<string, unknown>[]) {
  const service = new SyncJobService({} as any, null);
  const complete = mock(async () => ({}) as any);
  service.getActiveForInstance = mock(async () => jobs as any);
  service.complete = complete;
  return { service, complete };
}

describe('SyncJobService.isHistoryPushBlocking', () => {
  test('no active history-push job does not block', async () => {
    const { service } = serviceWith([{ id: 'm', type: 'messages', createdAt: new Date() }]);
    expect(await service.isHistoryPushBlocking('inst-1')).toBe(false);
  });

  test('recently started job blocks', async () => {
    const { service, complete } = serviceWith([
      { id: 'hp', type: 'history-push', startedAt: ago(60_000), createdAt: ago(60_000) },
    ]);
    expect(await service.isHistoryPushBlocking('inst-1')).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  });

  test('old job with recent progress blocks', async () => {
    const { service } = serviceWith([
      {
        id: 'hp',
        type: 'history-push',
        startedAt: ago(3 * 60 * 60 * 1000),
        createdAt: ago(3 * 60 * 60 * 1000),
        progress: { lastProgressAt: ago(30_000).toISOString() },
      },
    ]);
    expect(await service.isHistoryPushBlocking('inst-1')).toBe(true);
  });

  test('job with no progress past the stale window is auto-completed and does not block', async () => {
    const { service, complete } = serviceWith([
      {
        id: 'hp',
        type: 'history-push',
        startedAt: ago(HISTORY_PUSH_STALE_MS + 1000),
        createdAt: ago(HISTORY_PUSH_STALE_MS + 1000),
      },
    ]);
    expect(await service.isHistoryPushBlocking('inst-1')).toBe(false);
    expect(complete).toHaveBeenCalledWith('hp', undefined);
  });
});
