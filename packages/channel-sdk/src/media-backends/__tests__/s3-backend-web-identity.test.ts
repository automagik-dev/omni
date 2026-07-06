/**
 * S3 backend credential wiring in web-identity (IRSA) mode — fully offline.
 *
 * Uses the same `Bun.S3Client` constructor trap as the sibling tests (presign
 * is pure local SigV4 math, so no network is touched) plus an injected fake
 * credential provider. Locks the G-CODE contract:
 *  - web-identity mode builds the client LAZILY with the STS sessionToken and
 *    REBUILDS it when the provider rotates the token (expiry-driven refresh);
 *  - on STS failure it falls back to static keys when they exist, else
 *    surfaces the error;
 *  - static mode without a key pair fails loudly at construction.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { configureLogging, getLogConfig } from '@omni/core';
import type { S3BackendConfig } from '../config';
import { S3MediaBackend } from '../s3-backend';
import { type S3CredentialProvider, SESSION_DURATION_SECONDS, type StsCredentials } from '../web-identity';

/** Swallow + collect everything the logger writes to stdout while `run` executes. */
async function captureStdout(run: () => Promise<void>): Promise<string> {
  const chunks: string[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = original;
  }
  return chunks.join('');
}

const WEB_IDENTITY_CONFIG: S3BackendConfig = {
  endpoint: 'http://minio.internal:9000',
  bucket: 'omni-media',
  region: 'us-east-1',
  credentialSource: 'web-identity',
  webIdentity: {
    tokenFile: '/var/run/secrets/eks.amazonaws.com/serviceaccount/token',
    roleArn: 'arn:aws:iam::123456789012:role/omni-media-irsa',
    stsRegion: 'us-east-1',
  },
  forcePathStyle: true,
  presignTtlSeconds: 3600,
};

function credentials(sessionToken: string): StsCredentials {
  return credentialsAt(sessionToken, new Date(Date.now() + 3600_000));
}

/** Credential with an explicit expiration — for exercising the presign TTL guard. */
function credentialsAt(sessionToken: string, expiration: Date): StsCredentials {
  return {
    accessKeyId: `ASIA-${sessionToken}`,
    secretAccessKey: `secret-${sessionToken}`,
    sessionToken,
    expiration,
  };
}

/**
 * Deterministic provider: `getCredentials` yields whatever `produce` returns;
 * `forceRefresh` yields `produceOnRefresh` (defaults to `produce`). Tracks the
 * two call counts separately so tests can assert a pre-sign refresh happened.
 */
class FakeProvider implements S3CredentialProvider {
  readonly source = 'web-identity' as const;
  calls = 0;
  refreshCalls = 0;

  constructor(
    private readonly produce: () => StsCredentials,
    private readonly produceOnRefresh: () => StsCredentials = produce,
  ) {}

  async getCredentials(): Promise<StsCredentials> {
    this.calls++;
    return this.produce();
  }

  async forceRefresh(): Promise<StsCredentials> {
    this.refreshCalls++;
    return this.produceOnRefresh();
  }
}

type TrappedOptions = { accessKeyId?: string; sessionToken?: string } | undefined;

