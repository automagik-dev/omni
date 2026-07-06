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
import type { S3BackendConfig } from '../config';
import { S3MediaBackend } from '../s3-backend';
import type { S3CredentialProvider, StsCredentials } from '../web-identity';

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
  return {
    accessKeyId: `ASIA-${sessionToken}`,
    secretAccessKey: `secret-${sessionToken}`,
    sessionToken,
    expiration: new Date(Date.now() + 3600_000),
  };
}

/** Deterministic provider: yields whatever `produce` currently returns. */
class FakeProvider implements S3CredentialProvider {
  readonly source = 'web-identity' as const;
  calls = 0;

  constructor(private readonly produce: () => StsCredentials) {}

  async getCredentials(): Promise<StsCredentials> {
    this.calls++;
    return this.produce();
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
});
