import { describe, expect, test } from 'bun:test';
import type { MessageAnchor } from '../../plugin';
import { ANCHOR_BATCH_SIZE, buildNextAnchors, chunk, createChatTracker } from '../history-anchors';

const anchor = (chatJid: string, remoteJid: string, timestamp: number): MessageAnchor => ({
  chatJid,
  messageKey: { remoteJid, id: `a-${chatJid}`, fromMe: false },
  timestamp,
});

describe('history anchor paging', () => {
  test('continues a chat when a round returned fewer than 50 but older messages', () => {
    const tracker = createChatTracker([anchor('c1@g.us', 'c1@g.us', 1000)]);
    const entry = tracker.get('c1@g.us');
    if (!entry) throw new Error('missing entry');
    entry.count = 7;
    entry.oldest = { key: { remoteJid: 'c1@g.us', id: 'm1' }, timestamp: 500 };

    const { anchors, totalFetched } = buildNextAnchors(tracker);
    expect(totalFetched).toBe(7);
    expect(anchors).toEqual([
      { chatJid: 'c1@g.us', messageKey: { remoteJid: 'c1@g.us', id: 'm1', fromMe: false }, timestamp: 500 },
    ]);
  });

  test('stops a chat with no replies or nothing older than the anchor', () => {
    const tracker = createChatTracker([anchor('a', 'a', 1000), anchor('b', 'b', 1000)]);
    const b = tracker.get('b');
    if (!b) throw new Error('missing entry');
    b.count = 3;
    b.oldest = { key: { remoteJid: 'b', id: 'm' }, timestamp: 1000 };
    expect(buildNextAnchors(tracker).anchors).toEqual([]);
  });

  test('tracks replies under the anchor remoteJid alias without duplicating anchors', () => {
    const tracker = createChatTracker([anchor('5511@s.whatsapp.net', '123@lid', 1000)]);
    expect(tracker.get('123@lid')).toBe(tracker.get('5511@s.whatsapp.net'));
    const entry = tracker.get('123@lid');
    if (!entry) throw new Error('missing entry');
    entry.count = 1;
    entry.oldest = { key: { remoteJid: '123@lid', id: 'm' }, timestamp: 1 };

    const { anchors, totalFetched } = buildNextAnchors(tracker);
    expect(totalFetched).toBe(1);
    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.chatJid).toBe('5511@s.whatsapp.net');
  });

  test('batches anchors into groups of ANCHOR_BATCH_SIZE', () => {
    const items = Array.from({ length: 23 }, (_, i) => i);
    const batches = chunk(items, ANCHOR_BATCH_SIZE);
    expect(batches.map((b) => b.length)).toEqual([10, 10, 3]);
    expect(batches.flat()).toEqual(items);
  });
});
