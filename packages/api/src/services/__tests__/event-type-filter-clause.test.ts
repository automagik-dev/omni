/**
 * SQL rendering of the shared event-type include/exclude clause (#966 glob
 * contract, #1078 exclusion) used by EventService.list and the durable
 * consumer scan. DB-free: renders the clause through the pg dialect.
 */

import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { eventTypeFilterClause, eventTypeGlobClause } from '../events';

function render(clause: ReturnType<typeof eventTypeFilterClause>): { sql: string; params: unknown[] } {
  if (!clause) throw new Error('expected a clause');
  const q = new PgDialect().sqlToQuery(clause);
  return { sql: q.sql.replace(/\s+/g, ' ').toLowerCase(), params: q.params };
}

describe('eventTypeGlobClause', () => {
  test('empty list yields no clause', () => {
    expect(eventTypeGlobClause([])).toBeUndefined();
    expect(eventTypeFilterClause(undefined, undefined)).toBeUndefined();
  });

  test('exact entries use IN, trailing-* entries use LIKE prefix, ORed together', () => {
    const { sql, params } = render(eventTypeGlobClause(['message.received', 'custom.*']));
    expect(sql).toContain('in (');
    expect(sql).toContain('like');
    expect(sql).toContain(' or ');
    expect(params).toEqual(['message.received', 'custom.%']);
  });

  test('LIKE wildcards inside a glob prefix are escaped', () => {
    const { params } = render(eventTypeGlobClause(['custom.a_b%.*']));
    expect(params).toEqual(['custom.a\\_b\\%.%']);
  });
});

describe('eventTypeFilterClause (#1078)', () => {
  test('exclude globs are negated and ANDed with the include clause', () => {
    const { sql, params } = render(eventTypeFilterClause(['custom.*'], ['custom.chat.*', 'custom.lid-mapping.batch']));
    expect(sql).toMatch(/like \$1 and not \(.* in \(\$2\) or .* like \$3\)/);
    expect(params).toEqual(['custom.%', 'custom.lid-mapping.batch', 'custom.chat.%']);
  });

  test('exclude alone renders as a bare NOT', () => {
    const { sql, params } = render(eventTypeFilterClause(undefined, ['custom.contacts.names']));
    expect(sql).toMatch(/^not "omni_events"."event_type" in \(\$1\)$/);
    expect(params).toEqual(['custom.contacts.names']);
  });
});
