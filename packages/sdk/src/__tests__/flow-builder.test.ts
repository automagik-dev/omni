import { describe, expect, test } from 'bun:test';
import { FlowBuilderError, flow } from '../flow-builder';

function richTwoScreenFlow() {
  return flow({ version: '6.3' })
    .screen('INTRO', { title: 'Khal AI' }, (s) => {
      s.image('aGVsbG8=', { height: 240, scaleType: 'cover', altText: 'Banner' });
      s.heading('Bem-vindo ✨');
      s.body('Demo de flow.');
      s.footerNavigate('Começar', 'CADASTRO');
    })
    .screen('CADASTRO', { title: 'Seus dados', terminal: true }, (s) => {
      s.form('form', (f) => {
        f.textInput('nome', 'Nome completo', { required: true });
        f.textInput('email', 'E-mail', { inputType: 'email', required: true });
        f.radioButtons('plano', 'Plano', [
          { id: 'free', title: 'Free' },
          { id: 'pro', title: 'Pro' },
        ]);
        f.checkboxGroup('interesses', 'Interesses', [
          { id: 'wa', title: 'WhatsApp' },
          { id: 'tg', title: 'Telegram' },
        ]);
        f.dropdown('origem', 'Origem', [{ id: 'social', title: 'Redes sociais' }]);
        f.datePicker('nascimento', 'Nascimento');
        f.optIn('aceite', 'Aceito contato', { required: true });
        f.footerComplete('Enviar', { nome: '${form.nome}', email: '${form.email}' });
      });
    });
}

describe('flow builder', () => {
  test('builds the rich two-screen flow with derived routing_model', () => {
    const { json, flowJson } = richTwoScreenFlow().build();
    expect(JSON.parse(flowJson)).toEqual(json);
    expect(json.version).toBe('6.3');
    expect(json.data_api_version).toBeUndefined();
    expect(json.routing_model).toEqual({ INTRO: ['CADASTRO'], CADASTRO: [] });

    const screens = json.screens as Array<{ id: string; terminal?: boolean; layout: { children: unknown[] } }>;
    expect(screens.map((s) => s.id)).toEqual(['INTRO', 'CADASTRO']);
    expect(screens[1]!.terminal).toBe(true);
  });

  test('dynamic flows emit data_api_version 3.0', () => {
    const { json } = flow({ dynamic: true })
      .screen('ONLY', { terminal: true }, (s) => s.footerDataExchange('Enviar'))
      .build();
    expect(json.data_api_version).toBe('3.0');
  });

  test('rejects navigate to unknown screen at build time', () => {
    const builder = flow().screen('A', { terminal: true }, (s) => s.footerNavigate('Go', 'MISSING'));
    expect(() => builder.build()).toThrow(FlowBuilderError);
  });

  test('rejects flows without a terminal screen', () => {
    const builder = flow().screen('A', (s) => s.body('hi'));
    expect(() => builder.build()).toThrow(/terminal/);
  });

  test('rejects RichText next to non-Footer components', () => {
    const builder = flow().screen('A', { terminal: true }, (s) => {
      s.richText('**hi**');
      s.body('not allowed');
    });
    expect(() => builder.build()).toThrow(/RichText/);
  });

  test('rejects duplicate screen ids and double Footers in a form', () => {
    expect(() =>
      flow()
        .screen('A', { terminal: true }, (s) => s.body('1'))
        .screen('A', (s) => s.body('2')),
    ).toThrow(/duplicate/);

    expect(() =>
      flow().screen('A', { terminal: true }, (s) =>
        s.form('f', (f) => {
          f.footerComplete('One', {});
          f.footerComplete('Two', {});
        }),
      ),
    ).toThrow(/one Footer/);
  });
});
