/**
 * buildHandoffRouting — the `conversation` field a handoff message carries.
 */

import { describe, expect, it } from 'bun:test';

import { buildHandoffRouting } from '../utils/handoff';

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
