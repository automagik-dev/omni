/**
 * Tests for the shared deprecation-nudge helper used by:
 *   - omni agents create        (when --agent-provider points at a nats-genie provider)
 *   - omni instances update     (when --agent-provider points at a nats-genie provider)
 *   - omni agent-routes create  (when --agent's provider is nats-genie, via 2-hop)
 *
 * Pins the contract:
 *   - Emits the tip ONLY when the provider's schema is `nats-genie`.
 *   - Stays silent for any other schema (`agno`, `webhook`, `claude-code`, etc.).
 *   - Best-effort — provider lookup failures must NOT throw.
 *   - The tip text references both `omni connect` and `/genie:omni`.
 *
 * Strategy: capture writes to `process.stderr` (where `output.tip` lands in
 * both human and JSON modes — pinned by output.test.ts). ESM exports are
 * read-only so we can't monkey-patch the module; intercepting stderr at the
 * process level is the cleanest way to assert the behavior end-to-end.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { maybeNudgeForGenieBackedAgent } from '../utils/genie-wiring-nudge.js';

let originalConsoleError: typeof console.error;
let captured: string[];

beforeEach(() => {
  captured = [];
  originalConsoleError = console.error;
  console.error = ((...args: unknown[]) => {
    captured.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  }) as typeof console.error;
});

afterEach(() => {
  console.error = originalConsoleError;
});

function makeFakeClient(provider: { schema: string } | Error | null) {
  return {
    providers: {
      get: mock(async () => {
        if (provider instanceof Error) throw provider;
        if (provider === null) throw new Error('not found');
        return provider;
      }),
    },
  } as unknown as Parameters<typeof maybeNudgeForGenieBackedAgent>[0];
}

describe('maybeNudgeForGenieBackedAgent', () => {
  test('emits the tip when schema is nats-genie (folds in agentName)', async () => {
    const client = makeFakeClient({ schema: 'nats-genie' });
    await maybeNudgeForGenieBackedAgent(client, 'provider-uuid', 'khal-os-3');

    const stderr = captured.join('');
    expect(stderr).toContain('omni connect');
    expect(stderr).toContain('khal-os-3');
    expect(stderr).toContain('/genie:omni');
  });

  test('uses <agent> placeholder when agentName is omitted', async () => {
    const client = makeFakeClient({ schema: 'nats-genie' });
    await maybeNudgeForGenieBackedAgent(client, 'provider-uuid');

    const stderr = captured.join('');
    expect(stderr).toContain('<agent>');
  });

  test('stays silent for non-nats-genie schemas', async () => {
    for (const schema of ['agno', 'webhook', 'claude-code', 'a2a', 'ag-ui']) {
      captured = [];
      const client = makeFakeClient({ schema });
      await maybeNudgeForGenieBackedAgent(client, 'provider-uuid', 'someone');
      expect(captured.join('')).toBe('');
    }
  });

  test('best-effort — provider lookup failures do not throw or nudge', async () => {
    const client = makeFakeClient(new Error('ECONNREFUSED'));
    // Must NOT throw
    await maybeNudgeForGenieBackedAgent(client, 'provider-uuid', 'someone');
    expect(captured.join('')).toBe('');
  });
});
