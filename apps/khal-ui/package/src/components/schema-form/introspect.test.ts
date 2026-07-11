import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { coerce, initialValue, introspect, validate } from './introspect';

// A non-trivial schema exercising nested object + enum + array + record + wrappers.
const schema = z.object({
  name: z.string().min(1).describe('Display name'),
  retries: z.number().int().default(3),
  enabled: z.boolean().default(true),
  channel: z.enum(['whatsapp', 'discord', 'slack']),
  tags: z.array(z.string()),
  route: z.object({
    priority: z.number(),
    fallback: z.string().optional(),
  }),
  headers: z.record(z.string()),
});

describe('introspect', () => {
  const tree = introspect(schema);

  test('maps a nested object schema to a field tree', () => {
    expect(tree.kind).toBe('object');
    const byKey = Object.fromEntries((tree.fields ?? []).map((f) => [f.key, f.node]));
    expect(byKey.name?.kind).toBe('string');
    expect(byKey.name?.description).toBe('Display name');
    expect(byKey.retries?.kind).toBe('number');
    expect(byKey.retries?.defaultValue).toBe(3);
    expect(byKey.enabled?.kind).toBe('boolean');
    expect(byKey.enabled?.defaultValue).toBe(true);
  });

  test('extracts enum options', () => {
    const channel = tree.fields?.find((f) => f.key === 'channel')?.node;
    expect(channel?.kind).toBe('enum');
    expect(channel?.options).toEqual(['whatsapp', 'discord', 'slack']);
  });

  test('descends into arrays and marks the element kind', () => {
    const tags = tree.fields?.find((f) => f.key === 'tags')?.node;
    expect(tags?.kind).toBe('array');
    expect(tags?.element?.kind).toBe('string');
  });

  test('descends into nested objects with optional fields', () => {
    const route = tree.fields?.find((f) => f.key === 'route')?.node;
    expect(route?.kind).toBe('object');
    const fallback = route?.fields?.find((f) => f.key === 'fallback')?.node;
    expect(fallback?.optional).toBe(true);
  });

  test('recognizes records', () => {
    const headers = tree.fields?.find((f) => f.key === 'headers')?.node;
    expect(headers?.kind).toBe('record');
    expect(headers?.valueType?.kind).toBe('string');
  });

  test('handles union-of-literals as an enum', () => {
    const node = introspect(z.union([z.literal('a'), z.literal('b')]));
    expect(node.kind).toBe('enum');
    expect(node.options).toEqual(['a', 'b']);
  });
});

describe('initialValue', () => {
  test('uses declared defaults and empty-by-kind otherwise', () => {
    const tree = introspect(schema);
    const init = initialValue(tree) as Record<string, unknown>;
    expect(init.name).toBe('');
    expect(init.retries).toBe(3);
    expect(init.enabled).toBe(true);
    expect(init.channel).toBe('whatsapp'); // first option for a required enum
    expect(init.tags).toEqual([]);
    expect(init.headers).toEqual({});
    expect((init.route as Record<string, unknown>).priority).toBe('');
  });
});

describe('validate + coerce', () => {
  const tree = introspect(schema);

  test('coerces string inputs to numbers and validates a good payload', () => {
    const result = validate(schema, tree, {
      name: 'Router',
      retries: '5', // string from a text input
      enabled: false,
      channel: 'discord',
      tags: ['a', 'b'],
      route: { priority: '10' },
      headers: { 'x-trace': 'on' },
    });
    expect(result.success).toBe(true);
    expect((result.data as z.infer<typeof schema>).retries).toBe(5);
    expect((result.data as z.infer<typeof schema>).route.priority).toBe(10);
  });

  test('reports errors keyed by dotted path', () => {
    const result = validate(schema, tree, {
      name: '', // fails min(1)
      retries: '3',
      enabled: true,
      channel: 'nope', // not in enum
      tags: [],
      route: { priority: 'x' }, // not a number
      headers: {},
    });
    expect(result.success).toBe(false);
    expect(result.errors.name).toBeDefined();
    expect(result.errors.channel).toBeDefined();
    expect(result.errors['route.priority']).toBeDefined();
  });
});

describe('coerce', () => {
  test('drops empty optional strings to undefined', () => {
    const node = introspect(z.string().optional());
    expect(coerce(node, '')).toBeUndefined();
  });
});
