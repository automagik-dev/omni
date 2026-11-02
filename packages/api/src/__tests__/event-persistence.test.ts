/** Journal producer column trust boundary without a database connection. */
import { afterAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { createDbHandle } from '@omni/db';
import { journalProducerColumns } from '../plugins/event-persistence';

describe('journal producer column trust boundary (no database connection)', () => {
  const handle = createDbHandle({ url: 'postgres://unused@127.0.0.1:1/unused' });
  afterAll(() => handle.close());

  test('flag off preserves legacy agent metadata and never stores a producing key', async () => {
    const previous = process.env.OMNI_PAIRED_AGENT_CONSUMERS;
    Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
    try {
      const agentId = randomUUID();
      expect(
        await journalProducerColumns(handle.db, { correlationId: 'proof', agentId, producingKeyId: randomUUID() }),
      ).toEqual({ producingKeyId: null, agentId });
    } finally {
      if (previous === undefined) Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
      else process.env.OMNI_PAIRED_AGENT_CONSUMERS = previous;
    }
  });

  test('flag on ignores agent metadata and refuses malformed envelope keys without a query', async () => {
    const flag = process.env.OMNI_PAIRED_AGENT_CONSUMERS;
    const tenancy = process.env.OMNI_MULTITENANCY_ENABLED;
    process.env.OMNI_PAIRED_AGENT_CONSUMERS = 'true';
    Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
    try {
      for (const producingKeyId of [undefined, 'invalid']) {
        expect(
          await journalProducerColumns(handle.db, { correlationId: 'proof', agentId: randomUUID(), producingKeyId }),
        ).toEqual({ producingKeyId: null, agentId: null });
      }
    } finally {
      if (flag === undefined) Reflect.deleteProperty(process.env, 'OMNI_PAIRED_AGENT_CONSUMERS');
      else process.env.OMNI_PAIRED_AGENT_CONSUMERS = flag;
      if (tenancy === undefined) Reflect.deleteProperty(process.env, 'OMNI_MULTITENANCY_ENABLED');
      else process.env.OMNI_MULTITENANCY_ENABLED = tenancy;
    }
  });
});
