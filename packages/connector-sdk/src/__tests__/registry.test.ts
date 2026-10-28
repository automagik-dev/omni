/**
 * Registry contract: a manifest is validated at boot, a duplicate id fails
 * loudly, and the catalog renders action inputs as JSON Schema.
 */

import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { ConnectorRegistry, ConnectorRegistryError, providerDetail, providerSummary } from '../index';
import type { ConnectorManifest } from '../types';

function fixtureManifest(id = 'fixture'): ConnectorManifest {
  return {
    id,
    label: 'Fixture',
    version: '1.0.0',
    credentialFields: [{ key: 'token', label: 'Token', secret: true }],
    configSchema: z.object({}).strict(),
    async validate() {
      return { ok: true, account: 'fixture-account' };
    },
    events: [{ key: 'thing.created', label: 'Thing created', sample: { event: 'thing.created' } }],
    actions: [
      {
        key: 'do_thing',
        label: 'Do thing',
        inputSchema: z.object({ id: z.string() }).strict(),
        async run() {
          return { ok: true };
        },
      },
    ],
    verification: { kind: 'hmac-sha256', header: 'X-Signature', encoding: 'hex' },
    guide: { connect: 'Paste a token.' },
  };
}

describe('ConnectorRegistry', () => {
  test('registers valid manifests and lists them sorted by id', () => {
    const registry = new ConnectorRegistry([fixtureManifest('zeta'), fixtureManifest('alpha')]);
    expect(registry.list().map((manifest) => manifest.id)).toEqual(['alpha', 'zeta']);
    expect(registry.get('alpha')?.label).toBe('Fixture');
    expect(registry.has('missing')).toBe(false);
    expect(registry.assertValid()).toEqual([]);
  });

  test('a duplicate id throws with the id in the issue list', () => {
    const registry = new ConnectorRegistry([fixtureManifest()]);
    expect(() => registry.register(fixtureManifest())).toThrow(ConnectorRegistryError);
    try {
      registry.register(fixtureManifest());
    } catch (error) {
      expect((error as ConnectorRegistryError).issues.join(' ')).toContain("'fixture'");
    }
  });

  test('an unsafe id or a missing schema fails at registration', () => {
    expect(() => new ConnectorRegistry([{ ...fixtureManifest(), id: 'Not Safe' }])).toThrow(ConnectorRegistryError);
    expect(
      () =>
        new ConnectorRegistry([
          { ...fixtureManifest(), actions: [{ ...fixtureManifest().actions[0], inputSchema: undefined as never }] },
        ]),
    ).toThrow(/inputSchema/);
  });

  test('the catalog summary and detail expose events/actions but no secrets', () => {
    const manifest = fixtureManifest();
    expect(providerSummary(manifest)).toEqual({
      id: 'fixture',
      label: 'Fixture',
      version: '1.0.0',
      events: [{ key: 'thing.created', label: 'Thing created' }],
      actions: [{ key: 'do_thing', label: 'Do thing' }],
    });
    const detail = providerDetail(manifest);
    expect(detail.credentialFields[0]?.key).toBe('token');
    expect(detail.actions[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
    });
    expect(JSON.stringify(detail)).not.toContain('secret-value');
  });
});
