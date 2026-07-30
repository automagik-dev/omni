/**
 * TenantEgressBroker behaviour (wish: omni-full-multitenancy, Group G5;
 * ADR-0009).
 *
 * The policy suite proves the DECISION for every rejection class; this suite
 * proves the broker never even CONNECTS to a rejected destination (against a
 * real loopback listener that counts connections), and that the fetch mechanics
 * — per-redirect revalidation, DNS-rebinding denial, credential stripping,
 * bounded redirects/body, audited decisions without secrets, and the dual-world
 * passthrough — behave as specified. Reject tests use real local listeners;
 * accept/mechanics tests inject the transport so no approved public host is
 * needed (an approved host can never be loopback — that is the point).
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { createServer } from 'node:net';
import {
  type AddressLookup,
  type EgressAuditRecord,
  EgressBlockedError,
  type EgressContext,
  EgressLimitError,
  type EgressTransport,
  TenantEgressBroker,
  brokeredFetch,
  setEgressPolicyResolver,
} from '../broker';
import type { EgressPolicy } from '../policy';

const CONTEXT: EgressContext = { tenantId: 't-1', actorCredentialId: 'cred-9', integration: 'test.integration' };

/** A resolver that maps every host to `address` — the rebinding test lever. */
function resolverTo(address: string): AddressLookup {
  return async () => [{ address }];
}

/** A transport that records calls and returns a caller-supplied Response. */
function stubTransport(handler: (url: string, init: RequestInit) => Response): {
  transport: EgressTransport;
  calls: Array<{ url: string; init: RequestInit }>;
} {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const transport: EgressTransport = async (url, init) => {
    calls.push({ url, init });
    return handler(url, init);
  };
  return { transport, calls };
}

afterEach(() => setEgressPolicyResolver(null));

