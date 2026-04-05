/**
 * Connect Command Unit Tests
 *
 * Verifies that `omni connect` invokes `genie dir ls <name> --json`
 * (not the old non-existent `genie dir get`).
 */

import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';

const CONNECT_SRC = resolve(import.meta.dir, '../commands/connect.ts');

describe('connect command — genie dir discovery', () => {
  test('calls genie dir ls <name> --json (not genie dir get)', async () => {
    const source = await Bun.file(CONNECT_SRC).text();

    // Must contain the correct command
    expect(source).toContain("'dir', 'ls',");
    expect(source).toContain("'--json'");

    // Must NOT contain the old broken command
    expect(source).not.toContain("'dir', 'get',");
  });

  test('comment documents the correct command', async () => {
    const source = await Bun.file(CONNECT_SRC).text();

    expect(source).toContain('genie dir ls');
    expect(source).not.toMatch(/genie dir get/);
  });
});
