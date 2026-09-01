/**
 * Outbound rich content: media, location, contact and real interactives, all
 * of which leave through `POST /mensagem`.
 *
 * Every platform call is stubbed — nothing here may reach the real ASC.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'bun:test';

import { AscFlowPlugin } from '../plugin';
import {
  MockEventBus,
  type RecordedCall,
  connectPlugin,
  createContext,
  instanceId,
  jsonResponse,
  stubPlatform,
} from './helpers';

let plugin: AscFlowPlugin;
let calls: RecordedCall[];
let restore: () => void;

const of = (path: string) => calls.filter((c) => c.path === path);
const ready = (cod: string) => plugin.takeReadyTurn(instanceId, cod);

async function boot(
  overrides: Record<string, () => Response> = {},
  credentials: Record<string, unknown> = {},
): Promise<void> {
  const stub = stubPlatform(overrides);
  calls = stub.calls;
  restore = stub.restore;
  plugin = new AscFlowPlugin();
  await plugin.initialize(createContext(new MockEventBus()));
  await connectPlugin(plugin, credentials);
  calls.length = 0;
}

const send = (content: Record<string, unknown>, message: Record<string, unknown> = {}) =>
  plugin.sendMessage(instanceId, { to: '42', content: content as never, ...message });

/** A real file on disk — the media path reads bytes, it does not mock them. */
const dir = mkdtempSync(join(tmpdir(), 'asc-flow-'));
function fileWith(name: string, bytes: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, bytes);
  return path;
}

afterEach(async () => {
  await plugin?.destroy();
  restore?.();
});

describe('outbound media', () => {
  it('sends a local image as base64 with its name and mime type', async () => {
    await boot();
    const path = fileWith('foto.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

    const result = await send({ type: 'image', localPath: path, mimeType: 'image/jpeg', caption: 'olha só' });

    expect(result.success).toBe(true);
    const mensagem = of('/mensagem');
    expect(mensagem).toHaveLength(1);
    expect(mensagem[0]?.body).toMatchObject({
      cod: 42,
      mensagem: 'olha só',
      entrante: 0,
      bolFlow: true,
      nome_arquivo: 'foto.jpg',
      mime_type: 'image/jpeg',
      base64_arquivo: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'),
    });
    // The bubble is already on the handset — `resposta` must not repeat it.
    expect(ready('42')).toMatchObject({ pronto: 1, resposta: '' });
  });

  it('prefers a public URL over shipping the bytes', async () => {
    await boot();
    await send({ type: 'document', mediaUrl: 'https://cdn.test/guia.pdf', mimeType: 'application/pdf' });

    expect(of('/mensagem')[0]?.body).toMatchObject({
      url_arquivo: 'https://cdn.test/guia.pdf',
      nome_arquivo: 'guia.pdf',
      mime_type: 'application/pdf',
    });
    expect(of('/mensagem')[0]?.body.base64_arquivo).toBeUndefined();
  });

  it('sends audio through the same single call', async () => {
    await boot();
    const path = fileWith('audio.ogg', Buffer.from('OggS'));
    await send({ type: 'audio', localPath: path, mimeType: 'audio/ogg' });

    expect(of('/mensagem')).toHaveLength(1);
    expect(of('/mensagem')[0]?.body).toMatchObject({ mime_type: 'audio/ogg', nome_arquivo: 'audio.ogg' });
  });

  // `POST /api/v2/messages/send/media` with a `base64` puts the bytes on the
  // METADATA, not on the content — that is the path a curl takes.
  it('takes the bytes the API hands on the metadata', async () => {
    await boot();
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'document', mimeType: 'application/pdf', filename: 'guia.pdf' } as never,
      metadata: { base64: Buffer.from('%PDF-1.4').toString('base64') },
    });

    expect(of('/mensagem')[0]?.body).toMatchObject({
      nome_arquivo: 'guia.pdf',
      mime_type: 'application/pdf',
      base64_arquivo: Buffer.from('%PDF-1.4').toString('base64'),
    });
  });

  it('takes a voice note buffer as-is', async () => {
    await boot();
    await plugin.sendMessage(instanceId, {
      to: '42',
      content: { type: 'audio', mimeType: 'audio/ogg' } as never,
      metadata: { audioBuffer: Buffer.from('OggS'), ptt: true },
    });

    expect(of('/mensagem')[0]?.body.base64_arquivo).toBe(Buffer.from('OggS').toString('base64'));
  });

  it('encodes emoji and converts markdown in the caption', async () => {
    await boot();
    const path = fileWith('x.png', Buffer.from('png'));
    await send({ type: 'image', localPath: path, mimeType: 'image/png', caption: '✅ **pronto**' });

    expect(of('/mensagem')[0]?.body.mensagem).toBe('##2705## *pronto*');
  });

  it('degrades to text — without failing the turn — when the file cannot be read', async () => {
    await boot();
    const result = await send({ type: 'image', localPath: join(dir, 'nao-existe.jpg'), caption: 'segue a imagem' });

    expect(result.success).toBe(true);
    expect(of('/mensagem')).toHaveLength(0);
    expect(ready('42')).toMatchObject({ pronto: 1, resposta: 'segue a imagem' });
  });

  it('degrades when the platform refuses the media call', async () => {
    await boot({ '/mensagem': () => jsonResponse({ cod_error: 10, msg: 'Atendimento já finalizado!' }, 401) });
    const path = fileWith('y.jpg', Buffer.from('jpg'));

    const result = await send({ type: 'image', localPath: path, mimeType: 'image/jpeg' });

    // A business 401 must not be retried (it would duplicate the bubble).
    expect(of('/mensagem')).toHaveLength(1);
    expect(result.success).toBe(true);
    expect(ready('42')?.resposta).toBe('[não foi possível enviar o arquivo]');
  });
});

