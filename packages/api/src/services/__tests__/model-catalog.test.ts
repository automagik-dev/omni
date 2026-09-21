/**
 * Tests for the vendor model-catalog readers.
 *
 * Every reader is total by contract: the caller's behaviour is "fall back to the
 * pinned constant", so a network, HTTP or parse failure must return `null` and
 * must never throw. These cases pin that, plus the payload details that the
 * resolver depends on (Gemini's `models/` prefix and `supportedGenerationMethods`,
 * OpenAI's bare `data[].id`).
 *
 * The transport is injected, so nothing here touches the network.
 */
import { describe, expect, test } from 'bun:test';

import { fetchGeminiCatalog, fetchOpenAiCatalog } from '../model-catalog';

/** Build a stub transport that answers each call with the next queued payload. */
function stubFetch(responses: Array<{ status?: number; body: unknown }>): {
  calls: string[];
  impl: typeof fetch;
} {
  const calls: string[] = [];
  let index = 0;
  const impl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const next = responses[Math.min(index, responses.length - 1)];
    index += 1;
    const status = next?.status ?? 200;
    return new Response(JSON.stringify(next?.body ?? {}), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe('fetchGeminiCatalog', () => {
  const page = {
    models: [
      { name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/veo-3.1-generate-preview', supportedGenerationMethods: ['predictLongRunning'] },
    ],
  };

  test('strips the models/ prefix and keeps the declared methods', async () => {
    const { impl } = stubFetch([{ body: page }]);
    const catalog = await fetchGeminiCatalog('key', { fetchImpl: impl });

    expect(catalog).toEqual([
      { id: 'gemini-3.5-flash-lite', methods: ['generateContent'] },
      { id: 'veo-3.1-generate-preview', methods: ['predictLongRunning'] },
    ]);
  });

  test('follows nextPageToken and concatenates every page', async () => {
    const { calls, impl } = stubFetch([
      { body: { models: [{ name: 'models/gemini-3.5-flash' }], nextPageToken: 'PAGE-2' } },
      { body: { models: [{ name: 'models/gemini-3.8-flash' }] } },
    ]);

    const catalog = await fetchGeminiCatalog('key', { fetchImpl: impl });

    expect(catalog?.map((m) => m.id)).toEqual(['gemini-3.5-flash', 'gemini-3.8-flash']);
    expect(calls).toHaveLength(2);
    expect(calls[1]).toContain('pageToken=PAGE-2');
  });

  test('sends the key as a query parameter and the page size', async () => {
    const { calls, impl } = stubFetch([{ body: { models: [] } }]);
    await fetchGeminiCatalog('secret-key', { fetchImpl: impl });

    expect(calls[0]).toContain('key=secret-key');
    expect(calls[0]).toContain('pageSize=');
  });

  test('an absent key returns null without calling the vendor', async () => {
    const { calls, impl } = stubFetch([{ body: page }]);
    expect(await fetchGeminiCatalog(undefined, { fetchImpl: impl })).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test('an HTTP error returns null instead of throwing', async () => {
    const { impl } = stubFetch([{ status: 403, body: { error: 'denied' } }]);
    expect(await fetchGeminiCatalog('key', { fetchImpl: impl })).toBeNull();
  });

  test('a transport failure returns null instead of throwing', async () => {
    const impl = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await fetchGeminiCatalog('key', { fetchImpl: impl })).toBeNull();
  });

  test('an unrecognised payload yields an empty catalog, not a crash', async () => {
    const { impl } = stubFetch([{ body: { unexpected: true } }]);
    expect(await fetchGeminiCatalog('key', { fetchImpl: impl })).toEqual([]);
  });
});

describe('fetchOpenAiCatalog', () => {
  test('reads ids from data[] and reports no methods (the vendor sends none)', async () => {
    const { impl } = stubFetch([{ body: { data: [{ id: 'gpt-transcribe' }, { id: 'gpt-image-2.5-sunburst' }] } }]);
    const catalog = await fetchOpenAiCatalog('key', { fetchImpl: impl });

    expect(catalog).toEqual([
      { id: 'gpt-transcribe', methods: [] },
      { id: 'gpt-image-2.5-sunburst', methods: [] },
    ]);
  });

  test('drops entries with no id and de-duplicates', async () => {
    const { impl } = stubFetch([{ body: { data: [{ id: 'gpt-image-2' }, {}, { id: 'gpt-image-2' }, { id: '' }] } }]);
    expect(await fetchOpenAiCatalog('key', { fetchImpl: impl })).toEqual([{ id: 'gpt-image-2', methods: [] }]);
  });

  test('an HTTP error returns null instead of throwing', async () => {
    const { impl } = stubFetch([{ status: 500, body: {} }]);
    expect(await fetchOpenAiCatalog('key', { fetchImpl: impl })).toBeNull();
  });

  test('an absent key returns null', async () => {
    expect(await fetchOpenAiCatalog(undefined, {})).toBeNull();
  });
});
