/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';
import {
  type TemplateDraft,
  buildTemplateComponents,
  createdTemplateToast,
  extractVariables,
  variablesError,
} from '@/components/templates/template-payload';

const draft = (patch: Partial<TemplateDraft>): TemplateDraft => ({
  headerMode: 'NONE',
  headerText: '',
  headerSample: '',
  headerImageHandle: '',
  body: '',
  bodySamples: {},
  footer: '',
  buttons: [],
  ...patch,
});

describe('extractVariables', () => {
  test('returns distinct variable numbers in ascending order', () => {
    expect(extractVariables('Hi {{2}}, order {{1}} for {{2}} ({{ 3 }})')).toEqual([1, 2, 3]);
    expect(extractVariables('No variables here')).toEqual([]);
  });
});

describe('variablesError', () => {
  test('requires a sample per variable', () => {
    expect(variablesError('Hi {{1}}, order {{2}}', { 1: 'Ana' })).toBe('Add a sample value for {{2}}');
    expect(variablesError('Hi {{1}}', { 1: '  ' })).toBe('Add a sample value for {{1}}');
    expect(variablesError('Hi {{1}}, order {{2}}', { 1: 'Ana', 2: '123' })).toBeNull();
    expect(variablesError('No variables', {})).toBeNull();
  });

  test('requires variables numbered from {{1}} without gaps', () => {
    expect(variablesError('Hi {{2}}', { 2: 'Ana' })).toBe('Number variables in order, starting at {{1}} with no gaps');
    expect(variablesError('{{1}} and {{3}}', { 1: 'a', 3: 'c' })).toBe(
      'Number variables in order, starting at {{1}} with no gaps',
    );
  });

  test('enforces a maximum when given (text header allows one)', () => {
    expect(variablesError('{{1}} {{2}}', { 1: 'a', 2: 'b' }, 1)).toBe('Use at most 1 variable here');
  });
});

describe('buildTemplateComponents (#1276)', () => {
  test('sends example.body_text with one sample per body variable, in order', () => {
    const components = buildTemplateComponents(
      draft({ body: 'Hello {{1}}, your order {{2}} is confirmed.', bodySamples: { 2: '4521', 1: 'Ana' } }),
    );
    expect(components).toEqual([
      {
        type: 'BODY',
        text: 'Hello {{1}}, your order {{2}} is confirmed.',
        example: { body_text: [['Ana', '4521']] },
      },
    ]);
  });

  test('omits the body example when there are no variables', () => {
    expect(buildTemplateComponents(draft({ body: 'Thanks for reaching out.' }))).toEqual([
      { type: 'BODY', text: 'Thanks for reaching out.' },
    ]);
  });

  test('sends example.header_text for a text header with a variable', () => {
    const [header] = buildTemplateComponents(
      draft({ headerMode: 'TEXT', headerText: 'Order {{1}}', headerSample: '4521', body: 'Body' }),
    );
    expect(header).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Order {{1}}', example: { header_text: ['4521'] } });
  });

  test('keeps image header, footer and buttons', () => {
    const components = buildTemplateComponents(
      draft({
        headerMode: 'IMAGE',
        headerImageHandle: 'handle-1',
        body: 'Body',
        footer: 'Footer',
        buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }],
      }),
    );
    expect(components.map((c) => c.type)).toEqual(['HEADER', 'BODY', 'FOOTER', 'BUTTONS']);
    expect(components[0]).toEqual({ type: 'HEADER', format: 'IMAGE', example: { header_handle: ['handle-1'] } });
  });
});

describe('createdTemplateToast (#1276)', () => {
  test('PENDING is a success: submitted for review', () => {
    expect(createdTemplateToast({ name: 'welcome', status: 'PENDING' })).toEqual({
      kind: 'success',
      message: 'Template submitted for review',
    });
  });

  test('REJECTED is an error, with the reason when Meta gave one', () => {
    expect(createdTemplateToast({ name: 'welcome', status: 'REJECTED', rejectionReason: 'INVALID_FORMAT' })).toEqual({
      kind: 'error',
      message: 'Meta rejected "welcome": INVALID_FORMAT',
    });
    expect(createdTemplateToast({ name: 'welcome', status: 'REJECTED', rejectionReason: null })).toEqual({
      kind: 'error',
      message: 'Meta rejected "welcome"',
    });
  });

  test('APPROVED is a success', () => {
    expect(createdTemplateToast({ name: 'welcome', status: 'APPROVED' }).kind).toBe('success');
  });
});
