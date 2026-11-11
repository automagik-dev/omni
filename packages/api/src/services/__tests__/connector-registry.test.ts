/**
 * Every manifest this API ships is a promise to the callers that ask before writing: an
 * action says whether it reads or writes, and a missing answer is a write to them.
 */

import { describe, expect, test } from 'bun:test';
import { connectorRegistry } from '../connector-registry';

describe('shipped connector manifests', () => {
  test('every declared action says whether it reads or writes', () => {
    const undeclared = connectorRegistry
      .list()
      .flatMap((manifest) =>
        manifest.actions
          .filter((action) => action.access !== 'read' && action.access !== 'write')
          .map((action) => `${manifest.id}/${action.key}`),
      );
    expect(undeclared).toEqual([]);
  });
});
