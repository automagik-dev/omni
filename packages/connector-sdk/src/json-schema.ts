/**
 * Action input schema -> JSON Schema, for the provider catalog.
 *
 * `zodToJsonSchema` is already a core dependency (the event schema registry
 * uses it); connectors reuse it rather than hand-writing a second renderer.
 * `$refStrategy: 'none'` inlines everything so the published artifact is
 * self-contained.
 */

import { zodToJsonSchema } from 'zod-to-json-schema';
import type { ConnectorManifest, ConnectorProviderDetail, ConnectorProviderSummary } from './types';

export function inputSchemaJson(schema: Parameters<typeof zodToJsonSchema>[0]): Record<string, unknown> {
  return zodToJsonSchema(schema, { $refStrategy: 'none', target: 'openApi3' }) as Record<string, unknown>;
}

export function providerSummary(manifest: ConnectorManifest): ConnectorProviderSummary {
  return {
    id: manifest.id,
    label: manifest.label,
    version: manifest.version,
    events: manifest.events.map((event) => ({ key: event.key, label: event.label })),
    actions: manifest.actions.map((action) => ({ key: action.key, label: action.label })),
  };
}

export function providerDetail(manifest: ConnectorManifest): ConnectorProviderDetail {
  return {
    ...providerSummary(manifest),
    credentialFields: manifest.credentialFields,
    events: manifest.events.map((event) => ({
      key: event.key,
      label: event.label,
      ...(event.sample ? { sample: event.sample } : {}),
    })),
    actions: manifest.actions.map((action) => ({
      key: action.key,
      label: action.label,
      ...(action.description ? { description: action.description } : {}),
      inputSchema: inputSchemaJson(action.inputSchema),
    })),
    guide: manifest.guide,
  };
}
