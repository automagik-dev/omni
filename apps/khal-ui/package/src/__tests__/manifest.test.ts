import { describe, expect, test } from 'bun:test';
import { validateManifest } from '@khal-os/types';
import manifest from '../../../khal-app.json';

describe('khal-app.json manifest', () => {
  test('validates against @khal-os/types validateManifest', () => {
    const result = validateManifest(manifest);
    expect(result.id).toBe('omni-admin');
    expect(result.kind).toBe('app');
    expect(result.name).toBe('Omni Admin');
  });

  test('declares the bun BFF service with a tcp health check on 8899', () => {
    const result = validateManifest(manifest);
    const service = result.services?.[0];
    expect(service?.name).toBe('omni-admin-bff');
    expect(service?.runtime).toBe('bun');
    expect(service?.entry).toBe('service/src/index.ts');
    expect(service?.health?.type).toBe('tcp');
    expect(service?.health?.target).toBe(8899);
  });

  test('declares OMNI_API_KEY (secret) and OMNI_BASE_URL env requirements', () => {
    const result = validateManifest(manifest);
    const keys = (result.env ?? []).map((e) => e.key);
    expect(keys).toContain('OMNI_API_KEY');
    expect(keys).toContain('OMNI_BASE_URL');
    expect(result.settings?.secrets).toContain('OMNI_API_KEY');
  });

  test('requests only nats publish/subscribe permissions', () => {
    const result = validateManifest(manifest);
    expect(result.permissions).toEqual(['nats:publish', 'nats:subscribe']);
  });
});
