/**
 * #1248 kill switches: `instances update --agent null` clears agentId, and
 * `--clear-reply-filter` on an instance that keeps its agent stores the
 * documented default instead of null.
 */

import { describe, expect, test } from 'bun:test';
import { buildInstanceBody, createInstancesCommand, defaultClearedReplyFilter } from '../instances';

function updateBody(argv: string[]) {
  const cmd = createInstancesCommand().commands.find((c) => c.name() === 'update');
  if (!cmd) throw new Error('missing update');
  cmd.parseOptions(argv);
  return buildInstanceBody(cmd.opts());
}

const DEFAULT = { mode: 'all', conditions: { onDm: true } };

describe('instances update agent kill switches (#1248)', () => {
  test('--agent maps to agentId, "null" clears it', () => {
    expect(updateBody(['--agent', 'null'])).toMatchObject({ agentId: null });
    expect(updateBody(['--agent', 'a-1'])).toMatchObject({ agentId: 'a-1' });
    expect(updateBody([])).not.toHaveProperty('agentId');
  });

  test('--clear-reply-filter with an existing agent stores the default', async () => {
    const body = updateBody(['--clear-reply-filter']);
    expect(await defaultClearedReplyFilter(body, async () => 'agent-1')).toBe(true);
    expect(body.agentReplyFilter).toEqual(DEFAULT);
  });

  test('--clear-reply-filter with --agent null stays null (no lookup)', async () => {
    const body = updateBody(['--agent', 'null', '--clear-reply-filter']);
    const lookup = async () => {
      throw new Error('should not look up');
    };
    expect(await defaultClearedReplyFilter(body, lookup)).toBe(false);
    expect(body).toMatchObject({ agentId: null, agentReplyFilter: null });
  });

  test('--clear-reply-filter on an instance without an agent stays null', async () => {
    const body = updateBody(['--clear-reply-filter']);
    expect(await defaultClearedReplyFilter(body, async () => null)).toBe(false);
    expect(body.agentReplyFilter).toBeNull();
  });

  test('no --clear-reply-filter: untouched', async () => {
    const body = updateBody(['--name', 'x']);
    expect(await defaultClearedReplyFilter(body, async () => 'agent-1')).toBe(false);
    expect(body).not.toHaveProperty('agentReplyFilter');
  });
});
