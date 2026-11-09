import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { ZenviaClient } from '../client';
import { ZenviaPlugin } from '../plugin';
import { ZenviaApiError } from '../utils/errors';
import type { HostResolver } from '../utils/public-host';
import {
  API_TOKEN,
  MockEventBus,
  SENDER_ID,
  VERIFY_TOKEN,
  createContext,
  instanceId,
  jsonResponse,
  publicHostResolver,
} from './helpers';

const PUBLIC_V4 = '93.184.216.34';
const PUBLIC_V6 = '2606:4700:4700::1111';

function resolving(map: Record<string, string[]>): HostResolver & { calls: string[] } {
  const calls: string[] = [];
  const resolver = async (hostname: string) => {
    calls.push(hostname);
    return (map[hostname] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return Object.assign(resolver, { calls });
}

function clientWith(resolveHost: HostResolver): ZenviaClient {
  return new ZenviaClient({ apiToken: API_TOKEN, resolveHost });
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

async function rejection(promise: Promise<unknown>): Promise<ZenviaApiError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ZenviaApiError) return err;
    throw err;
  }
  throw new Error('expected the download to be refused');
}

describe('ZenviaClient.downloadFile destination check', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  describe.each([
    ['IPv4 loopback', '127.0.0.1'],
    ['IPv4 loopback range', '127.8.9.10'],
    ['unspecified IPv4', '0.0.0.0'],
    ['private 10/8', '10.0.0.5'],
    ['private 172.16/12', '172.16.4.1'],
    ['private 192.168/16', '192.168.1.20'],
    ['link-local and cloud metadata', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['IPv4 multicast', '224.0.0.251'],
    ['IPv6 loopback', '::1'],
    ['unspecified IPv6', '::'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique local fc00', 'fc00::1'],
    ['IPv6 unique local fd00', 'fd12:3456::1'],
    ['IPv6 multicast', 'ff02::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped private', '::ffff:10.0.0.1'],
    ['IPv4-mapped metadata in hex form', '::ffff:a9fe:a9fe'],
    ['IPv4-mapped public address', `::ffff:${PUBLIC_V4}`],
  ])('a host that resolves to %s', (_label, address) => {
    it('is refused before any request is made', async () => {
      const fetchSpy = spyOn(globalThis, 'fetch');
      const client = clientWith(resolving({ 'files.example.org': [address] }));

      const error = await rejection(client.downloadFile('https://files.example.org/a.ogg'));

      expect(error.channelCode).toBe('ZENVIA_INVALID_REQUEST');
      expect(error.message).toMatch(/non-public/);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it('is refused when only one of several resolved addresses is not public', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch');
    const client = clientWith(resolving({ 'files.example.org': [PUBLIC_V4, PUBLIC_V6, '10.1.2.3'] }));

    const error = await rejection(client.downloadFile('https://files.example.org/a.ogg'));

    expect(error.channelCode).toBe('ZENVIA_INVALID_REQUEST');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not name the resolved address in the error', async () => {
    const client = clientWith(resolving({ 'files.example.org': ['10.1.2.3'] }));
    const error = await rejection(client.downloadFile('https://files.example.org/a.ogg'));
    expect(error.message).not.toContain('10.1.2.3');
  });

  it('downloads from a host whose addresses are all public, IPv4 and IPv6', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('abc'));
    const client = clientWith(resolving({ 'files.example.org': [PUBLIC_V4, PUBLIC_V6] }));

    const res = await client.downloadFile('https://files.example.org/a.ogg');

    expect(await res.text()).toBe('abc');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('resolves the lower-cased host of the URL', async () => {
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('abc'));
    const resolver = resolving({ 'files.example.org': [PUBLIC_V4] });

    await clientWith(resolver).downloadFile('https://Files.Example.ORG/a.ogg');

    expect(resolver.calls).toEqual(['files.example.org']);
  });

  it('checks the destination again on every redirect hop, before requesting it', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValueOnce(redirectTo('https://rebound.example.org/b.ogg'));
    const resolver = resolving({ 'files.example.org': [PUBLIC_V4], 'rebound.example.org': ['192.168.0.10'] });

    const error = await rejection(clientWith(resolver).downloadFile('https://files.example.org/a.ogg'));

    expect(error.channelCode).toBe('ZENVIA_INVALID_REQUEST');
    expect(resolver.calls).toEqual(['files.example.org', 'rebound.example.org']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to another public host', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://cdn.example.org/b.ogg'))
      .mockResolvedValueOnce(new Response('abc'));
    const resolver = resolving({ 'files.example.org': [PUBLIC_V4], 'cdn.example.org': [PUBLIC_V6] });

    const res = await clientWith(resolver).downloadFile('https://files.example.org/a.ogg');

    expect(await res.text()).toBe('abc');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('treats a host that does not resolve as a transient upstream failure', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch');
    const failing: HostResolver = async () => {
      throw new Error('ENOTFOUND');
    };

    const unresolved = await rejection(clientWith(failing).downloadFile('https://files.example.org/a.ogg'));
    const empty = await rejection(clientWith(resolving({})).downloadFile('https://files.example.org/a.ogg'));

    expect(unresolved.channelCode).toBe('ZENVIA_UPSTREAM_ERROR');
    expect(unresolved.retryable).toBe(true);
    expect(empty.channelCode).toBe('ZENVIA_UPSTREAM_ERROR');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still refuses non-https URLs and address hosts without resolving anything', async () => {
    const resolver = resolving({ 'files.example.org': [PUBLIC_V4] });
    const client = clientWith(resolver);

    await expect(client.downloadFile('http://files.example.org/a.ogg')).rejects.toThrow(/https/);
    await expect(client.downloadFile('https://127.0.0.1/a.ogg')).rejects.toThrow(/address host/);
    await expect(client.downloadFile('https://[::1]/a.ogg')).rejects.toThrow(/address host/);
    await expect(client.downloadFile('https://2130706433/a.ogg')).rejects.toThrow(/address host/);
    await expect(client.downloadFile('https://localhost/a.ogg')).rejects.toThrow(/address host/);

    expect(resolver.calls).toEqual([]);
  });

  it('sends the token only to Zenvia hosts, whatever the check says', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://cdn.example.org/b.ogg'))
      .mockResolvedValueOnce(new Response('abc'));
    const resolver = resolving({ 'files.zenvia.com': [PUBLIC_V4], 'cdn.example.org': [PUBLIC_V4] });

    await clientWith(resolver).downloadFile('https://files.zenvia.com/a.ogg');

    const headers = fetchSpy.mock.calls.map((call) => (call[1] as RequestInit | undefined)?.headers);
    expect(headers[0]).toMatchObject({ 'X-API-TOKEN': API_TOKEN });
    expect(headers[1]).not.toHaveProperty('X-API-TOKEN');
  });
});

describe('ZenviaPlugin.downloadInboundMedia destination check', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  async function connectedWith(resolver: HostResolver): Promise<ZenviaPlugin> {
    const plugin = new ZenviaPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    plugin.hostResolver = resolver;
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
    await plugin.connect(instanceId, {
      instanceId,
      credentials: { zenviaApiToken: API_TOKEN, zenviaSenderId: SENDER_ID, webhookVerifyToken: VERIFY_TOKEN },
    });
    return plugin;
  }

  it('refuses a file whose host resolves to a private address, without requesting it', async () => {
    const plugin = await connectedWith(async () => [{ address: '10.0.0.7', family: 4 }]);
    const fetchSpy = spyOn(globalThis, 'fetch');
    const before = fetchSpy.mock.calls.length;

    await expect(plugin.downloadInboundMedia(instanceId, 'https://files.example.org/a.ogg')).rejects.toThrow(
      /non-public/,
    );

    expect(fetchSpy.mock.calls.length).toBe(before);
  });

  it('downloads a file whose host resolves to a public address', async () => {
    const plugin = await connectedWith(publicHostResolver);
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('abc', { headers: { 'content-type': 'audio/ogg' } }));

    const file = await plugin.downloadInboundMedia(instanceId, 'https://files.example.org/a.ogg');

    expect(file.buffer.toString()).toBe('abc');
  });
});
