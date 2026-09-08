/**
 * Gupshup handoff options — unit tests
 *
 * Covers the three pure helpers: schema parsing, routing-default resolution
 * and the customerFields template. The wire shape is asserted in
 * client.test.ts; the plugin integration in plugin.test.ts.
 */

import { describe, expect, it } from 'bun:test';
import { buildCustomerFields, parseHandoffOptions, resolveHandoffFields } from '../handoff-options';

const options = parseHandoffOptions({
  defaultFields: { queue: 'DEFAULT' },
  fieldsByPhonePrefix: [
    { prefixes: ['5511', '5521'], fields: { queue: 'SOUTHEAST' } },
    { prefixes: ['55'], fields: { queue: 'BRAZIL' } },
  ],
  customerFields: [
    { apiKey: 'Queue', from: 'queue' },
    { apiKey: 'Source', value: 'assistant' },
    { apiKey: 'Full Name', from: 'name' },
  ],
});

describe('parseHandoffOptions', () => {
  it('returns undefined when nothing is configured', () => {
    expect(parseHandoffOptions(undefined)).toBeUndefined();
    expect(parseHandoffOptions(null)).toBeUndefined();
  });

  it('accepts an empty object', () => {
    expect(parseHandoffOptions({})).toEqual({});
  });

  it('rejects unknown keys', () => {
    expect(() => parseHandoffOptions({ defaultFields: {}, typo: true })).toThrow();
  });

  it('rejects a customerFields entry with neither value nor from', () => {
    expect(() => parseHandoffOptions({ customerFields: [{ apiKey: 'X' }] })).toThrow(/exactly one/);
  });

  it('rejects a customerFields entry with both value and from', () => {
    expect(() => parseHandoffOptions({ customerFields: [{ apiKey: 'X', value: 'a', from: 'b' }] })).toThrow(
      /exactly one/,
    );
  });

  it('rejects non-digit prefixes', () => {
    expect(() => parseHandoffOptions({ fieldsByPhonePrefix: [{ prefixes: ['+55'], fields: { queue: 'x' } }] })).toThrow(
      /digits only/,
    );
  });

  it('rejects a rule with no prefixes', () => {
    expect(() => parseHandoffOptions({ fieldsByPhonePrefix: [{ prefixes: [], fields: { queue: 'x' } }] })).toThrow();
  });
});

describe('resolveHandoffFields', () => {
  it('returns explicit fields untouched when no options are configured', () => {
    const explicit = { queue: 'FROM_AGENT' };
    expect(resolveHandoffFields('5511999990000', explicit, undefined)).toBe(explicit);
    expect(resolveHandoffFields('5511999990000', undefined, undefined)).toBeUndefined();
  });

  it('fills defaults when the emitter sent nothing', () => {
    expect(resolveHandoffFields('4915112345678', undefined, options)).toEqual({ queue: 'DEFAULT' });
  });

  it('applies the first matching prefix rule over the defaults', () => {
    expect(resolveHandoffFields('5511999990000', undefined, options)).toEqual({ queue: 'SOUTHEAST' });
    expect(resolveHandoffFields('5585999990000', undefined, options)).toEqual({ queue: 'BRAZIL' });
  });

  it('strips formatting before matching prefixes', () => {
    expect(resolveHandoffFields('+55 (21) 99999-0000', undefined, options)).toEqual({ queue: 'SOUTHEAST' });
  });

  it('never overrides a field the emitter provided', () => {
    expect(resolveHandoffFields('5511999990000', { queue: 'FROM_AGENT' }, options)).toEqual({
      queue: 'FROM_AGENT',
    });
  });

  it('treats an empty or sentinel value from the emitter as not sent', () => {
    expect(resolveHandoffFields('5511999990000', { queue: '' }, options)).toEqual({ queue: 'SOUTHEAST' });
    expect(resolveHandoffFields('5511999990000', { queue: 'undefined' }, options)).toEqual({ queue: 'SOUTHEAST' });
    expect(resolveHandoffFields('5511999990000', { queue: 'null' }, options)).toEqual({ queue: 'SOUTHEAST' });
  });

  it('keeps unrelated explicit fields alongside the defaults', () => {
    expect(resolveHandoffFields('5511999990000', { name: 'Ana' }, options)).toEqual({
      name: 'Ana',
      queue: 'SOUTHEAST',
    });
  });

  it('returns explicit fields as-is when options carry no routing defaults', () => {
    const onlyTemplate = parseHandoffOptions({ customerFields: [{ apiKey: 'A', value: 'b' }] });
    const explicit = { name: 'Ana' };
    expect(resolveHandoffFields('5511999990000', explicit, onlyTemplate)).toBe(explicit);
  });
});

describe('buildCustomerFields', () => {
  it('returns undefined without a template', () => {
    expect(buildCustomerFields({ queue: 'X' }, undefined)).toBeUndefined();
    expect(buildCustomerFields({ queue: 'X' }, [])).toBeUndefined();
  });

  it('renders literals and references in template order', () => {
    expect(buildCustomerFields({ queue: 'SOUTHEAST', name: 'Ana' }, options?.customerFields)).toEqual([
      { apiKey: 'Queue', value: 'SOUTHEAST' },
      { apiKey: 'Source', value: 'assistant' },
      { apiKey: 'Full Name', value: 'Ana' },
    ]);
  });

  it('skips entries whose reference is missing or empty', () => {
    expect(buildCustomerFields({ queue: 'SOUTHEAST' }, options?.customerFields)).toEqual([
      { apiKey: 'Queue', value: 'SOUTHEAST' },
      { apiKey: 'Source', value: 'assistant' },
    ]);
  });

  it('drops sentinel strings instead of forwarding them', () => {
    const rendered = buildCustomerFields({ queue: 'SOUTHEAST', name: 'undefined' }, options?.customerFields);
    expect(rendered?.map((f) => f.apiKey)).toEqual(['Queue', 'Source']);
  });

  it('returns undefined when every entry resolves empty', () => {
    const template = parseHandoffOptions({ customerFields: [{ apiKey: 'Name', from: 'name' }] })?.customerFields;
    expect(buildCustomerFields({}, template)).toBeUndefined();
    expect(buildCustomerFields(undefined, template)).toBeUndefined();
  });

  it('coerces non-string references to their string form', () => {
    const template = parseHandoffOptions({ customerFields: [{ apiKey: 'Score', from: 'score' }] })?.customerFields;
    expect(buildCustomerFields({ score: 42 }, template)).toEqual([{ apiKey: 'Score', value: '42' }]);
  });
});
