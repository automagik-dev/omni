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
      // Look back for durable consumer name
      let context = '';
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
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

  test('agent-responder: main consumer uses startFrom: first', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'agent-responder.ts'));
    const main = values.find((v) => v.context === 'agent-responder');

    expect(main).toBeDefined();
    expect(main?.value).toBe('first');
  });

  test('agent-responder: typing consumer uses startFrom: last (ephemeral OK)', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'agent-responder.ts'));
    const typing = values.find((v) => v.context === 'agent-responder-typing');

    expect(typing).toBeDefined();
    expect(typing?.value).toBe('last');
  });

  test('event-persistence: all consumers use startFrom: first', () => {
    const values = extractStartFromValues(join(PLUGINS_DIR, 'event-persistence.ts'));

    expect(values.length).toBeGreaterThanOrEqual(1);
    for (const entry of values) {
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
