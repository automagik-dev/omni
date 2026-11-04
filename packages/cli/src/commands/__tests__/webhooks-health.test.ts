import { describe, expect, test } from 'bun:test';
import { formatSourceHealthAlerts, sourceHealthAlerts } from '../webhooks';

describe('source health alerts (#1239/#1241)', () => {
  test('collects stalled and poll-disabled sources into one banner', () => {
    const alerts = sourceHealthAlerts([
      { name: 'meetings', livenessStatus: 'stalled' },
      { name: 'actions', livenessStatus: 'disabled' },
      { name: 'gmail', livenessStatus: 'healthy' },
      { name: 'push', livenessStatus: null },
    ]);
    expect(alerts).toEqual({ stalled: ['meetings'], pollDisabled: ['actions'] });
    expect(formatSourceHealthAlerts(alerts)).toBe(
      'Sources: 1 stalled (meetings); 1 poll disabled, no OMNI_POLL_COMMAND_DIR (actions)',
    );
  });

  test('no banner when every source is fine', () => {
    expect(formatSourceHealthAlerts(sourceHealthAlerts([{ name: 'gmail', livenessStatus: 'healthy' }]))).toBeNull();
  });
});
