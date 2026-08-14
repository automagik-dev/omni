/**
 * Tests for extractContent — ensures proto media URLs are hoisted into
 * ExtractedContent.mediaUrl so they reach messages.media_url at persist time
 * even when ingest-time blob download fails.
 *
 * Regression guard for omni#500 Bug 1.
 */

import { describe, expect, it } from 'bun:test';
import type { WAMessage } from 'baileys';
import { extractContent } from '../handlers/messages';

function wrap(message: Record<string, unknown>): WAMessage {
  return {
    key: { id: 'TEST', remoteJid: '5511999998888@s.whatsapp.net', fromMe: false },
    message,
  } as unknown as WAMessage;
}

describe('extractContent — mediaUrl hoist (omni#500)', () => {
  it('hoists imageMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        imageMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7118-24/img.enc?oe=1',
          mimetype: 'image/jpeg',
          caption: 'hello',
        },
      }),
    );
    expect(content?.type).toBe('image');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7118-24/img.enc?oe=1');
    expect(content?.mimeType).toBe('image/jpeg');
  });

  it('hoists audioMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        audioMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7117-24/audio.enc?oe=2',
          mimetype: 'audio/ogg; codecs=opus',
        },
      }),
    );
    expect(content?.type).toBe('audio');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7117-24/audio.enc?oe=2');
  });

  it('hoists videoMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        videoMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7161-24/video.enc?oe=3',
          mimetype: 'video/mp4',
        },
      }),
    );
    expect(content?.type).toBe('video');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7161-24/video.enc?oe=3');
  });

  it('hoists documentMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        documentMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.7119-24/doc.enc?oe=4',
          mimetype: 'application/pdf',
          fileName: 'contract.pdf',
        },
      }),
    );
    expect(content?.type).toBe('document');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7119-24/doc.enc?oe=4');
    expect(content?.filename).toBe('contract.pdf');
  });

  it('unwraps documentWithCaptionMessage into document content', () => {
    const content = extractContent(
      wrap({
        documentWithCaptionMessage: {
          message: {
            documentMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7119-24/doc-caption.enc?oe=6',
              mimetype: 'application/pdf',
              fileName: 'proposal.pdf',
              caption: 'segue proposta',
            },
          },
        },
      }),
    );
    expect(content?.type).toBe('document');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7119-24/doc-caption.enc?oe=6');
    expect(content?.filename).toBe('proposal.pdf');
    expect(content?.caption).toBe('segue proposta');
    expect(content?.mimeType).toBe('application/pdf');
  });

  it('hoists stickerMessage.url into mediaUrl', () => {
    const content = extractContent(
      wrap({
        stickerMessage: {
          url: 'https://mmg.whatsapp.net/v/t62.15575-24/sticker.enc?oe=5',
          mimetype: 'image/webp',
        },
      }),
    );
    expect(content?.type).toBe('sticker');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.15575-24/sticker.enc?oe=5');
  });

  it('leaves mediaUrl undefined when proto url is missing', () => {
    const content = extractContent(wrap({ audioMessage: { mimetype: 'audio/ogg' } }));
    expect(content?.type).toBe('audio');
    expect(content?.mediaUrl).toBeUndefined();
  });
});

/**
 * Bot-sent interactive messages (issue #902): list menus, quick-reply buttons,
 * and the modern nativeFlow / template variants must flatten to a readable text
 * transcript instead of falling through to `"Unknown message type: …"`.
 */
