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
import { buildUra, foldTitle, splitBubbles } from '../utils/interactive';

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

describe('buildUra', () => {
  it('renders 3 or fewer options as buttons', () => {
    expect(buildUra('Escolha:', options(3))).toEqual({
      ura_opcoes: { '1': 'Opção 1', '2': 'Opção 2', '3': 'Opção 3' },
      forcar_botoes: true,
    });
  });

  it('renders 4 options as a list', () => {
    const ura = buildUra('Escolha:', options(4));
    expect(ura?.forcar_botoes).toBe(false);
    expect(Object.keys(ura?.ura_opcoes ?? {})).toHaveLength(4);
  });

  it('accepts exactly 10 options', () => {
    expect(Object.keys(buildUra('Escolha:', options(10))?.ura_opcoes ?? {})).toHaveLength(10);
  });

  it('degrades above 10 options — Meta truncates the overflow silently', () => {
    expect(buildUra('Escolha:', options(11))).toBeNull();
  });

  it('degrades when the body exceeds 1024 characters', () => {
    expect(buildUra('x'.repeat(1025), options(3))).toBeNull();
    expect(buildUra('x'.repeat(1024), options(3))).not.toBeNull();
  });

  it('truncates button labels at 20 and list titles at 24', () => {
    const long = 'Cardiologia com Dr. Fulano de Tal na unidade central';
    const asButtons = buildUra('Escolha:', [{ text: long }, { text: 'b' }]);
    expect((asButtons?.ura_opcoes['1'] ?? '').length).toBeLessThanOrEqual(20);

    const asList = buildUra('Escolha:', [{ text: long }, { text: 'b' }, { text: 'c' }, { text: 'd' }]);
    expect((asList?.ura_opcoes['1'] ?? '').length).toBeLessThanOrEqual(24);
    expect((asList?.ura_opcoes['1'] ?? '').length).toBeGreaterThan(20);
  });

  it('degrades when titles collide after truncation', () => {
    // The tap comes back as the TITLE — an ambiguous pair would book the
    // wrong appointment.
    expect(
      buildUra('Escolha:', [{ text: 'Consulta segunda 13/07 às 08h30' }, { text: 'consulta segunda 13/07 as 08h45' }]),
    ).toBeNull();
  });

  it('degrades with no options, no body, or only URL buttons', () => {
    expect(buildUra('Escolha:', [])).toBeNull();
    expect(buildUra('Escolha:', undefined)).toBeNull();
    expect(buildUra('   ', options(3))).toBeNull();
    expect(buildUra('Escolha:', [{ text: 'Abrir', url: 'https://example.test' }])).toBeNull();
  });

  // A list does not exist on this platform. Measured on the handset 05/09: the
  // ASC flattens `forcar_botoes: false` into plain text and appends a numbered
  // menu of its own, so asking for a list buys the duplicated menu and loses
  // the taps. Up to three options the answer is always buttons — `forceList`
  // and `sectionTitle` are honoured only where buttons cannot go.
  it('takes buttons over a requested list while the options still fit', () => {
    expect(buildUra('Escolha:', options(2), { forceList: true })?.forcar_botoes).toBe(true);
    expect(buildUra('Escolha:', options(2), { sectionTitle: 'Horários' })?.forcar_botoes).toBe(true);
  });

  it('still answers with a list past three options', () => {
    expect(buildUra('Escolha:', options(5))?.forcar_botoes).toBe(false);
  });

  // The real case (05/09): two beneficiaries, and the turn went out as a list
  // because the caller asked for one — so the handset got the duplicated text
  // menu. Converting it to buttons is what shortens the titles, and it cuts on
  // a word boundary rather than mid-word.
  it('shortens a long title on a word boundary when converting to buttons', () => {
    const ura = buildUra(
      'Para quem é a consulta?',
      [{ text: 'ROGERIO AMARO RODRIGUES' }, { text: 'ANELI CAMILO AMARO' }],
      { forceList: true },
    );

    expect(ura).toMatchObject({
      forcar_botoes: true,
      ura_opcoes: { '1': 'ROGERIO AMARO', '2': 'ANELI CAMILO AMARO' },
    });
  });

  // Shortening is what can CREATE the ambiguity, and the tap comes back as the
  // title — two options that fold together would book the wrong person.
  it('refuses buttons when shortening makes two titles collide', () => {
    expect(
      buildUra('Escolha:', [{ text: 'Consulta cardiologia manhã' }, { text: 'Consulta cardiologia tarde' }], {
        forceList: true,
      }),
    ).toBeNull();
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
