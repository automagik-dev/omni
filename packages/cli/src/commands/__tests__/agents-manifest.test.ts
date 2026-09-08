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

const { detectManifestFormat, parseManifestSource, validateManifestDocument, buildGraphRows, buildTypeRows } =
  __testables;

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
      { name: 'reviewer', eventManifest: validManifest },
      { name: 'silent', eventManifest: null },
      { name: 'empty', eventManifest: { accepts: [], publishes: [] } },
      { name: 'emitter', eventManifest: { publishes: [{ event: 'custom.alerts.raised' }] } },
    ]);

    expect(rows).toEqual([
      {
        agent: 'reviewer',
        consumes: 'custom.clickup.task.status_changed (filtered)',
        produces: 'custom.review.parecer.ready',
      },
      { agent: 'emitter', consumes: '-', produces: 'custom.alerts.raised' },
    ]);
  });

  test('unfiltered accepts render without the (filtered) marker', () => {
    const rows = buildGraphRows([{ name: 'a', eventManifest: { accepts: [{ event: 'message.received' }] } }]);
    expect(rows[0]?.consumes).toBe('message.received');
  });
});

describe('buildTypeRows', () => {
  const agents = [
    { name: 'reviewer', eventManifest: validManifest },
    { name: 'emitter', eventManifest: { publishes: [{ event: 'custom.clickup.task.status_changed' }] } },
    { name: 'silent', eventManifest: null },
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