describe('extractContent — bot-interactive messages (omni#902)', () => {
  it('flattens listMessage (title + description + rows) to text', () => {
    const content = extractContent(
      wrap({
        listMessage: {
          title: 'Menu principal',
          description: 'Escolha uma opção',
          buttonText: 'Ver opções',
          sections: [
            {
              title: 'Atendimento',
              rows: [
                { title: 'Falar com humano', rowId: 'r1' },
                { title: 'Suporte', rowId: 'r2' },
              ],
            },
            { title: 'Financeiro', rows: [{ title: '2ª via de boleto', rowId: 'r3' }] },
          ],
          footerText: 'Sinapse',
        },
      }),
    );
    expect(content?.type).toBe('text');
    expect(content?.text).toBe(
      'Menu principal\nEscolha uma opção\n• Falar com humano\n• Suporte\n• 2ª via de boleto\nSinapse',
    );
  });

  it('flattens buttonsMessage (contentText + button labels) to text', () => {
    const content = extractContent(
      wrap({
        buttonsMessage: {
          contentText: 'Deseja continuar?',
          footerText: 'Bot',
          buttons: [
            { buttonId: 'b1', buttonText: { displayText: 'Sim' } },
            { buttonId: 'b2', buttonText: { displayText: 'Não' } },
          ],
        },
      }),
    );
    expect(content?.type).toBe('text');
    expect(content?.text).toBe('Deseja continuar?\nBot\n[Sim] [Não]');
  });

  it('flattens modern interactiveMessage (nativeFlow) to text', () => {
    const content = extractContent(
      wrap({
        interactiveMessage: {
          header: { title: 'Confirmação' },
          body: { text: 'Confirma o agendamento?' },
          footer: { text: 'Clínica' },
          nativeFlowMessage: {
            buttons: [
              { name: 'single_select', buttonParamsJson: '{}' },
              { name: 'cta_url', buttonParamsJson: '{}' },
            ],
          },
        },
      }),
    );
    expect(content?.type).toBe('text');
    expect(content?.text).toBe('Confirmação\nConfirma o agendamento?\nClínica\n[single_select] [cta_url]');
  });

  it('flattens hydrated templateMessage (title/content + hydrated buttons) to text', () => {
    const content = extractContent(
      wrap({
        templateMessage: {
          hydratedTemplate: {
            hydratedTitleText: 'Sua fatura',
            hydratedContentText: 'Fatura de agosto disponível',
            hydratedFooterText: 'Financeiro',
            hydratedButtons: [
              { index: 0, quickReplyButton: { displayText: 'Pagar agora', id: 'q1' } },
              { index: 1, urlButton: { displayText: 'Ver online', url: 'https://x' } },
            ],
          },
        },
      }),
    );
    expect(content?.type).toBe('text');
    expect(content?.text).toBe('Sua fatura\nFatura de agosto disponível\nFinanceiro\n[Pagar agora] [Ver online]');
  });

  it('no longer falls through to "Unknown message type" for listMessage', () => {
    const content = extractContent(wrap({ listMessage: { title: 'X', sections: [] } }));
    expect(content?.type).toBe('text');
    expect(content?.text).not.toContain('Unknown message type');
  });

  it('re-extracts an interactive message nested inside a deviceSentMessage wrapper', () => {
    const content = extractContent(
      wrap({
        deviceSentMessage: {
          destinationJid: '5511999998888@s.whatsapp.net',
          message: {
            buttonsMessage: { contentText: 'Oi', buttons: [{ buttonId: 'b1', buttonText: { displayText: 'Ok' } }] },
          },
        },
      }),
    );
    expect(content?.type).toBe('text');
    expect(content?.text).toBe('Oi\n[Ok]');
  });

  it('classifies a buttonsMessage with an image header as image + button transcript caption', () => {
    const content = extractContent(
      wrap({
        buttonsMessage: {
          contentText: 'Confira a oferta',
          imageMessage: {
            url: 'https://mmg.whatsapp.net/v/t62.7118-24/offer.enc?oe=9',
            mimetype: 'image/jpeg',
          },
          buttons: [{ buttonId: 'b1', buttonText: { displayText: 'Comprar' } }],
        },
      }),
    );
    expect(content?.type).toBe('image');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7118-24/offer.enc?oe=9');
    expect(content?.mimeType).toBe('image/jpeg');
    expect(content?.caption).toBe('Confira a oferta\n[Comprar]');
  });

  it('classifies an interactiveMessage with a document header as document + body caption', () => {
    const content = extractContent(
      wrap({
        interactiveMessage: {
          body: { text: 'Segue seu contrato' },
          header: {
            title: 'Contrato',
            documentMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7119-24/contract.enc?oe=10',
              mimetype: 'application/pdf',
              fileName: 'contrato.pdf',
            },
          },
          nativeFlowMessage: { buttons: [{ name: 'review_and_pay', buttonParamsJson: '{}' }] },
        },
      }),
    );
    expect(content?.type).toBe('document');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7119-24/contract.enc?oe=10');
    expect(content?.filename).toBe('contrato.pdf');
    expect(content?.mimeType).toBe('application/pdf');
    expect(content?.caption).toBe('Contrato\nSegue seu contrato\n[review_and_pay]');
  });

  it('classifies a hydrated templateMessage with a video header as video + transcript caption', () => {
    const content = extractContent(
      wrap({
        templateMessage: {
          hydratedTemplate: {
            hydratedContentText: 'Assista ao tutorial',
            videoMessage: {
              url: 'https://mmg.whatsapp.net/v/t62.7161-24/tutorial.enc?oe=11',
              mimetype: 'video/mp4',
            },
            hydratedButtons: [{ index: 0, quickReplyButton: { displayText: 'Entendi', id: 'q1' } }],
          },
        },
      }),
    );
    expect(content?.type).toBe('video');
    expect(content?.mediaUrl).toBe('https://mmg.whatsapp.net/v/t62.7161-24/tutorial.enc?oe=11');
    expect(content?.mimeType).toBe('video/mp4');
    expect(content?.caption).toBe('Assista ao tutorial\n[Entendi]');
  });

  it('keeps a buttonsMessage WITHOUT a media header as plain text', () => {
    const content = extractContent(
      wrap({
        buttonsMessage: { contentText: 'Sem mídia', buttons: [{ buttonId: 'b1', buttonText: { displayText: 'Ok' } }] },
      }),
    );
    expect(content?.type).toBe('text');
    expect(content?.mediaUrl).toBeUndefined();
    expect(content?.text).toBe('Sem mídia\n[Ok]');
  });
});
