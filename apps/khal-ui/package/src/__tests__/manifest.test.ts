import { describe, expect, test } from 'bun:test';
import { validateManifest } from '@khal-os/types';
import manifest from '../../../khal-app.json';
import { ALLOWED_SCOPES, DEFAULT_SCOPE, resolveScope } from '../scope';

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

  // Omni's NATS bus is internal to Omni: the pack talks to the Omni backend
  // over HTTP/SSE via its BFF and never connects to KHAL's NATS. Declaring
  // nats:* would be a false claim on the host, so the manifest declares none.
  test('requests no host permissions (never touches KHAL NATS)', () => {
    const result = validateManifest(manifest);
    expect(result.permissions ?? []).toEqual([]);
    expect(JSON.stringify(manifest)).not.toContain('nats:');
  });

  test('declares scopes the pack actually honours', () => {
    const result = validateManifest(manifest);
    expect(result.allowedScopes).toEqual(['shared', 'user']);
    expect(result.defaultScope).toBe('shared');
    // The declaration is enforced, not decorative.
    expect(ALLOWED_SCOPES).toEqual(['shared', 'user']);
    expect(DEFAULT_SCOPE).toBe('shared');
    expect(resolveScope(undefined)).toBe('shared');
    expect(resolveScope('user')).toBe('user');
    expect(() => resolveScope('org')).toThrow(/allowedScopes/);
  });
});
