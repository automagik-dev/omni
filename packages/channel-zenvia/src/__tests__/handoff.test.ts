import { describe, expect, it } from 'bun:test';

import { buildHandoffNote, buildHandoffRouting, resolveHandoffMode } from '../utils/handoff';

describe('buildHandoffRouting', () => {
  it('routes to the configured solution with no properties when there is no context', () => {
    expect(buildHandoffRouting('zenvia_chat', { isHandoff: true })).toEqual({ solution: 'zenvia_chat' });
  });

  it('derives handoffReason and leadData from the route metadata', () => {
    expect(
      buildHandoffRouting('conversion', {
        isHandoff: true,
        motivoHandoff: '  wants a person ',
        dadosLead: { age: 30 },
      }),
    ).toEqual({ solution: 'conversion', properties: { handoffReason: 'wants a person', leadData: { age: 30 } } });
  });

  it('lets explicit handoffFields win over derived keys', () => {
    expect(
      buildHandoffRouting('conversion', {
        motivoHandoff: 'derived',
        handoffFields: { handoffReason: 'explicit', queue: 'sales' },
      }),
    ).toEqual({ solution: 'conversion', properties: { handoffReason: 'explicit', queue: 'sales' } });
  });

  it('ignores blank reasons, empty lead data and non-object fields', () => {
    expect(
      buildHandoffRouting('nlu', { motivoHandoff: '   ', dadosLead: '', handoffFields: ['not', 'an', 'object'] }),
    ).toEqual({ solution: 'nlu' });
  });
});

describe('resolveHandoffMode', () => {
  const base = { apiToken: 't', senderId: '5511' };

  it('transfers when the Sales key and the group are set, even with a solution', () => {
    expect(resolveHandoffMode({ ...base, salesApiKey: 'k', handoffGroupId: 'g', handoffSolution: 'nlu' })).toBe(
      'transfer',
    );
  });

  it('routes through the conversation field when only a solution is set', () => {
    expect(resolveHandoffMode({ ...base, handoffSolution: 'nlu' })).toBe('routing');
  });

  it('has no mode without a group or a solution', () => {
    expect(resolveHandoffMode({ ...base, salesApiKey: 'k' })).toBeNull();
    expect(resolveHandoffMode(base)).toBeNull();
  });

  it('transfers with a routing map and no default group, but only together with the Sales key', () => {
    const handoffRouting = { field: 'queue_field', groups: { 'queue-a': 'group-1' } };

    expect(resolveHandoffMode({ ...base, salesApiKey: 'k', handoffRouting })).toBe('transfer');
    expect(resolveHandoffMode({ ...base, handoffRouting })).toBeNull();
    expect(resolveHandoffMode({ ...base, handoffRouting, handoffSolution: 'nlu' })).toBe('routing');
  });
});

describe('buildHandoffNote', () => {
  it('is null when there is nothing to tell the agent', () => {
    expect(buildHandoffNote({ isHandoff: true, motivoHandoff: '  ', dadosLead: '', handoffFields: [] })).toBeNull();
  });

  it('writes the reason, the lead data and the fields, one per line', () => {
    expect(
      buildHandoffNote({
        motivoHandoff: ' wants a person ',
        dadosLead: { age: 30, plan: ['a', 'b'] },
        handoffFields: { queue: 'sales' },
      }),
    ).toBe('Motivo do handoff: wants a person\nDados do lead:\nage: 30\nplan: ["a","b"]\nqueue: sales');
  });

  it('keeps free text lead data as is', () => {
    expect(buildHandoffNote({ dadosLead: 'family account' })).toBe('Dados do lead:\nfamily account');
  });
});
