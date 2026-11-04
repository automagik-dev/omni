/**
 * Second-provider guard (design Success Criteria, abandonment criterion 1).
 *
 * Adding a provider must not require an edit to the channel enum, the action
 * enum's vendor content, the scope table, the generic connector routes,
 * OpenAPI paths, the SDK unions or the CLI command group. This suite proves it
 * two ways:
 *
 *   1. a second, synthetic manifest registers and renders through the same
 *      registry/catalog without touching any of those files;
 *   2. a grep guard over the protected files finds no vendor name at all.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clickupManifest } from '@omni/connector-clickup';
import { ConnectorRegistry, providerDetail } from '@omni/connector-sdk';
import { ACTION_TYPES, CHANNEL_TYPES, CONNECTOR_EVENT_TYPE } from '@omni/core';
import { z } from 'zod';

const REPO_ROOT = join(import.meta.dir, '../../../..');

const PROTECTED_FILES = [
  'packages/core/src/types/channel.ts',
  'packages/core/src/automations/types.ts',
  'packages/api/src/constants/scopes.ts',
  'packages/api/src/routes/v2/connectors.ts',
  'packages/api/src/schemas/connectors.ts',
  'packages/api/src/schemas/openapi/connectors.ts',
  'packages/sdk/src/client.ts',
  'packages/cli/src/commands/connectors.ts',
];

function secondProviderManifest() {
  return {
    id: 'fixture-provider',
    label: 'Fixture Provider',
    version: '0.1.0',
    credentialFields: [{ key: 'apiKey', label: 'API key', secret: true }],
    configSchema: z.object({}).strict(),
    async validate() {
      return { ok: true as const, account: 'fixture' };
    },
    events: [{ key: 'item.created', label: 'Item created' }],
    actions: [
      {
        key: 'create_item',
        label: 'Create item',
        inputSchema: z.object({ title: z.string() }).strict(),
        async run() {
          return { id: 'item-1' };
        },
      },
    ],
    verification: { kind: 'hmac-sha256' as const, header: 'X-Fixture-Signature', encoding: 'hex' as const },
    guide: { connect: 'Fixture guide' },
  };
}

describe('a second provider needs no edit outside its own manifest package', () => {
  test('the same registry and catalog render a synthetic second manifest', () => {
    const registry = new ConnectorRegistry([clickupManifest, secondProviderManifest()]);
    expect(registry.assertValid()).toEqual([]);
    expect(registry.list().map((manifest) => manifest.id)).toEqual(['clickup', 'fixture-provider']);
    const detail = providerDetail(registry.get('fixture-provider') as never);
    expect(detail.actions[0]?.inputSchema).toMatchObject({
      type: 'object',
      properties: { title: { type: 'string' } },
    });
    expect(detail.events.map((event) => event.key)).toEqual(['item.created']);
  });

  test('exactly one connector action type exists and no vendor is named in it', () => {
    const connectorActions = ACTION_TYPES.filter((type) => type.includes('connector'));
    expect(connectorActions).toEqual(['connector.call']);
    expect(ACTION_TYPES.join(' ')).not.toMatch(/clickup|github|jira|linear|notion/i);
    expect(CONNECTOR_EVENT_TYPE).toBe('connector.event');
  });

  test('the channel enum is unchanged and contains no connector provider', () => {
    expect(CHANNEL_TYPES.join(' ')).not.toMatch(/clickup|connector/i);
    expect(CHANNEL_TYPES).toContain('slack');
    expect(CHANNEL_TYPES).toContain('whatsapp-baileys');
  });

  test('no protected file mentions a provider name', () => {
    for (const file of PROTECTED_FILES) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf-8');
      expect(`${file}: ${/clickup|github|jira|linear|notion/i.test(source) ? 'vendor name found' : 'clean'}`).toBe(
        `${file}: clean`,
      );
    }
  });
});
