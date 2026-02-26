/**
 * Passive-First Sync Tests
 *
 * Tests for Group 2 of whatsapp-sync-reliability wish:
 * - getAllExternalIds returns chats from DB
 * - discoverAnchorsFromPlugin merges DB + Baileys cache
 * - Default sync takes passive path (no fetchMessageHistory calls)
 * - Per-chat sync takes active path for that one chat only
 */

import { describe, expect, mock, test } from 'bun:test';
import type { Database } from '@omni/db';
import { ChatService } from '../services/chats';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a mock DB that returns given rows for a `select().from().where()` chain */
function mockDbForSelect(rows: unknown[]) {
  return {
    select: mock(() => ({
      from: mock(() => ({
        where: mock(() => rows),
      })),
    })),
  } as unknown as Database;
}

// ---------------------------------------------------------------------------
// ChatService.getAllExternalIds
// ---------------------------------------------------------------------------

describe('ChatService.getAllExternalIds', () => {
  test('returns external IDs from DB for the given instance', async () => {
    const rows = [
      { externalId: '5511999999999@s.whatsapp.net' },
      { externalId: '5511888888888@s.whatsapp.net' },
      { externalId: 'group123@g.us' },
    ];
    const db = mockDbForSelect(rows);
    const service = new ChatService(db, null);

    const result = await service.getAllExternalIds('instance-1');

    expect(result).toEqual(['5511999999999@s.whatsapp.net', '5511888888888@s.whatsapp.net', 'group123@g.us']);
  });

  test('returns empty array when no chats exist', async () => {
    const db = mockDbForSelect([]);
    const service = new ChatService(db, null);

    const result = await service.getAllExternalIds('instance-1');

    expect(result).toEqual([]);
  });

  test('filters out null externalIds', async () => {
    const rows = [{ externalId: '5511999999999@s.whatsapp.net' }, { externalId: null }, { externalId: '' }];
    const db = mockDbForSelect(rows);
    const service = new ChatService(db, null);

    const result = await service.getAllExternalIds('instance-1');

    expect(result).toEqual(['5511999999999@s.whatsapp.net']);
  });
});
