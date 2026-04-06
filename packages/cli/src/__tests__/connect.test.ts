/**
 * Connect Command Unit Tests
 *
 * Verifies that `omni connect`:
 *   - Invokes `genie dir ls <name> --json` (not the old non-existent `genie dir get`)
 *   - Sets agentId (FK) on instance update (not just agentProviderId)
 *   - Sets agentReplyFilter on instance update
 *   - Includes --mode and --reply-filter options
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

describe('connect command — instance update fields', () => {
  test('sets agentId FK on instance (not just agentProviderId)', async () => {
    const source = await Bun.file(CONNECT_SRC).text();

    // The update call must include agentId as a distinct field
    expect(source).toContain('agentId,');
    // Must also include agentProviderId
    expect(source).toContain('agentProviderId: providerId');
    // Both must be in the same update call
    expect(source).toMatch(/instances\.update\(instanceId,\s*\{[^}]*agentId/);
    expect(source).toMatch(/instances\.update\(instanceId,\s*\{[^}]*agentProviderId/);
  });

  test('sets agentReplyFilter on instance update', async () => {
    const source = await Bun.file(CONNECT_SRC).text();

    // Must set agentReplyFilter in the update call
    expect(source).toMatch(/instances\.update\(instanceId,\s*\{[^}]*agentReplyFilter/);
    // Default mode should be 'all'
    expect(source).toContain("'all'");
  });

  test('sets triggerMode on instance update', async () => {
    const source = await Bun.file(CONNECT_SRC).text();

    // Must include triggerMode in the update call
    expect(source).toMatch(/instances\.update\(instanceId,\s*\{[^}]*triggerMode/);
    // turn-based maps to round-trip
    expect(source).toContain("'round-trip'");
    expect(source).toContain("'fire-and-forget'");
  });
});

describe('connect command — CLI options', () => {
  test('has --mode option with turn-based default', async () => {
    const source = await Bun.file(CONNECT_SRC).text();

    expect(source).toContain("'--mode <mode>'");
    expect(source).toContain("'turn-based'");
  });

  test('has --reply-filter option with all default', async () => {
    const source = await Bun.file(CONNECT_SRC).text();

    expect(source).toContain("'--reply-filter <filter>'");
    // Default is 'all'
    expect(source).toMatch(/reply-filter.*'all'/);
  });

  test('prints summary with agentId, replyFilter, provider, and NATS topics', async () => {
    const source = await Bun.file(CONNECT_SRC).text();

    expect(source).toContain("'Agent ID'");
    expect(source).toContain("'Provider ID'");
    expect(source).toContain("'Reply Filter'");
    expect(source).toContain("'Trigger Mode'");
    expect(source).toContain("'Inbound'");
    expect(source).toContain("'Outbound'");
  });
});
