import { describe, expect, test } from 'bun:test';
import { mergeById } from './merge-by-id';

interface Row {
  id: string;
  v: number;
}
const id = (r: Row) => r.id;

describe('mergeById', () => {
  test('places incoming ahead of existing (newest-first feed)', () => {
    const existing: Row[] = [{ id: 'b', v: 1 }];
    const incoming: Row[] = [{ id: 'a', v: 2 }];
    expect(mergeById(existing, incoming, id).map(id)).toEqual(['a', 'b']);
  });

  test('dedupes by id with incoming winning on collision', () => {
    const existing: Row[] = [{ id: 'a', v: 1 }];
    const incoming: Row[] = [{ id: 'a', v: 99 }];
    const out = mergeById(existing, incoming, id);
    expect(out).toHaveLength(1);
    expect(out[0]?.v).toBe(99);
  });

  test('caps the result to max from the head', () => {
    const existing: Row[] = [
      { id: 'c', v: 3 },
      { id: 'd', v: 4 },
    ];
    const incoming: Row[] = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 },
    ];
    expect(mergeById(existing, incoming, id, { max: 3 }).map(id)).toEqual(['a', 'b', 'c']);
  });
});
