/**
 * Voice notes (`omni speak` / `sendMedia({ type: 'audio', voiceNote: true })`)
 * used to die on Slack with 'Media URL or base64 required': the API route
 * turned the base64 payload into `metadata.audioBuffer` + `ptt`, a shape only
 * the WhatsApp sender reads, and `sendMediaContent` here looks at
 * `metadata.base64` / `content.mediaUrl` only.
 *
 * The route now carries BOTH shapes. This pins the Slack half of that
 * contract: a voice-note message built the way the fixed helper builds it is
 * UPLOADED (files.uploadV2) with the caption as the initial comment, in-thread
 * when replyTo is set — never rejected.
 */

import { describe, expect, it, mock } from 'bun:test';
import type { OutgoingMessage, PluginContext } from '@omni/channel-sdk';
import { SlackPlugin } from '../plugin';

const noop = () => {};
const noopLogger = { debug: noop, info: noop, warn: noop, error: noop, child: () => noopLogger };

type Internals = {
  /** The plugin keys outbound work on attachments now — one per connected instance. */
  attachments: Map<string, unknown>;
};

const AUDIO = Buffer.from('ogg-opus-voice-note-bytes');

/** Exactly what `buildSendMediaMetadata` emits for a voice note (api/routes/v2/messages.ts). */
function voiceNoteMetadata(): Record<string, unknown> {
  const base64 = AUDIO.toString('base64');
  return { base64, audioBuffer: Buffer.from(base64, 'base64'), ptt: true };
}

async function setup() {
  const plugin = new SlackPlugin();
  const published: Array<{ type: string; payload: Record<string, unknown> }> = [];
  await plugin.initialize({
    eventBus: {
      publish: async (event: { type: string; payload: Record<string, unknown> }) => {
        published.push({ type: event.type, payload: event.payload });
      },
      subscribe: () => {},
    },
    storage: {},
    logger: noopLogger,
    config: {},
    db: {},
  } as unknown as PluginContext);

  const uploadV2 = mock(async () => ({
    ok: true,
    files: [{ id: 'F-VOICE', shares: { private: { C1: [{ ts: '1758000000.000100' }] } } }],
  }));
  const internals = plugin as unknown as Internals;
  internals.attachments.set('inst', {
    instanceId: 'inst',
    actingClient: { files: { uploadV2 } },
  });
  return { plugin, uploadV2, published };
}

function uploadArgs(uploadV2: ReturnType<typeof mock>): Record<string, unknown> {
  return (uploadV2.mock.calls[0]?.[0] ?? {}) as Record<string, unknown>;
}

describe('Slack voice-note media send', () => {
  it('uploads a voiceNote base64 payload instead of rejecting it', async () => {
    const { plugin, uploadV2, published } = await setup();

    const message: OutgoingMessage = {
      to: 'C1',
      content: {
        type: 'audio',
        filename: 'voice.ogg',
        mimeType: 'audio/ogg; codecs=opus',
        caption: 'here is the voice note',
      },
      metadata: voiceNoteMetadata(),
    };

    const result = await plugin.sendMessage('inst', message);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(published.some((e) => e.type === 'message.failed')).toBe(false);
    expect(uploadV2).toHaveBeenCalledTimes(1);

    const args = uploadArgs(uploadV2);
    expect(args.channel_id).toBe('C1');
    expect(args.filename).toBe('voice.ogg');
    expect(args.initial_comment).toBe('here is the voice note');
    expect(Buffer.isBuffer(args.file)).toBe(true);
    expect((args.file as Buffer).equals(AUDIO)).toBe(true);
    expect(result.messageId).toBe('1758000000.000100');
  });

  it('uploads into the thread and uses the text as the initial comment when replyTo is set', async () => {
    const { plugin, uploadV2 } = await setup();

    const result = await plugin.sendMessage('inst', {
      to: 'C1',
      replyTo: '1757000000.000200',
      content: { type: 'audio', filename: 'voice.ogg', text: 'spoken reply' },
      metadata: voiceNoteMetadata(),
    });

    expect(result.success).toBe(true);
    expect(uploadV2).toHaveBeenCalledTimes(1);
    const args = uploadArgs(uploadV2);
    expect(args.thread_ts).toBe('1757000000.000200');
    expect(args.initial_comment).toBe('spoken reply');
  });
});
