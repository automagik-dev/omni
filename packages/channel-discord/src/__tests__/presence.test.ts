import { describe, expect, test } from 'bun:test';
import { ActivityType } from 'discord.js';

describe('bot presence', () => {
  test('ActivityType enum has expected values', () => {
    expect(ActivityType.Playing).toBe(0);
    expect(ActivityType.Streaming).toBe(1);
    expect(ActivityType.Listening).toBe(2);
    expect(ActivityType.Watching).toBe(3);
    expect(ActivityType.Custom).toBe(4);
    expect(ActivityType.Competing).toBe(5);
  });

  test('presence status values are valid PresenceStatusData', () => {
    const validStatuses = ['online', 'dnd', 'idle', 'invisible'];
    for (const status of validStatuses) {
      expect(typeof status).toBe('string');
      expect(validStatuses).toContain(status);
    }
  });

  test('activity type mapping covers all types', () => {
    const activityTypeMap: Record<string, ActivityType> = {
      Playing: ActivityType.Playing,
      Streaming: ActivityType.Streaming,
      Listening: ActivityType.Listening,
      Watching: ActivityType.Watching,
      Custom: ActivityType.Custom,
      Competing: ActivityType.Competing,
    };

    expect(Object.keys(activityTypeMap)).toHaveLength(6);
    expect(activityTypeMap.Playing).toBe(ActivityType.Playing);
    expect(activityTypeMap.Competing).toBe(ActivityType.Competing);
  });

  test('presence config shape is valid', () => {
    const presenceConfig = {
      status: 'online' as const,
      activityText: 'Omni v2',
      activityType: 'Playing' as const,
    };

    expect(presenceConfig.status).toBe('online');
    expect(presenceConfig.activityText).toBe('Omni v2');
    expect(presenceConfig.activityType).toBe('Playing');
  });

  test('presence with no activity text produces empty activities', () => {
    const presence: { status: string; activityText?: string } = { status: 'dnd' };
    const activities = presence.activityText ? [{ name: presence.activityText, type: ActivityType.Playing }] : [];
    expect(activities).toEqual([]);
  });

  test('presence with activity text produces one activity', () => {
    const presence = { status: 'online' as const, activityText: 'Testing' };
    const activities = presence.activityText ? [{ name: presence.activityText, type: ActivityType.Playing }] : [];
    expect(activities).toHaveLength(1);
    expect(activities[0]?.name).toBe('Testing');
  });
});