describe('broker — never connects to a rejected destination (real listener)', () => {
  test('a loopback destination is blocked and the listener receives ZERO connections', async () => {
    let connections = 0;
    const server = createServer((socket) => {
      connections += 1;
      socket.destroy();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    // Approve the literal host so ONLY the reserved-range denial can refuse it.
    const policy: EgressPolicy = { policyVersion: 1, approvedHostSuffixes: ['127.0.0.1'], approvedPorts: [port] };
    const records: EgressAuditRecord[] = [];
    const broker = new TenantEgressBroker({ audit: (r) => records.push(r) });

    await expect(broker.send({ url: `https://127.0.0.1:${port}/` }, policy, CONTEXT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );

    // Give any (erroneous) connection a tick to land, then assert none did.
    await new Promise((r) => setTimeout(r, 20));
    expect(connections).toBe(0);
    expect(records.at(-1)?.destinationClass).toBe('loopback');
    expect(records.at(-1)?.outcome).toBe('blocked');
    server.close();
  });
});

describe('broker — DNS rebinding and per-hop revalidation', () => {
  const policy: EgressPolicy = { policyVersion: 5, approvedHostSuffixes: ['approved.example'] };

  test('an approved host that RESOLVES to a private address is blocked before connect', async () => {
    const { transport, calls } = stubTransport(() => new Response('should not happen'));
    const broker = new TenantEgressBroker({ resolveAddresses: resolverTo('10.0.0.5'), transport });
    await expect(broker.send({ url: 'https://approved.example/' }, policy, CONTEXT)).rejects.toMatchObject({
      destinationClass: 'private-rfc1918',
    });
    expect(calls.length).toBe(0); // never reached the transport
  });

  test('a numeric-leading HOSTNAME (not an IP literal) is still DNS-revalidated', async () => {
    // `123.example.com` starts with digits but is a name; it must be resolved
    // and its addresses classified, so a rebind to a private address is caught.
    const numericPolicy: EgressPolicy = { policyVersion: 1, approvedHostSuffixes: ['example.com'] };
    const { transport, calls } = stubTransport(() => new Response('should not happen'));
    const broker = new TenantEgressBroker({ resolveAddresses: resolverTo('10.9.8.7'), transport });
    await expect(broker.send({ url: 'https://123.example.com/' }, numericPolicy, CONTEXT)).rejects.toMatchObject({
      destinationClass: 'private-rfc1918',
    });
    expect(calls.length).toBe(0);
  });

  test('a redirect to a loopback host is revalidated and blocked mid-chain', async () => {
    const { transport, calls } = stubTransport((url) => {
      if (url.startsWith('https://approved.example')) {
        return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/' } });
      }
      return new Response('reached internal');
    });
    const broker = new TenantEgressBroker({ resolveAddresses: resolverTo('93.184.216.34'), transport });
    await expect(broker.send({ url: 'https://approved.example/' }, policy, CONTEXT)).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
    // The first hop was sent; the redirect target was refused before a second.
    expect(calls.map((c) => c.url)).toEqual(['https://approved.example/']);
  });

  test('a public resolution is allowed and reaches the transport once', async () => {
    const { transport, calls } = stubTransport(() => new Response('ok', { status: 200 }));
    const records: EgressAuditRecord[] = [];
    const broker = new TenantEgressBroker({
      resolveAddresses: resolverTo('93.184.216.34'),
      transport,
      audit: (r) => records.push(r),
    });
    const res = await broker.send({ url: 'https://approved.example/hook' }, policy, CONTEXT);
    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
    expect(records.at(-1)).toMatchObject({ outcome: 'allowed', destinationClass: 'approved-public', policyVersion: 5 });
  });
});

describe('broker — credential handling and bounds', () => {
  const policy: EgressPolicy = { policyVersion: 1, approvedHostSuffixes: ['approved.example', 'other.example'] };

  test('authorization is dropped on a cross-origin redirect', async () => {
    const seen: Array<string | null> = [];
    const { transport } = stubTransport((url, init) => {
      seen.push(new Headers(init.headers).get('authorization'));
      if (url.startsWith('https://approved.example')) {
        return new Response(null, { status: 302, headers: { location: 'https://other.example/' } });
      }
      return new Response('ok');
    });
    const broker = new TenantEgressBroker({ resolveAddresses: resolverTo('93.184.216.34'), transport });
    await broker.send(
      { url: 'https://approved.example/', headers: { authorization: 'Bearer secret-token' } },
      policy,
      CONTEXT,
    );
    expect(seen[0]).toBe('Bearer secret-token'); // sent to the original host
    expect(seen[1]).toBeNull(); // stripped for the cross-origin hop
  });

  test('all credential headers are dropped on a cross-origin redirect but kept same-origin', async () => {
    const seen: Array<{ authorization: string | null; cookie: string | null; proxyAuth: string | null }> = [];
    const { transport } = stubTransport((url, init) => {
      const h = new Headers(init.headers);
      seen.push({
        authorization: h.get('authorization'),
        cookie: h.get('cookie'),
        proxyAuth: h.get('proxy-authorization'),
      });
      // First a same-origin hop (path change), then a cross-origin hop.
      if (url === 'https://approved.example/') {
        return new Response(null, { status: 302, headers: { location: 'https://approved.example/step2' } });
      }
      if (url === 'https://approved.example/step2') {
        return new Response(null, { status: 302, headers: { location: 'https://other.example/' } });
      }
      return new Response('ok');
    });
    const broker = new TenantEgressBroker({ resolveAddresses: resolverTo('93.184.216.34'), transport });
    await broker.send(
      {
        url: 'https://approved.example/',
        headers: {
          authorization: 'Bearer secret-token',
          cookie: 'session=abc',
          'proxy-authorization': 'Basic proxy-secret',
        },
      },
      policy,
      CONTEXT,
    );
    // Hop 0 (original) and hop 1 (same-origin) keep every credential header.
    expect(seen[0]).toEqual({
      authorization: 'Bearer secret-token',
      cookie: 'session=abc',
      proxyAuth: 'Basic proxy-secret',
    });
    expect(seen[1]).toEqual({
      authorization: 'Bearer secret-token',
      cookie: 'session=abc',
      proxyAuth: 'Basic proxy-secret',
    });
    // Hop 2 is cross-origin: authorization, cookie, and proxy-authorization all dropped.
    expect(seen[2]).toEqual({ authorization: null, cookie: null, proxyAuth: null });
  });

  test('too many redirects raises a limit error', async () => {
    const { transport } = stubTransport(
      (_url) => new Response(null, { status: 302, headers: { location: 'https://approved.example/next' } }),
    );
    const broker = new TenantEgressBroker({
      resolveAddresses: resolverTo('93.184.216.34'),
      transport,
      limits: { maxRedirects: 2 },
    });
    await expect(broker.send({ url: 'https://approved.example/' }, policy, CONTEXT)).rejects.toBeInstanceOf(
      EgressLimitError,
    );
  });

  test('a response whose declared length exceeds the cap is refused', async () => {
    const { transport } = stubTransport(
      () => new Response('x', { status: 200, headers: { 'content-length': String(50 * 1024 * 1024) } }),
    );
    const broker = new TenantEgressBroker({ resolveAddresses: resolverTo('93.184.216.34'), transport });
    await expect(broker.send({ url: 'https://approved.example/' }, policy, CONTEXT)).rejects.toBeInstanceOf(
      EgressLimitError,
    );
  });

  test('readBounded refuses a stream that exceeds the cap', async () => {
    const big = new Uint8Array(1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 100; i++) controller.enqueue(big);
        controller.close();
      },
    });
    const broker = new TenantEgressBroker({ limits: { maxResponseBytes: 4096 } });
    await expect(broker.readBounded(new Response(body))).rejects.toBeInstanceOf(EgressLimitError);
  });
});

