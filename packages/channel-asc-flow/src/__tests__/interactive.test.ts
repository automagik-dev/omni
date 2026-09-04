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

  it('honours forceList and sectionTitle by rendering a list', () => {
    expect(buildUra('Escolha:', options(2), { forceList: true })?.forcar_botoes).toBe(false);
    expect(buildUra('Escolha:', options(2), { sectionTitle: 'Horários' })?.forcar_botoes).toBe(false);
  });
});