describe('S3MediaBackend web-identity credential wiring', () => {
  const OriginalS3Client = Bun.S3Client;
  let constructedOptions: TrappedOptions[];

  beforeEach(() => {
    constructedOptions = [];
    // Trap the native S3 client constructor to observe the credentials each
    // client is built with. Cast through unknown: we replace a native class.
    (Bun as unknown as { S3Client: unknown }).S3Client = class extends OriginalS3Client {
      constructor(...args: ConstructorParameters<typeof OriginalS3Client>) {
        constructedOptions.push(args[0] as TrappedOptions);
        super(...args);
      }
    };
  });

  afterEach(() => {
    (Bun as unknown as { S3Client: typeof OriginalS3Client }).S3Client = OriginalS3Client;
  });

  it('builds the client lazily with the STS session token and presigns with it', async () => {
    const provider = new FakeProvider(() => credentials('token-1'));
    const backend = new S3MediaBackend(WEB_IDENTITY_CONFIG, { credentialProvider: provider });

    // No eager client in web-identity mode — credentials do not exist yet.
    expect(constructedOptions).toHaveLength(0);

    const url = await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    expect(constructedOptions).toHaveLength(1);
    expect(constructedOptions[0]?.accessKeyId).toBe('ASIA-token-1');
    expect(constructedOptions[0]?.sessionToken).toBe('token-1');
    expect(url).toContain('X-Amz-Security-Token=');
    expect(url).toContain('X-Amz-Signature=');
  });

  it('rebuilds the client when the session token rotates and reuses it otherwise', async () => {
    let current = credentials('token-1');
    const provider = new FakeProvider(() => current);
    const backend = new S3MediaBackend(WEB_IDENTITY_CONFIG, { credentialProvider: provider });

    await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    // Same token → same client, no rebuild.
    expect(constructedOptions).toHaveLength(1);

    // The provider refreshed (e.g. ≤10 min to expiry) → new sessionToken.
    current = credentials('token-2');
    await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    expect(constructedOptions).toHaveLength(2);
    expect(constructedOptions[1]?.sessionToken).toBe('token-2');
  });

  it('falls back to static keys when the STS exchange fails and they exist', async () => {
    const provider = new FakeProvider(() => {
      throw new Error('sts is down');
    });
    const backend = new S3MediaBackend(
      { ...WEB_IDENTITY_CONFIG, accessKeyId: 'static-access', secretKey: 'static-secret' },
      { credentialProvider: provider },
    );

    const url = await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    expect(constructedOptions).toHaveLength(1);
    expect(constructedOptions[0]?.accessKeyId).toBe('static-access');
    expect(constructedOptions[0]?.sessionToken).toBeUndefined();
    expect(url).not.toContain('X-Amz-Security-Token=');

    // The fallback client is cached — repeated failures do not rebuild it.
    await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    expect(constructedOptions).toHaveLength(1);
    expect(provider.calls).toBe(2);
  });

  it('recovers onto web-identity credentials once STS works again', async () => {
    let stsUp = false;
    const provider = new FakeProvider(() => {
      if (!stsUp) throw new Error('sts is down');
      return credentials('token-1');
    });
    const backend = new S3MediaBackend(
      { ...WEB_IDENTITY_CONFIG, accessKeyId: 'static-access', secretKey: 'static-secret' },
      { credentialProvider: provider },
    );

    await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60); // static fallback
    stsUp = true;
    const url = await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);
    expect(constructedOptions).toHaveLength(2);
    expect(constructedOptions[1]?.sessionToken).toBe('token-1');
    expect(url).toContain('X-Amz-Security-Token=');
  });

  it('surfaces the STS error when no static fallback exists', async () => {
    const provider = new FakeProvider(() => {
      throw new Error('sts is down');
    });
    const backend = new S3MediaBackend(WEB_IDENTITY_CONFIG, { credentialProvider: provider });

    await expect(backend.presignedUrl('inst-1/2026-07/msg-1.png', 60)).rejects.toThrow('sts is down');
    expect(constructedOptions).toHaveLength(0);
  });

  it('fails loudly at construction in static mode without a key pair', () => {
    const { credentialSource: _credentialSource, webIdentity: _webIdentity, ...staticShape } = WEB_IDENTITY_CONFIG;
    expect(() => new S3MediaBackend(staticShape)).toThrow(/static mode requires accessKeyId \+ secretKey/);
  });

  it('refreshes a near-expiry credential before signing so the URL gets its full TTL', async () => {
    const T0 = Date.parse('2026-07-06T00:00:00.000Z');
    const provider = new FakeProvider(
      () => credentialsAt('token-near', new Date(T0 + 30_000)), // only 30s of life left
      () => credentialsAt('token-fresh', new Date(T0 + SESSION_DURATION_SECONDS * 1000)), // full-lifetime refresh
    );
    const backend = new S3MediaBackend(WEB_IDENTITY_CONFIG, { credentialProvider: provider, now: () => T0 });

    const url = await backend.presignedUrl('inst-1/2026-07/msg-1.png', 60);

    // The 30s-of-life credential cannot cover a 60s URL, so a force-refresh runs
    // and the client is built with the fresh credential, which signs the URL.
    expect(provider.refreshCalls).toBe(1);
    expect(constructedOptions).toHaveLength(1);
    expect(constructedOptions[0]?.sessionToken).toBe('token-fresh');
    const params = new URL(url).searchParams;
    expect(params.get('X-Amz-Security-Token')).toBe('token-fresh');
    expect(params.get('X-Amz-Expires')).toBe('60'); // full requested TTL, not clamped
  });

  it('clamps URL expiry to the credential lifetime when the requested TTL exceeds it, warning once', async () => {
    const T0 = Date.parse('2026-07-06T00:00:00.000Z');
    const provider = new FakeProvider(() => credentialsAt('token-1', new Date(T0 + SESSION_DURATION_SECONDS * 1000)));
    const backend = new S3MediaBackend(WEB_IDENTITY_CONFIG, { credentialProvider: provider, now: () => T0 });

    const oversizedTtl = SESSION_DURATION_SECONDS * 2; // longer than any credential can live
    const previous = getLogConfig();
    configureLogging({ level: 'info', modules: '*' }); // make the warn deterministic, env aside
    let firstUrl = '';
    try {
      const output = await captureStdout(async () => {
        firstUrl = await backend.presignedUrl('inst-1/2026-07/msg-1.png', oversizedTtl);
        await backend.presignedUrl('inst-1/2026-07/msg-2.png', oversizedTtl); // second clamp
      });
      // The cap is warned exactly once across repeated clamps, not once per URL.
      const capWarnings = output.split('Presign TTL exceeds temporary-credential lifetime').length - 1;
      expect(capWarnings).toBe(1);
    } finally {
      configureLogging({ level: previous.level, modules: previous.modules });
    }

    // A URL cannot outlive its signing credential: expiry is clamped to the full
    // credential lifetime, never the requested 2x TTL. An unsatisfiable TTL is
    // not chased with a refresh — the healthy credential is signed as-is.
    expect(new URL(firstUrl).searchParams.get('X-Amz-Expires')).toBe(String(SESSION_DURATION_SECONDS));
    expect(provider.refreshCalls).toBe(0);
    expect(constructedOptions[0]?.sessionToken).toBe('token-1');
  });
});
