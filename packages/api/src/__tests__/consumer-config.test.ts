/**
 * Consumer Configuration Tests
 *
 * Verifies that all critical NATS consumers use the correct startFrom policy
 * to prevent message loss on restart. This is a safety net — if someone
 * accidentally changes startFrom back to 'last', this test will catch it.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PLUGINS_DIR = join(import.meta.dir, '../plugins');

/** Extract startFrom values from a plugin file's subscribe calls */
function extractStartFromValues(filePath: string): Array<{ line: number; value: string; context: string }> {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const results: Array<{ line: number; value: string; context: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const match = line.match(/startFrom:\s*['"](\w+)['"]/);
    const matchValue = match?.[1];
    if (matchValue) {
      // Look back for durable consumer name (starting at the startFrom line
      // itself — inline option objects put both on one line)
      let context = '';
      for (let j = i; j >= Math.max(0, i - 15); j--) {
        const durableMatch = lines[j]?.match(/durable:\s*['"]([^'"]+)['"]/);
        if (durableMatch?.[1]) {
          context = durableMatch[1];
          break;
        }
      }
      results.push({ line: i + 1, value: matchValue, context });
    }
  }
  return results;
}

describe('Consumer startFrom Configuration', () => {
  test('message-persistence: all consumers use startFrom: first', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'message-persistence.ts'));
    const critical = values.filter(
      (v) => v.context.startsWith('message-persistence-') && v.context !== 'message-persistence-reconnect',
    );

    expect(critical.length).toBeGreaterThanOrEqual(4);
    for (const entry of critical) {
      expect(entry.value).toBe('first');
    }
  });

  test('message-persistence: reconnect consumer uses startFrom: first', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'message-persistence.ts'));
    const reconnect = values.find((v) => v.context === 'message-persistence-reconnect');

    expect(reconnect).toBeDefined();
    expect(reconnect?.value).toBe('first');
  });

  test('media-processor: uses startFrom: first', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'media-processor.ts'));

    expect(values.length).toBeGreaterThanOrEqual(1);
    expect(values[0]?.value).toBe('first');
  });

  test('agent-responder: main consumer uses startFrom: new (#411)', () => {
    // Was 'first' — but for a side-effect handler that's catastrophic on a
    // recreated durable (replays the entire stream → N agent dispatches).
    // See #411 fix plan: switch all side-effect durables to 'new'.
    const values = extractStartFromValues(join(PLUGINS_DIR, 'agent-responder.ts'));
    const main = values.find((v) => v.context === 'agent-responder');

    expect(main).toBeDefined();
    expect(main?.value).toBe('new');
  });

  test('agent-responder: typing consumer uses startFrom: new (#411)', () => {
    // Was 'last' — for a fresh durable that fires the most recent typing
    // event, restarting the debounce on a stale chat. 'new' is safer.
    const values = extractStartFromValues(join(PLUGINS_DIR, 'agent-responder.ts'));
    const typing = values.find((v) => v.context === 'agent-responder-typing');

    expect(typing).toBeDefined();
    expect(typing?.value).toBe('new');
  });

  test('agent-dispatcher: all side-effect consumers use startFrom: new (#411)', () => {
    // Issue #411: side-effect handlers (sends, dispatches) must NOT replay on
    // recreated durable. The 5 consumers below own customer-visible work.
    const values = extractStartFromValues(join(PLUGINS_DIR, 'agent-dispatcher.ts'));
    const sideEffectConsumers = [
      'agent-dispatcher-msg',
      'agent-dispatcher-reaction',
      'agent-dispatcher-reaction-removed',
      'agent-dispatcher-typing',
      'agent-dispatcher-media',
    ];
    for (const name of sideEffectConsumers) {
      const entry = values.find((v) => v.context === name);
      expect(entry, `expected ${name} to be present in agent-dispatcher.ts`).toBeDefined();
      expect(entry?.value, `${name} must use startFrom: 'new'`).toBe('new');
    }
  });

  test('session-cleaner: uses startFrom: new (#411)', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'session-cleaner.ts'));
    const main = values.find((v) => v.context === 'session-cleaner');

    expect(main).toBeDefined();
    expect(main?.value).toBe('new');
  });

  test('event-persistence: message consumers use startFrom: first; custom journal consumer is forward-only', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'event-persistence.ts'));

    expect(values.length).toBeGreaterThanOrEqual(1);

    // The custom-event journal consumer (#957) is deliberately 'new': #957 is
    // forward-only, and a 'first' durable would replay the entire CUSTOM
    // stream retention as journal rows that can never carry a causation
    // parent.
    const custom = values.find((v) => v.context === 'event-persistence-custom');
    expect(custom).toBeDefined();
    expect(custom?.value).toBe('new');

    for (const entry of values) {
      if (entry.context === 'event-persistence-custom') continue;
      expect(entry.value).toBe('first');
    }
  });

  test('sync-worker: uses startFrom: new (ephemeral triggers)', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'sync-worker.ts'));

    expect(values.length).toBeGreaterThanOrEqual(1);
    expect(values[0]?.value).toBe('new');
  });

  test('no critical consumer uses startFrom: last', () => {
    const criticalFiles = ['message-persistence.ts', 'media-processor.ts', 'event-persistence.ts'];

    for (const file of criticalFiles) {
      const values = extractStartFromValues(join(PLUGINS_DIR, file));
      for (const entry of values) {
        expect(entry.value).not.toBe('last');
      }
    }
  });
});
