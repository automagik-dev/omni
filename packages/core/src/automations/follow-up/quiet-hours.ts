import { type FollowUpQuietHours, timeOfDayToMinutes } from '../../schemas/follow-up';

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_DAY = 24 * 60;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

function localMinuteOfDay(at: number, timeZone: string): number {
  let hour = 0;
  let minute = 0;
  for (const part of formatterFor(timeZone).formatToParts(at)) {
    if (part.type === 'hour') hour = Number(part.value);
    else if (part.type === 'minute') minute = Number(part.value);
  }
  return (hour % 24) * 60 + minute;
}

function isWithin(minute: number, start: number, end: number): boolean {
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

function spreadOffsetMs(chatId: string, spreadMinutes: number): number {
  if (spreadMinutes <= 0) return 0;
  let hash = 0x811c9dc5;
  for (let i = 0; i < chatId.length; i++) {
    hash = Math.imul(hash ^ chatId.charCodeAt(i), 0x01000193) >>> 0;
  }
  return (hash % (spreadMinutes * 60)) * 1000;
}

export function quietHoursDeferral(quietHours: FollowUpQuietHours, chatId: string, now: Date): Date | null {
  const start = timeOfDayToMinutes(quietHours.start);
  const end = timeOfDayToMinutes(quietHours.end);
  const nowMs = now.getTime();
  const localMinute = localMinuteOfDay(nowMs, quietHours.timezone);
  if (!isWithin(localMinute, start, end)) return null;

  const minutesUntilEnd = (end - localMinute + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  let reopensAt = nowMs - (nowMs % MS_PER_MINUTE) + minutesUntilEnd * MS_PER_MINUTE;
  const actual = localMinuteOfDay(reopensAt, quietHours.timezone);
  if (actual !== end) {
    const drift = ((end - actual + MINUTES_PER_DAY + MINUTES_PER_DAY / 2) % MINUTES_PER_DAY) - MINUTES_PER_DAY / 2;
    const corrected = reopensAt + drift * MS_PER_MINUTE;
    if (corrected > nowMs && localMinuteOfDay(corrected, quietHours.timezone) === end) reopensAt = corrected;
  }
  return new Date(reopensAt + spreadOffsetMs(chatId, quietHours.spreadMinutes ?? 0));
}
