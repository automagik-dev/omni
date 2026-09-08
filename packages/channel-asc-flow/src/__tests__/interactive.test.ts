/**
 * URA mapping and bubble splitting.
 *
 * The limits asserted here are META's, not the ASC platform's: the platform is
 * a BSP on top of Meta, so its own limits can never be looser. Degradation
 * (returning null) always means "send the numbered text instead" — the
 * canonical path, never removed.
 */

import { describe, expect, it } from 'bun:test';

import type { InteractiveButton } from '@omni/channel-sdk';

import { encodeAscEmoji, nonLatin1Left } from '../utils/emoji';
import { buildInteractive, foldTitle, splitBubbles } from '../utils/interactive';

const options = (n: number, label = (i: number) => `Opção ${i}`): InteractiveButton[] =>
  Array.from({ length: n }, (_, i) => ({ text: label(i + 1), data: String(i + 1) }));

describe('splitBubbles', () => {
  it('splits on blank lines and drops the empties', () => {
    expect(splitBubbles('a\n\nb\n\n\nc')).toEqual(['a', 'b', 'c']);
  });

  it('keeps single-newline text in one bubble', () => {
    expect(splitBubbles('linha 1\nlinha 2')).toEqual(['linha 1\nlinha 2']);
  });

  it('returns nothing for blank text', () => {
    expect(splitBubbles('   \n\n  ')).toEqual([]);
  });
});

describe('foldTitle', () => {
  it('folds accents, case and repeated spaces', () => {
    expect(foldTitle('Consulta  às 08H30')).toBe(foldTitle('consulta as 08h30'));
  });
});

describe('buildInteractive', () => {
  const params = (...args: Parameters<typeof buildInteractive>) =>
    buildInteractive(...args) as Record<string, unknown> | null;
  const rows = (p: Record<string, unknown> | null) =>
    (p?.list as { secao?: Array<{ linhas?: Array<{ texto: string; descricao: string }> }> } | undefined)?.secao?.[0]
      ?.linhas ?? [];

  it('renders 3 or fewer options as reply buttons', () => {
    expect(params('Escolha:', options(3))).toEqual({
      tipo: 2,
      mensagem: 'Escolha:',
      button: ['Opção 1', 'Opção 2', 'Opção 3'],
    });
  });

  it('renders 4 options as a list', () => {
    const p = params('Escolha:', options(4));
    expect(p?.tipo).toBe(1);
    expect(rows(p)).toHaveLength(4);
  });

  it('carries the description under each row — the reason this endpoint exists', () => {
    // The URA fields on `/mensagem` are a flat `{ordinal: label}` map, so the
    // clinic never reached the handset: the beneficiary read four clinics by
    // name and got a menu of bare times (06/09).
    const p = params('Escolha:', [
      { text: 'amanhã 07/09 · 08:00', description: 'Teleconsulta · Dr. Francisco' },
      { text: 'amanhã 07/09 · 19:00', description: 'HAP Conjunto Ceará · Dra. Renata' },
      ...options(2),
    ]);

    expect(rows(p)[0]).toEqual({ texto: 'amanhã 07/09 · 08:00', descricao: 'Teleconsulta · Dr. Francisco' });
    // A row with no description of its own is a row, not a failure.
    expect(rows(p)[2]?.descricao).toBe('');
  });

  it('honours the section title and the list button label', () => {
    const p = params('Escolha:', options(4), { sectionTitle: 'Horários' });
    const secao = (p?.list as { secao: Array<{ texto: string }>; texto_botao: string }).secao[0];
    expect(secao?.texto).toBe('Horários');
    expect((p?.list as { texto_botao: string }).texto_botao).toBeTruthy();
  });

  it('renders a list when the caller asks for one with few options', () => {
    // Unlike the URA it replaces, a list DOES render here — so `forceList` is
    // honoured rather than overridden.
    expect(params('Escolha:', options(2), { forceList: true })?.tipo).toBe(1);
  });

  it('accepts exactly 10 options', () => {
    expect(rows(params('Escolha:', options(10)))).toHaveLength(10);
  });

  it('degrades above 10 options — Meta truncates the overflow silently', () => {
    expect(params('Escolha:', options(11))).toBeNull();
  });

  it('degrades when the body exceeds 1024 characters', () => {
    expect(params('x'.repeat(1025), options(3))).toBeNull();
    expect(params('x'.repeat(1024), options(3))).not.toBeNull();
  });

  it('truncates row titles at 24', () => {
    const long = 'Cardiologia com Dr. Fulano de Tal na unidade central';
    const p = params('Escolha:', [{ text: long }, { text: 'b' }, { text: 'c' }, { text: 'd' }]);
    expect(rows(p)[0]?.texto.length).toBeLessThanOrEqual(24);
  });

  it('degrades when titles collide after truncation', () => {
    // The tap comes back as the row TEXT — an ambiguous pair would book the
    // wrong appointment.
    expect(
      params('Escolha:', [{ text: 'Consulta segunda 13/07 às 08h30' }, { text: 'consulta segunda 13/07 as 08h45' }]),
    ).toBeNull();
  });

  it('degrades with no options, no body, or only URL buttons', () => {
    expect(params('Escolha:', [])).toBeNull();
    expect(params('Escolha:', undefined)).toBeNull();
    expect(params('   ', options(3))).toBeNull();
    expect(params('Escolha:', [{ text: 'Abrir', url: 'https://example.test' }])).toBeNull();
  });
});

// A plataforma é latin-1 — provado em 05/09 mandando uma mensagem e lendo de
// volta em `/atendimento`: tudo que ISO-8859-1 guarda sobrevive, o resto vira
// `?`. Os travessões do agente chegaram assim num beneficiário real
// (atendimento 22342782): "Clínico Geral ? inclusive por teleconsulta ?".
describe('o que a plataforma latin-1 não carrega', () => {
  it('transliteral a pontuação que viraria "?"', () => {
    expect(encodeAscEmoji('Clínico Geral — inclusive por teleconsulta — e trazer')).toBe(
      'Clínico Geral - inclusive por teleconsulta - e trazer',
    );
    expect(encodeAscEmoji('aguarde… “assim” e ‘assim’ → fim')).toBe('aguarde... "assim" e \'assim\' -> fim');
  });

  it('não toca no português acentuado, que a plataforma carrega', () => {
    const texto = 'Sua sessão foi encerrada às 14h30 — coração, ação, ônibus';
    expect(encodeAscEmoji(texto)).toBe('Sua sessão foi encerrada às 14h30 - coração, ação, ônibus');
  });

  it('emoji continua virando marcador, não transliteração', () => {
    expect(encodeAscEmoji('✅ pronto — vamos')).toBe('##2705## pronto - vamos');
  });

  it('denuncia o que sobrou fora do latin-1', () => {
    expect(nonLatin1Left('tudo certo')).toEqual([]);
    expect(nonLatin1Left('café')).toEqual([]);
    expect(nonLatin1Left('≥ 5 e ≥ 6')).toEqual(['≥']);
  });
});
