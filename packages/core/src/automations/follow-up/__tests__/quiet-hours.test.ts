import { describe, expect, test } from 'bun:test';
import { quietHoursDeferral } from '../quiet-hours';

describe('quietHoursDeferral', () => {
  const overnight = { start: '22:00', end: '08:00', timezone: 'America/Sao_Paulo' };

  test('returns null outside the period', () => {
    expect(quietHoursDeferral(overnight, 'chat-1', new Date('2026-04-14T14:00:00.000Z'))).toBeNull();
    expect(quietHoursDeferral(overnight, 'chat-1', new Date('2026-04-14T00:59:59.000Z'))).toBeNull();
  });

  test('drops the seconds of now so the period reopens on the minute', () => {
    expect(quietHoursDeferral(overnight, 'chat-1', new Date('2026-04-14T03:17:42.512Z'))).toEqual(
      new Date('2026-04-14T11:00:00.000Z'),
    );
  });

  test('reads the time of day in the configured time zone', () => {
    const tokyo = { start: '22:00', end: '08:00', timezone: 'Asia/Tokyo' };
    expect(quietHoursDeferral(tokyo, 'chat-1', new Date('2026-04-14T14:00:00.000Z'))).toEqual(
      new Date('2026-04-14T23:00:00.000Z'),
    );
    expect(quietHoursDeferral(tokyo, 'chat-1', new Date('2026-04-14T02:30:00.000Z'))).toBeNull();
  });

  test('lands on the local end time across a spring-forward night', () => {
    const newYork = { start: '22:00', end: '08:00', timezone: 'America/New_York' };
    expect(quietHoursDeferral(newYork, 'chat-1', new Date('2026-03-08T04:00:00.000Z'))).toEqual(
      new Date('2026-03-08T12:00:00.000Z'),
    );
  });

  test('lands on the local end time across a fall-back night', () => {
    const newYork = { start: '22:00', end: '08:00', timezone: 'America/New_York' };
    expect(quietHoursDeferral(newYork, 'chat-1', new Date('2026-11-01T03:00:00.000Z'))).toEqual(
      new Date('2026-11-01T13:00:00.000Z'),
    );
  });

  test('an end time skipped by the clock change still reopens after now', () => {
    const newYork = { start: '01:00', end: '02:30', timezone: 'America/New_York' };
    const now = new Date('2026-03-08T06:30:00.000Z');
    const reopensAt = quietHoursDeferral(newYork, 'chat-1', now);
    expect(reopensAt).not.toBeNull();
    expect((reopensAt as Date).getTime()).toBeGreaterThan(now.getTime());
    expect(quietHoursDeferral(newYork, 'chat-1', reopensAt as Date)).toBeNull();
  });

  test('without spreadMinutes every chat reopens at the same instant', () => {
    const now = new Date('2026-04-14T03:00:00.000Z');
    expect(quietHoursDeferral(overnight, 'chat-a', now)).toEqual(quietHoursDeferral(overnight, 'chat-b', now));
  });
});
