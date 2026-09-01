/**
 * Inbound media.
 *
 * The flow's `api_rest` node hands us `chatInput` = `{#MENSAGEM}`, and for
 * audio/image/document that variable is the platform's FILE NAME, not the
 * content (measured 01/09 on the live number: an audio reached the agent as
 * `1820260901wamid.….ogg` and got "Ainda não conseguimos localizar seu
 * cadastro"). The bytes live on `GET /atendimento`, inline as base64.
 *
 * These tests pin the three things that matter: the fetch happens ONLY for a
 * name-shaped input, the emitted event is real media (so the transcription /
 * description pipeline runs), and a failed resolution degrades instead of
 * wedging the turn.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { AscFlowPlugin } from '../plugin';
import { MockEventBus, connectPlugin, createContext, instanceId, jsonResponse, stubPlatform } from './helpers';

const AUDIO_NAME = '1820260901wamid.HBgMNTU1MTk3Mjg1ODI5FQIAEhgWM0VCMEFDNzFBN0I0OEI4NjMxNUZEQgA.ogg';
const IMAGE_NAME = '1820260901wamid.HBgMNTU1MTk3Mjg1ODI5FQIAEhgWM0VCMDVBMzI5NTZFMEU2Qjk3MUYzNgA.jpg';

/** Shaped after the real body measured on cod 22204897 (01/09). */
function atendimentoBody(): unknown {
  return {
    id_atendimento: '22204897',
    mensagens: [
      {
        id_mensagem: '135724411',
        boleano_entrante: '1',
        tip_msg: 'TEXTO',
        descricao_msg: 'oi',
      },
      {
        id_mensagem: '135724529',
        boleano_entrante: '1',
        tip_msg: 'AUDIO',
        descricao_msg: AUDIO_NAME,
        'content-type': 'audio/ogg; codecs=opus',
        base64_arquivo: Buffer.from('fake-ogg-bytes').toString('base64'),
      },
      {
        id_mensagem: '135724689',
        boleano_entrante: '1',
        tip_msg: 'IMG',
        descricao_msg: IMAGE_NAME,
        'content-type': 'image/jpeg',
        base64_arquivo: Buffer.from('fake-jpeg-bytes').toString('base64'),
      },
    ],
  };
}

let plugin: AscFlowPlugin;
let eventBus: MockEventBus;
let restore: () => void;
let calls: Array<{ path: string }>;

const url = `http://localhost/api/v2/channels/asc-flow/${instanceId}/webhook`;

async function boot(atendimento: () => Response = () => jsonResponse(atendimentoBody())): Promise<void> {
  const stub = stubPlatform({ '/atendimento': atendimento });
  restore = stub.restore;
  calls = stub.calls;
  eventBus = new MockEventBus();
  plugin = new AscFlowPlugin();
  await plugin.initialize(createContext(eventBus));
  await connectPlugin(plugin);
}

const post = (chatInput: string, cod = '22204897') =>
  plugin.handleWebhook(
    new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ codAtendimento: cod, chatInput }),
    }),
  );

/** The `content` of the single emitted `message.received`. */
function receivedContent(): Record<string, unknown> {
  const events = eventBus.published.filter((e) => e.type.includes('received'));
  expect(events).toHaveLength(1);
  const payload = events[0]?.payload as { content: Record<string, unknown> };
  return payload.content;
}

const atendimentoCalls = () => calls.filter((c) => c.path === '/atendimento');

let previousMediaPath: string | undefined;

beforeEach(() => {
  // Keep the local media backend out of the repo working tree — and RESTORE it
  // afterwards: the whole suite shares one process, so a leaked
  // MEDIA_STORAGE_PATH would follow every other package's tests.
  previousMediaPath = process.env.MEDIA_STORAGE_PATH;
  process.env.MEDIA_STORAGE_PATH = mkdtempSync(join(tmpdir(), 'asc-flow-media-'));
});

afterEach(async () => {
  await plugin?.destroy();
  restore?.();
  process.env.MEDIA_STORAGE_PATH = previousMediaPath;
});

describe('inbound media', () => {
  it('resolves an .ogg file name into an audio message with its mimetype', async () => {
    await boot();

    const response = await post(AUDIO_NAME);
    expect(await response.json()).toEqual({ pronto: 0 });

    const content = receivedContent();
    expect(content.type).toBe('audio');
    expect(content.mimeType).toBe('audio/ogg');
    // The bytes are on disk; `localPath` is what message-persistence writes to
    // `messages.mediaLocalPath`, which the media processor reads directly.
    expect(String(content.localPath)).toContain(instanceId);
    expect(String(content.localPath)).toEndWith('.ogg');
    expect(content.text).toBeUndefined();
    expect(atendimentoCalls()).toHaveLength(1);
  });

  it('resolves a .jpg file name into an image message', async () => {
    await boot();
    await post(IMAGE_NAME);

    const content = receivedContent();
    expect(content.type).toBe('image');
    expect(content.mimeType).toBe('image/jpeg');
    expect(String(content.localPath)).toEndWith('.jpg');
  });

  // `collectProcessedMedia` filters on `mediaUrl` to decide a message is media
  // worth waiting for. Without it the dispatcher called the agent BEFORE the
  // description existed and dropped the turn as "no text or media content"
  // (measured on the live number 01/09) — so this is load-bearing, not cosmetic.
  it('publishes mediaUrl so the dispatcher waits for the transcription', async () => {
    await boot();
    await post(IMAGE_NAME);

    const content = receivedContent();
    expect(content.mediaUrl).toBeDefined();
    expect(content.mediaUrl).toBe(content.localPath);
  });

  it('never touches /atendimento for ordinary text', async () => {
    await boot();
    await post('quero remarcar minha consulta');

    expect(atendimentoCalls()).toHaveLength(0);
    const content = receivedContent();
    expect(content.type).toBe('text');
    expect(content.text).toBe('quero remarcar minha consulta');
  });

  it('degrades to text (and keeps the turn alive) when the media is not in the atendimento', async () => {
    await boot(() => jsonResponse({ id_atendimento: '22204897', mensagens: [] }));

    const response = await post(AUDIO_NAME);
    // The turn still answers the POLL contract — the flow keeps polling.
    expect(await response.json()).toEqual({ pronto: 0 });

    const content = receivedContent();
    expect(content.type).toBe('text');
    // Not the raw file name: that is what the agent answered nonsense to.
    expect(content.text).not.toContain('wamid');
    expect(content.text).toContain('áudio');
  });

  it('degrades to text when /atendimento is down', async () => {
    await boot(() => jsonResponse({ msg: 'boom' }, 500));

    await post(AUDIO_NAME);

    const content = receivedContent();
    expect(content.type).toBe('text');
    expect(content.text).toContain('áudio');
  });
});