describe('broker — audit record carries no secrets', () => {
  test('the record has the tenant/actor/integration/class/outcome and only a bare host', async () => {
    const { transport } = stubTransport(() => new Response('ok', { status: 200 }));
    const records: EgressAuditRecord[] = [];
    const broker = new TenantEgressBroker({
      resolveAddresses: resolverTo('93.184.216.34'),
      transport,
      audit: (r) => records.push(r),
    });
    const policy: EgressPolicy = { policyVersion: 3, approvedHostSuffixes: ['approved.example'] };
    await broker.send(
      { url: 'https://approved.example/path/to/hook?token=SUPER_SECRET', headers: { authorization: 'Bearer SECRET' } },
      policy,
      CONTEXT,
    );
    const rec = records.at(-1) as EgressAuditRecord;
    expect(rec.tenantId).toBe('t-1');
    expect(rec.actorCredentialId).toBe('cred-9');
    expect(rec.integration).toBe('test.integration');
    expect(rec.host).toBe('approved.example');
    // No field of the record carries the query token, path, or the auth header.
    const serialized = JSON.stringify(rec);
    expect(serialized).not.toContain('SUPER_SECRET');
    expect(serialized).not.toContain('SECRET');
    expect(serialized).not.toContain('/path/to/hook');
  });
});

describe('brokeredFetch — dual world', () => {
  test('with no policy resolver registered it is a byte-identical passthrough', async () => {
    // No resolver → passthrough → uses the global fetch verbatim. Mock global
    // fetch to observe the exact forwarded init and prove no broker mangling.
    const originalFetch = globalThis.fetch;
    const seen: Array<{ input: unknown; init: RequestInit | undefined }> = [];
    globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
      seen.push({ input, init });
      return new Response('legacy', { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const res = await brokeredFetch('https://anything.internal/x', {
        method: 'POST',
        headers: { authorization: 'Bearer legacy' },
        egress: CONTEXT,
      });
      expect(await res.text()).toBe('legacy');
      expect(seen.length).toBe(1);
      expect(seen[0]?.input).toBe('https://anything.internal/x');
      // The `egress` marker is stripped; everything else is forwarded verbatim.
      expect(seen[0]?.init?.method).toBe('POST');
      expect(new Headers(seen[0]?.init?.headers).get('authorization')).toBe('Bearer legacy');
      expect('egress' in (seen[0]?.init ?? {})).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('with a resolver binding a default-deny policy, a disallowed host is blocked', async () => {
    setEgressPolicyResolver(() => ({ policyVersion: 2, approvedHostSuffixes: ['only-this.example'] }));
    const originalFetch = globalThis.fetch;
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response('should not happen');
    }) as unknown as typeof fetch;
    try {
      await expect(brokeredFetch('https://evil.example/', { egress: CONTEXT })).rejects.toBeInstanceOf(
        EgressBlockedError,
      );
      // Default-deny miss is decided before any transport call.
      expect(called).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('a resolver that throws fails CLOSED (denies), never passes through', async () => {
    setEgressPolicyResolver(() => {
      throw new Error('policy store unavailable');
    });
    await expect(brokeredFetch('https://anything.example/', { egress: CONTEXT })).rejects.toBeInstanceOf(
      EgressBlockedError,
    );
  });
});
