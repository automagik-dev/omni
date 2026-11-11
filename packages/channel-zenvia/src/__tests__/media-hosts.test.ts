import { afterEach, describe, expect, it, spyOn } from 'bun:test';

import { ZenviaClient } from '../client';
import { ZenviaPlugin } from '../plugin';
import { ZenviaApiError } from '../utils/errors';
import type { HostResolver } from '../utils/public-host';
import { API_TOKEN, MockEventBus, SENDER_ID, VERIFY_TOKEN, createContext, instanceId, jsonResponse } from './helpers';

const PUBLIC_V4 = '93.184.216.34';

function resolving(map: Record<string, string[]>): HostResolver & { calls: string[] } {
  const calls: string[] = [];
  const resolver = async (hostname: string) => {
    calls.push(hostname);
    return (map[hostname] ?? []).map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return Object.assign(resolver, { calls });
}

function clientWith(resolveHost: HostResolver, mediaHosts?: readonly string[]): ZenviaClient {
  return new ZenviaClient({ apiToken: API_TOKEN, resolveHost, mediaHosts });
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

describe('ZenviaClient.downloadFile media host list', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  it('refuses a host outside the list before resolving or requesting it', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    const resolver = resolving({ 'files.example.org': [PUBLIC_V4] });

    const error = await rejection(clientWith(resolver, ['zenvia.com']).downloadFile('https://files.example.org/a.ogg'));

    expect(error.channelCode).toBe('ZENVIA_INVALID_REQUEST');
    expect(error.message).toMatch(/zenviaMediaHosts/);
    expect(resolver.calls).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a listed host and its subdomains', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('a'))
      .mockResolvedValueOnce(new Response('b'));
    const resolver = resolving({ 'zenvia.com': [PUBLIC_V4], 'files.zenvia.com': [PUBLIC_V4] });
    const client = clientWith(resolver, ['zenvia.com']);

    expect(await (await client.downloadFile('https://zenvia.com/a.ogg')).text()).toBe('a');
    expect(await (await client.downloadFile('https://Files.Zenvia.COM/b.ogg')).text()).toBe('b');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('matches on a label boundary, not on a bare suffix', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    const resolver = resolving({ 'evilzenvia.com': [PUBLIC_V4], 'zenvia.com.example.org': [PUBLIC_V4] });
    const client = clientWith(resolver, ['zenvia.com']);

    await expect(client.downloadFile('https://evilzenvia.com/a.ogg')).rejects.toThrow(/zenviaMediaHosts/);
    await expect(client.downloadFile('https://zenvia.com.example.org/a.ogg')).rejects.toThrow(/zenviaMediaHosts/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a redirect to a host outside the list before requesting it', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://cdn.example.org/b.ogg'))
      .mockResolvedValue(new Response('leaked'));
    const resolver = resolving({ 'files.zenvia.com': [PUBLIC_V4], 'cdn.example.org': [PUBLIC_V4] });

    const error = await rejection(clientWith(resolver, ['zenvia.com']).downloadFile('https://files.zenvia.com/a.ogg'));

    expect(error.channelCode).toBe('ZENVIA_INVALID_REQUEST');
    expect(error.message).toMatch(/zenviaMediaHosts/);
    expect(resolver.calls).toEqual(['files.zenvia.com']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to another listed host', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://cdn.example.org/b.ogg'))
      .mockResolvedValueOnce(new Response('abc'));
    const resolver = resolving({ 'files.zenvia.com': [PUBLIC_V4], 'cdn.example.org': [PUBLIC_V4] });

    const res = await clientWith(resolver, ['zenvia.com', 'cdn.example.org']).downloadFile(
      'https://files.zenvia.com/a.ogg',
    );

    expect(await res.text()).toBe('abc');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('still refuses a listed host that resolves to a non-public address', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    const resolver = resolving({ 'files.zenvia.com': ['10.0.0.8'] });

    const error = await rejection(clientWith(resolver, ['zenvia.com']).downloadFile('https://files.zenvia.com/a.ogg'));

    expect(error.message).toMatch(/non-public/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    ['no list', undefined],
    ['an empty list', []],
  ])('with %s, downloads from any public host as before', async (_label, mediaHosts) => {
    const fetchSpy = spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(redirectTo('https://cdn.example.net/b.ogg'))
      .mockResolvedValueOnce(new Response('abc'));
    const resolver = resolving({ 'files.example.org': [PUBLIC_V4], 'cdn.example.net': [PUBLIC_V4] });

    const res = await clientWith(resolver, mediaHosts).downloadFile('https://files.example.org/a.ogg');

    expect(await res.text()).toBe('abc');
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe('ZenviaPlugin zenviaMediaHosts', () => {
  afterEach(() => {
    spyOn(globalThis, 'fetch').mockRestore();
  });

  async function connectedWith(options: Record<string, unknown>): Promise<ZenviaPlugin> {
    const plugin = new ZenviaPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    plugin.hostResolver = async () => [{ address: PUBLIC_V4, family: 4 }];
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse([]));
    await plugin.connect(instanceId, {
      instanceId,
      credentials: { zenviaApiToken: API_TOKEN, zenviaSenderId: SENDER_ID, webhookVerifyToken: VERIFY_TOKEN },
      options,
    });
    return plugin;
  }

  it('refuses a file outside the configured list, without requesting it', async () => {
    const plugin = await connectedWith({ zenviaMediaHosts: ['zenvia.com'] });
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));
    const before = fetchSpy.mock.calls.length;

    await expect(plugin.downloadInboundMedia(instanceId, 'https://files.example.org/a.ogg')).rejects.toThrow(
      /zenviaMediaHosts/,
    );

    expect(fetchSpy.mock.calls.length).toBe(before);
  });

  it('downloads a file from a configured host', async () => {
    const plugin = await connectedWith({ zenviaMediaHosts: ['zenvia.com'] });
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('abc', { headers: { 'content-type': 'audio/ogg' } }));

    const file = await plugin.downloadInboundMedia(instanceId, 'https://files.zenvia.com/a.ogg');

    expect(file.buffer.toString()).toBe('abc');
  });

  it.each([
    ['absent', {}],
    ['empty', { zenviaMediaHosts: [] }],
    ['null', { zenviaMediaHosts: null }],
  ])('when %s, downloads from any public host', async (_label, options) => {
    const plugin = await connectedWith(options);
    spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('abc', { headers: { 'content-type': 'audio/ogg' } }));

    const file = await plugin.downloadInboundMedia(instanceId, 'https://cdn.example.net/a.ogg');

    expect(file.buffer.toString()).toBe('abc');
  });

  it.each([
    ['a scheme', ['https://zenvia.com']],
    ['a path', ['zenvia.com/files']],
    ['a port', ['zenvia.com:443']],
    ['a wildcard', ['*.zenvia.com']],
    ['an IP address', ['10.0.0.1']],
    ['a single label', ['localhost']],
    ['a non-string entry', [42]],
    ['a non-list value', 'zenvia.com'],
  ])('refuses to connect with %s in the list', async (_label, zenviaMediaHosts) => {
    const plugin = new ZenviaPlugin();
    await plugin.initialize(createContext(new MockEventBus()));
    const fetchSpy = spyOn(globalThis, 'fetch').mockResolvedValue(jsonResponse([]));

    await expect(
      plugin.connect(instanceId, {
        instanceId,
        credentials: { zenviaApiToken: API_TOKEN, zenviaSenderId: SENDER_ID, webhookVerifyToken: VERIFY_TOKEN },
        options: { zenviaMediaHosts },
      }),
    ).rejects.toThrow(/zenviaMediaHosts is invalid/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