describe('outbound location and contact', () => {
  it('maps a location onto localizacao', async () => {
    await boot();
    await send({
      type: 'location',
      location: { latitude: -23.55052, longitude: -46.633308, name: 'Praça da Sé', address: 'São Paulo - SP' },
    });

    expect(of('/mensagem')[0]?.body.localizacao).toEqual({
      latitude: '-23.55052',
      longitude: '-46.633308',
      endereco: 'Praça da Sé - São Paulo - SP',
    });
  });

  it('maps a contact onto cartao_contato', async () => {
    await boot();
    await send({ type: 'contact', contact: { name: 'João da Silva', phone: '5510999999999' } });

    expect(of('/mensagem')[0]?.body.cartao_contato).toEqual({ nome: 'João da Silva', telefone: '5510999999999' });
  });

  it('degrades a location with no usable coordinates', async () => {
    await boot();
    const result = await send({ type: 'location', text: 'endereço da clínica' });

    expect(result.success).toBe(true);
    expect(of('/mensagem')).toHaveLength(0);
    expect(ready('42')?.resposta).toBe('endereço da clínica');
  });
});

describe('outbound interactive through /mensagem', () => {
  const options = (n: number) => Array.from({ length: n }, (_, i) => ({ text: `Opção ${i + 1}` }));

  it('sends up to 3 options as buttons', async () => {
    await boot();
    await send({ type: 'text', text: 'Escolha:', buttons: options(3) });

    expect(of('/mensagem')[0]?.body).toMatchObject({
      mensagem: 'Escolha:',
      forcar_botoes: true,
      ura_opcoes: { '1': 'Opção 1', '2': 'Opção 2', '3': 'Opção 3' },
    });
    expect(ready('42')).toMatchObject({ resposta: '', forcar_botoes: true });
  });

  it('sends 4-10 options as a list', async () => {
    await boot();
    await send({ type: 'text', text: 'Escolha:', buttons: options(5) });

    expect(of('/mensagem')[0]?.body).toMatchObject({ forcar_botoes: false });
    expect(Object.keys(of('/mensagem')[0]?.body.ura_opcoes as object)).toHaveLength(5);
  });

  it('degrades past 10 options to the numbered text in resposta', async () => {
    await boot();
    await send({ type: 'text', text: 'Escolha:\n1. a\n2. b', buttons: options(11) });

    expect(of('/mensagem')).toHaveLength(0);
    const body = ready('42');
    expect(body).toMatchObject({ resposta: 'Escolha:\n1. a\n2. b' });
    expect(body?.ura_opcoes).toBeUndefined();
  });

  it('keeps the numbered text in resposta when the tenant opts out', async () => {
    await boot({}, { ascFlowInteractiveViaMensagem: false });
    await send({ type: 'text', text: 'Escolha:', buttons: options(2) });

    expect(of('/mensagem')).toHaveLength(0);
    expect(ready('42')).toMatchObject({ resposta: 'Escolha:', forcar_botoes: true });
  });

  it('quotes a platform message id when the caller supplies one', async () => {
    await boot();
    await send({ type: 'text', text: 'Escolha:', buttons: options(2) }, { replyTo: '9911' });

    expect(of('/mensagem')[0]?.body.id_mensagem_resposta).toBe(9911);
  });

  it('ignores an Omni UUID as a reply target', async () => {
    await boot();
    await send({ type: 'text', text: 'Escolha:', buttons: options(2) }, { replyTo: crypto.randomUUID() });

    expect(of('/mensagem')[0]?.body.id_mensagem_resposta).toBeUndefined();
  });
});

describe('the plain text turn is untouched', () => {
  it('still pushes leading bubbles and answers with the last one', async () => {
    await boot();
    await send({ type: 'text', text: 'um\n\ndois' });

    expect(of('/mensagem')).toHaveLength(0);
    expect(of('/callbackFlowMsg').map((c) => c.body.msg_usuario)).toEqual(['um']);
    expect(ready('42')).toMatchObject({ resposta: 'dois', bolhas: ['um', 'dois'] });
  });
});

process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
