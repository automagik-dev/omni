import { describe, expect, test } from 'bun:test';
import { validateFlowJson } from '../whatsapp-flows';

/** The rich flow we drove live (INTRO with image → CADASTRO form) — must pass. */
const validStaticFlow = {
  version: '6.3',
  routing_model: { INTRO: ['CADASTRO'], CADASTRO: [] },
  screens: [
    {
      id: 'INTRO',
      title: 'Khal AI',
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'Image', src: 'aGVsbG8=', height: 240 },
          { type: 'TextHeading', text: 'Bem-vindo' },
          { type: 'TextBody', text: 'Demo' },
          {
            type: 'Footer',
            label: 'Começar',
            'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'CADASTRO' }, payload: {} },
          },
        ],
      },
    },
    {
      id: 'CADASTRO',
      title: 'Seus dados',
      terminal: true,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          {
            type: 'Form',
            name: 'form',
            children: [
              { type: 'TextInput', name: 'nome', label: 'Nome', 'input-type': 'text', required: true },
              {
                type: 'Dropdown',
                name: 'canal',
                label: 'Canal',
                'data-source': [{ id: 'wa', title: 'WhatsApp' }],
              },
              {
                type: 'Footer',
                label: 'Enviar',
                'on-click-action': { name: 'complete', payload: { nome: '${form.nome}' } },
              },
            ],
          },
        ],
      },
    },
  ],
};

describe('validateFlowJson', () => {
  test('accepts the live-tested rich static flow (object and string forms)', () => {
    expect(validateFlowJson(validStaticFlow).valid).toBe(true);
    expect(validateFlowJson(JSON.stringify(validStaticFlow)).valid).toBe(true);
  });

  test('rejects data_api_version on a non-dynamic flow (the live "an error occurred" bug)', () => {
    const result = validateFlowJson({ ...validStaticFlow, data_api_version: '3.0' });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === 'data_api_version')).toBe(true);
  });

  test('requires data_api_version when dynamic: true', () => {
    const result = validateFlowJson(validStaticFlow, { dynamic: true });
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === 'data_api_version')).toBe(true);

    expect(validateFlowJson({ ...validStaticFlow, data_api_version: '3.0' }, { dynamic: true }).valid).toBe(true);
  });

  test('rejects RichText.text as array (Meta v6.3 INVALID_PROPERTY_TYPE)', () => {
    const doc = structuredClone(validStaticFlow) as Record<string, unknown>;
    (doc.screens as Array<{ layout: { children: unknown[] } }>)[0]!.layout.children = [
      { type: 'RichText', text: ['**bold**', 'line 2'] },
    ];
    expect(validateFlowJson(doc).valid).toBe(false);
  });

  test('rejects RichText sharing a screen with non-Footer components', () => {
    const doc = structuredClone(validStaticFlow) as Record<string, unknown>;
    (doc.screens as Array<{ layout: { children: unknown[] } }>)[0]!.layout.children = [
      { type: 'RichText', text: '**ok**' },
      { type: 'TextBody', text: 'not allowed next to RichText' },
    ];
    const result = validateFlowJson(doc);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('RichText'))).toBe(true);
  });

  test('allows RichText alone or with only a Footer', () => {
    const doc = structuredClone(validStaticFlow) as Record<string, unknown>;
    (doc.screens as Array<{ layout: { children: unknown[] } }>)[0]!.layout.children = [
      { type: 'RichText', text: '**ok**' },
      {
        type: 'Footer',
        label: 'Ir',
        'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'CADASTRO' }, payload: {} },
      },
    ];
    expect(validateFlowJson(doc).valid).toBe(true);
  });

  test('rejects navigate to an undeclared screen and routing_model drift', () => {
    const badNavigate = structuredClone(validStaticFlow) as Record<string, unknown>;
    const introChildren = (badNavigate.screens as Array<{ layout: { children: Array<Record<string, unknown>> } }>)[0]!
      .layout.children;
    (introChildren[3]!['on-click-action'] as { next: { name: string } }).next.name = 'NOPE';
    expect(validateFlowJson(badNavigate).valid).toBe(false);

    const badRouting = { ...validStaticFlow, routing_model: { INTRO: ['GHOST'] } };
    expect(validateFlowJson(badRouting).valid).toBe(false);
  });

  test('requires at least one terminal screen and unique screen ids', () => {
    const noTerminal = structuredClone(validStaticFlow) as { screens: Array<{ terminal?: boolean }> };
    for (const screen of noTerminal.screens) screen.terminal = undefined;
    expect(validateFlowJson(noTerminal).valid).toBe(false);

    const duplicated = structuredClone(validStaticFlow) as { screens: Array<{ id: string }> };
    duplicated.screens[1]!.id = 'INTRO';
    expect(validateFlowJson(duplicated).valid).toBe(false);
  });

  test('rejects non-JSON strings with a clear issue', () => {
    const result = validateFlowJson('{not json');
    expect(result.valid).toBe(false);
    expect(result.issues[0]?.message).toContain('not valid JSON');
  });
});
