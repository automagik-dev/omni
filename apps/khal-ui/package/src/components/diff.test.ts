import { describe, expect, test } from 'bun:test';
import { diffEntities } from './diff';

describe('diffEntities', () => {
  test('reports only changed fields, sorted by key', () => {
    const before = { name: 'a', count: 1, tag: 'x' };
    const after = { name: 'b', count: 1, tag: 'y' };
    expect(diffEntities(before, after)).toEqual([
      { key: 'name', before: 'a', after: 'b' },
      { key: 'tag', before: 'x', after: 'y' },
    ]);
  });

  test('detects added and removed keys', () => {
    const changes = diffEntities({ a: 1 }, { b: 2 });
    expect(changes).toEqual([
      { key: 'a', before: 1, after: undefined },
      { key: 'b', before: undefined, after: 2 },
    ]);
  });

  test('deep-compares nested values', () => {
    expect(diffEntities({ x: { y: 1 } }, { x: { y: 1 } })).toEqual([]);
    expect(diffEntities({ x: { y: 1 } }, { x: { y: 2 } })).toHaveLength(1);
  });

  test('tolerates non-object inputs', () => {
    expect(diffEntities(null, undefined)).toEqual([]);
  });
});
