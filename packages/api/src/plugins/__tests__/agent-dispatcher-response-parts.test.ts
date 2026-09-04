/**
 * `sendResponseParts` — the one funnel every agent reply leaves through.
 *
 * One reply becomes N sends: the provider splits it on blank lines
 * (`agno-provider.ts`, `enableAutoSplit`) and each part goes out on its own.
 * Every channel but one wants exactly that. asc-flow's transport carries a
 * SINGLE answer per polled turn, so it has to know where a reply ENDS — its
 * first part used to answer the poll, the flow collected it and closed the
 * turn, and parts 2..N were refused as undeliverable (atendimento 22325225).
 *
 * `partIndex`/`partCount` is that signal, and it must count the sends that
 * really happen — a part the sanitizer empties never reaches the plugin.
 */

import { describe, expect, it, mock } from 'bun:test';

const sends: Array<{ text: string; metadata: Record<string, unknown> }> = [];

// Mock the plugin loader — same pattern as agent-dispatch-error-message.test.ts.
// Without it the module init crashes loading the parent agent-dispatcher.ts.
mock.module('../loader', () => ({
  getPlugin: mock(async () => ({
    async sendMessage(_instanceId: string, message: { content: { text: string }; metadata: Record<string, unknown> }) {
      sends.push({ text: message.content.text, metadata: message.metadata });
      return { success: true, timestamp: Date.now() };
    },
  })),
}));

import { __test__ } from '../agent-dispatcher';

const NO_DELAY = { mode: 'disabled', fixedMs: 0, minMs: 0, maxMs: 0 } as const;

const send = (parts: string[]) => {
  sends.length = 0;
  return __test__.sendResponseParts('asc-flow' as never, 'inst-1', '42', parts, NO_DELAY);
};

describe('sendResponseParts stamps where each send sits in the reply', () => {
  it('numbers every part of one reply', async () => {
    await send(['primeiro', 'segundo', 'terceiro']);

    expect(sends.map((s) => s.text)).toEqual(['primeiro', 'segundo', 'terceiro']);
    expect(sends.map((s) => [s.metadata.partIndex, s.metadata.partCount])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
  });

  it('marks a single-part reply as its own last part', async () => {
    await send(['so uma']);

    expect(sends).toHaveLength(1);
    expect(sends[0]?.metadata).toMatchObject({ partIndex: 0, partCount: 1 });
  });

  it('counts the sends that happen, not the parts that came in', async () => {
    // A part that is nothing but an internal routing header never reaches the
    // plugin. Counting it would leave asc-flow holding the reply for a last
    // part that never arrives.
    await send(['primeiro', '[channel:asc-flow instance:inst-1 chat:42]', 'ultimo']);

    expect(sends.map((s) => s.text)).toEqual(['primeiro', 'ultimo']);
    expect(sends.map((s) => s.metadata.partCount)).toEqual([2, 2]);
    expect(sends.at(-1)?.metadata.partIndex).toBe(1);
  });
});
