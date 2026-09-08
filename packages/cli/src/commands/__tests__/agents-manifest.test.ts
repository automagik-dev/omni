/**
 * CLI `omni agents manifest apply` / `omni agents graph` — pure helpers.
 *
 * Client-side manifest parsing/validation (JSON + YAML via Bun.YAML, no extra
 * dependency) and the producer/consumer graph rows built from SDK list output.
 * Network paths are exercised at the API route level; here we test the logic
 * the command actions delegate to (issue #985, RFC #925 G4a).
 */

import { describe, expect, test } from 'bun:test';
import { __testables } from '../agents';

const {
  detectManifestFormat,
  parseManifestSource,
  validateManifestDocument,
  buildGraphRows,
  buildTypeRows,
  countManagedAutomations,
  formatCompiledIndicator,
} = __testables;

const validManifest = {
  accepts: [{ event: 'custom.clickup.task.status_changed', filter: { list_id: '901300373349' } }],
  publishes: [{ event: 'custom.review.parecer.ready' }],
};

describe('detectManifestFormat', () => {
  test('maps extensions to formats (JSON is the default)', () => {
    expect(detectManifestFormat('manifest.yaml')).toBe('yaml');
    expect(detectManifestFormat('manifest.yml')).toBe('yaml');
    expect(detectManifestFormat('manifest.YAML')).toBe('yaml');
    expect(detectManifestFormat('manifest.json')).toBe('json');
    expect(detectManifestFormat('manifest')).toBe('json');
  });
});

describe('parseManifestSource', () => {
  test('parses JSON', () => {
    expect(parseManifestSource(JSON.stringify(validManifest), 'json')).toEqual(validManifest);
  });

  test('parses YAML in the RFC shape via Bun.YAML', () => {
    const yaml = [
      'accepts:',
      '  - event: custom.clickup.task.status_changed',
      '    filter: { list_id: "901300373349" }',
      'publishes:',
      '  - event: custom.review.parecer.ready',
    ].join('\n');
    expect(parseManifestSource(yaml, 'yaml')).toEqual(validManifest);
  });

  test('throws on malformed JSON', () => {
    expect(() => parseManifestSource('{ not json', 'json')).toThrow();
  });
});

describe('validateManifestDocument', () => {
  test('returns the parsed manifest with defaults applied', () => {
    const parsed = validateManifestDocument({ publishes: [{ event: 'custom.review.parecer.ready' }] });
    expect(parsed.accepts).toEqual([]);
    expect(parsed.publishes).toHaveLength(1);
  });

  test('rejects bad event tokens with a per-field message', () => {
    expect(() => validateManifestDocument({ publishes: [{ event: 'review.parecer.ready' }] })).toThrow(
      /publishes\.0\.event/,
    );
  });

  test('rejects unknown keys', () => {
    expect(() => validateManifestDocument({ accept: [] })).toThrow(/Manifest failed validation/);
  });
});

describe('buildGraphRows', () => {
  test('one row per declaring agent; undeclared agents are omitted', () => {
    const rows = buildGraphRows([
      { id: 'a-1', name: 'reviewer', eventManifest: validManifest },
      { id: 'a-2', name: 'silent', eventManifest: null },
      { id: 'a-3', name: 'empty', eventManifest: { accepts: [], publishes: [] } },
      { id: 'a-4', name: 'emitter', eventManifest: { publishes: [{ event: 'custom.alerts.raised' }] } },
    ]);

    expect(rows).toEqual([
      {
        agent: 'reviewer',
        consumes: 'custom.clickup.task.status_changed (filtered)',
        produces: 'custom.review.parecer.ready',
        compiled: 'unknown',
      },
      { agent: 'emitter', consumes: '-', produces: 'custom.alerts.raised', compiled: '-' },
    ]);
  });

  test('compiled column reports materialized vs declared accepts (#986)', () => {
    const counts = new Map([['a-1', 1]]);
    const rows = buildGraphRows(
      [
        { id: 'a-1', name: 'reviewer', eventManifest: validManifest },
        {
          id: 'a-5',
          name: 'uncompiled',
          eventManifest: { accepts: [{ event: 'message.received' }, { event: 'chat.archived' }] },
        },
      ],
      counts,
    );

    expect(rows[0]?.compiled).toBe('1/1');
    // Declared but not yet materialized — counts map present, agent absent.
    expect(rows[1]?.compiled).toBe('0/2');
  });

  test('unfiltered accepts render without the (filtered) marker', () => {
    const rows = buildGraphRows([
      { id: 'a-1', name: 'a', eventManifest: { accepts: [{ event: 'message.received' }] } },
    ]);
    expect(rows[0]?.consumes).toBe('message.received');
  });
});

describe('countManagedAutomations / formatCompiledIndicator (#986)', () => {
  test('counts only manifest-managed automations, grouped by owning agent', () => {
    const counts = countManagedAutomations([
      { managedByAgentId: 'a-1' },
      { managedByAgentId: 'a-1' },
      { managedByAgentId: 'a-2' },
      { managedByAgentId: null },
      {},
    ]);
    expect(counts.get('a-1')).toBe(2);
    expect(counts.get('a-2')).toBe(1);
    expect(counts.size).toBe(2);
  });

  test('indicator: dash when nothing declared, unknown without data, n/m otherwise', () => {
    expect(formatCompiledIndicator(0, undefined)).toBe('-');
    expect(formatCompiledIndicator(2, undefined)).toBe('unknown');
    expect(formatCompiledIndicator(2, 2)).toBe('2/2');
    expect(formatCompiledIndicator(2, 0)).toBe('0/2');
  });
});

describe('buildTypeRows', () => {
  const agents = [
    { id: 'a-1', name: 'reviewer', eventManifest: validManifest },
    { id: 'a-2', name: 'emitter', eventManifest: { publishes: [{ event: 'custom.clickup.task.status_changed' }] } },
    { id: 'a-3', name: 'silent', eventManifest: null },
  ];

  test('lists consumers (with their filter) and producers of the type', () => {
    const rows = buildTypeRows(agents, 'custom.clickup.task.status_changed');
    expect(rows).toEqual([
      { agent: 'reviewer', role: 'consumes', filter: '{"list_id":"901300373349"}' },
      { agent: 'emitter', role: 'produces', filter: '-' },
    ]);
  });

  test('returns no rows for an undeclared type', () => {
    expect(buildTypeRows(agents, 'custom.unknown.type')).toEqual([]);
  });
});
