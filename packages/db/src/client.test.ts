/**
 * Tests for DB client TLS configuration (verify-full via CA bundle).
 */

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveSslConfig } from './client';

const FAKE_PEM = '-----BEGIN CERTIFICATE-----\nMIIFake\n-----END CERTIFICATE-----\n';

const dir = mkdtempSync(join(tmpdir(), 'omni-db-tls-'));
const caPath = join(dir, 'ca-bundle.pem');
writeFileSync(caPath, FAKE_PEM);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('resolveSslConfig', () => {
  test('returns undefined when no CA file is configured', () => {
    expect(resolveSslConfig(undefined, {})).toBeUndefined();
  });

  test('reads the bundle and enforces verification when passed explicitly', () => {
    const ssl = resolveSslConfig(caPath, {});
    expect(ssl).toEqual({ ca: FAKE_PEM, rejectUnauthorized: true });
  });

  test('falls back to DATABASE_SSL_CA_FILE from the environment', () => {
    const ssl = resolveSslConfig(undefined, { DATABASE_SSL_CA_FILE: caPath });
    expect(ssl?.ca).toBe(FAKE_PEM);
    expect(ssl?.rejectUnauthorized).toBe(true);
  });

  test('ignores ambient libpq PGSSLROOTCERT (would force TLS onto sslmode=disable setups)', () => {
    expect(resolveSslConfig(undefined, { PGSSLROOTCERT: caPath })).toBeUndefined();
  });

  test('treats an empty DATABASE_SSL_CA_FILE as unset', () => {
    expect(resolveSslConfig(undefined, { DATABASE_SSL_CA_FILE: '' })).toBeUndefined();
    expect(resolveSslConfig('', { DATABASE_SSL_CA_FILE: caPath })?.ca).toBe(FAKE_PEM);
  });

  test('explicit config wins over environment', () => {
    const otherPath = join(dir, 'other.pem');
    writeFileSync(otherPath, 'other');
    const ssl = resolveSslConfig(caPath, { DATABASE_SSL_CA_FILE: otherPath });
    expect(ssl?.ca).toBe(FAKE_PEM);
  });

  test('throws when the configured bundle path does not exist (fail fast, not silent downgrade)', () => {
    expect(() => resolveSslConfig(join(dir, 'missing.pem'), {})).toThrow();
  });
});
