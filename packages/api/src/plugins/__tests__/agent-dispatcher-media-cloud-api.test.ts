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

const { selectProcessableMedia } = __test__;

type BufferedLike = Parameters<typeof selectProcessableMedia>[0][number];
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
