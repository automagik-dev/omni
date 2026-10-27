/**
 * Which buffered messages the dispatcher waits on for processed media text.
 *
 * Meta Cloud (`whatsapp-business`) defers the download: the inbound event carries
 * only the channel-native `mediaId`, never a `mediaUrl`. When the selection required
 * `mediaUrl`, a Cloud API voice note was transcribed by the media processor but the
 * dispatcher found no text and skipped the agent call, so the user got no reply.
 */

import { describe, expect, it } from 'bun:test';
import { __test__ } from '../agent-dispatcher';

const { selectProcessableMedia, collectProcessedMedia } = __test__;

type BufferedLike = Parameters<typeof selectProcessableMedia>[0][number];

/** A buffered inbound message with the given `content`; only `content` matters to the selection. */
function bufferedMessage(content: Record<string, unknown>): BufferedLike {
  return {
    payload: { externalId: 'ext-1', chatId: 'chat-1', from: 'user-1', content },
    metadata: { instanceId: 'inst-1', traceId: 'trace-1' },
    timestamp: Date.now(),
  } as unknown as BufferedLike;
}

describe('selectProcessableMedia', () => {
  it('selects Cloud API audio that carries only a mediaId', () => {
    const cloudAudio = bufferedMessage({ type: 'audio', mediaId: '1479488557369270', mimeType: 'audio/ogg' });
    expect(selectProcessableMedia([cloudAudio])).toEqual([cloudAudio]);
  });

  it('still selects media resolved at receive time (mediaUrl)', () => {
    const urlAudio = bufferedMessage({ type: 'audio', mediaUrl: 'inst-1/2026-10/a.ogg', mimeType: 'audio/ogg' });
    expect(selectProcessableMedia([urlAudio])).toEqual([urlAudio]);
  });

  it('ignores text and media without a type', () => {
    const text = bufferedMessage({ type: 'text', text: 'oi' });
    const untyped = bufferedMessage({ mediaId: '42' });
    expect(selectProcessableMedia([text, untyped])).toEqual([]);
  });
});

describe('collectProcessedMedia', () => {
  it('waits on Cloud API audio by mediaId and hands its transcription to the agent', async () => {
    const lookups: Array<[string, string]> = [];
    const services = {
      chats: { findByExternalIdSmart: async () => ({ id: 'chat-uuid' }) },
      messages: {
        getByExternalId: async (chatId: string, externalId: string) => {
          lookups.push([chatId, externalId]);
          return { id: 'msg-uuid', transcription: 'I want to book an appointment', mediaLocalPath: null };
        },
      },
    } as unknown as Parameters<typeof collectProcessedMedia>[0];
    const instance = {
      id: 'inst-1',
      agentSendMediaPath: false,
      agentSendMediaPathTypes: null,
    } as unknown as Parameters<typeof collectProcessedMedia>[1];
    const cloudAudio = bufferedMessage({ type: 'audio', mediaId: '1479488557369270', mimeType: 'audio/ogg' });

    const texts = await collectProcessedMedia(services, instance, [cloudAudio]);

    expect(lookups).toEqual([['chat-uuid', 'ext-1']]);
    expect(texts).toEqual(['\u{1F3B5}: I want to book an appointment']);
  });
});
