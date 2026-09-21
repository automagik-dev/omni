import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_GATE_MODEL_GEMINI,
  DEFAULT_GATE_MODEL_OPENAI,
  DEFAULT_GATE_PROVIDER,
  DEFAULT_OPENAI_BASE_URL,
  GATE_MAX_TOKENS,
  type GateSettingsReader,
  callGeminiGate,
  callOpenAiGate,
  resolveGateModel,
  resolveGateProvider,
  runGateCall,
} from './response-gate';

type FakeSettings = {
  settings: GateSettingsReader;
  urls: string[];
  bodies: Array<Record<string, unknown>>;
};

function fakeSettings(values: Record<string, string> = {}): FakeSettings {
  const urls: string[] = [];
  const bodies: Array<Record<string, unknown>> = [];
  const settings: GateSettingsReader = {
    getSecret: async (key) => values[key],
    getString: async (key, _env, defaultValue) => values[key] ?? defaultValue,
  };
  return { settings, urls, bodies };
}

/** Stubs global fetch, recording each request. */
function stubFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
    } as unknown as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe('resolveGateProvider', () => {
  it('defaults to gemini when unset', async () => {
    const { settings } = fakeSettings();
    expect(await resolveGateProvider(settings)).toBe(DEFAULT_GATE_PROVIDER);
  });

  it('selects openai case-insensitively', async () => {
    const { settings } = fakeSettings({ 'gate.provider': ' OpenAI ' });
    expect(await resolveGateProvider(settings)).toBe('openai');
  });

  it('falls back to gemini for an unknown provider', async () => {
    const { settings } = fakeSettings({ 'gate.provider': 'anthropic' });
    expect(await resolveGateProvider(settings)).toBe('gemini');
  });
});

describe('resolveGateModel', () => {
  it('prefers the instance override over settings and defaults', async () => {
    const { settings } = fakeSettings({ 'gate.openai.model': 'gpt-other' });
    expect(await resolveGateModel('openai', 'instance-model', settings)).toBe('instance-model');
  });

  it('uses the per-provider setting when there is no instance override', async () => {
    const { settings } = fakeSettings({ 'gate.openai.model': 'gpt-other' });
    expect(await resolveGateModel('openai', null, settings)).toBe('gpt-other');
  });

  it('falls back to the per-provider code default', async () => {
    const { settings } = fakeSettings();
    expect(await resolveGateModel('openai', null, settings)).toBe(DEFAULT_GATE_MODEL_OPENAI);
    expect(await resolveGateModel('gemini', null, settings)).toBe(DEFAULT_GATE_MODEL_GEMINI);
  });
});

describe('callGeminiGate', () => {
  it('parses the first candidate text and lowercases it', async () => {
    const stub = stubFetch({ candidates: [{ content: { parts: [{ text: ' SKIP ' }] } }] });
    try {
      const { settings } = fakeSettings({ 'gemini.api_key': 'gem-key' });
      const result = await callGeminiGate('prompt', 'gemini-3.5-flash-lite', settings, new AbortController().signal);
      expect(result).toEqual({ ok: true, answer: 'skip' });
      expect(stub.calls[0]?.url).toContain('/models/gemini-3.5-flash-lite:generateContent');
      expect(String(stub.calls[0]?.url)).toContain('key=gem-key');
      expect(stub.calls[0]?.body).toMatchObject({
        generationConfig: { maxOutputTokens: GATE_MAX_TOKENS, temperature: 0 },
      });
    } finally {
      stub.restore();
    }
  });

  it('fails open without a key and never calls the API', async () => {
    const stub = stubFetch({});
    try {
      const { settings } = fakeSettings();
      const result = await callGeminiGate('prompt', 'gemini-3.5-flash-lite', settings, new AbortController().signal);
      expect(result).toEqual({ ok: false, reason: 'missing_key' });
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });

  it('reports an HTTP error with its status', async () => {
    const stub = stubFetch({ error: { code: 404 } }, 404);
    try {
      const { settings } = fakeSettings({ 'gemini.api_key': 'gem-key' });
      const result = await callGeminiGate('prompt', 'gemini-nope', settings, new AbortController().signal);
      expect(result).toEqual({ ok: false, reason: 'http_error', status: 404 });
    } finally {
      stub.restore();
    }
  });
});

describe('callOpenAiGate', () => {
  it('sends max_completion_tokens (not max_tokens) and parses the answer', async () => {
    const stub = stubFetch({ choices: [{ message: { content: 'respond' } }] });
    try {
      const { settings } = fakeSettings({ 'openai.api_key': 'oa-key' });
      const result = await callOpenAiGate('prompt', 'gpt-5.6-luna', settings, new AbortController().signal);
      expect(result).toEqual({ ok: true, answer: 'respond' });
      expect(stub.calls[0]?.url).toBe(`${DEFAULT_OPENAI_BASE_URL}/chat/completions`);
      expect(stub.calls[0]?.body).toMatchObject({
        model: 'gpt-5.6-luna',
        max_completion_tokens: GATE_MAX_TOKENS,
        temperature: 0,
      });
      expect(stub.calls[0]?.body).not.toHaveProperty('max_tokens');
    } finally {
      stub.restore();
    }
  });

  it('honors an OpenAI-compatible base URL override', async () => {
    const stub = stubFetch({ choices: [{ message: { content: 'skip' } }] });
    try {
      const { settings } = fakeSettings({
        'openai.api_key': 'oa-key',
        'gate.openai.base_url': 'https://llm.example.test/v1/',
      });
      const result = await callOpenAiGate('prompt', 'gpt-5.6-luna', settings, new AbortController().signal);
      expect(result).toEqual({ ok: true, answer: 'skip' });
      expect(stub.calls[0]?.url).toBe('https://llm.example.test/v1/chat/completions');
    } finally {
      stub.restore();
    }
  });

  it('treats a null content (exhausted reasoning budget) as an empty answer', async () => {
    const stub = stubFetch({ choices: [{ message: { content: null }, finish_reason: 'length' }] });
    try {
      const { settings } = fakeSettings({ 'openai.api_key': 'oa-key' });
      const result = await callOpenAiGate('prompt', 'gpt-5.6-luna', settings, new AbortController().signal);
      expect(result).toEqual({ ok: true, answer: '' });
    } finally {
      stub.restore();
    }
  });

  it('fails open without a key', async () => {
    const stub = stubFetch({});
    try {
      const { settings } = fakeSettings();
      const result = await callOpenAiGate('prompt', 'gpt-5.6-luna', settings, new AbortController().signal);
      expect(result).toEqual({ ok: false, reason: 'missing_key' });
      expect(stub.calls).toHaveLength(0);
    } finally {
      stub.restore();
    }
  });
});

describe('runGateCall', () => {
  it('dispatches to the selected provider', async () => {
    const stub = stubFetch({ candidates: [{ content: { parts: [{ text: 'respond' }] } }] });
    try {
      const { settings } = fakeSettings({ 'gemini.api_key': 'gem-key', 'openai.api_key': 'oa-key' });
      expect(await runGateCall('gemini', 'p', 'gemini-3.5-flash-lite', settings)).toEqual({
        ok: true,
        answer: 'respond',
      });
      expect(stub.calls[0]?.url).toContain('generativelanguage.googleapis.com');
    } finally {
      stub.restore();
    }
  });

  it('maps an aborted call to a timeout result', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      return await new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as unknown as typeof fetch;

    try {
      const { settings } = fakeSettings({ 'gemini.api_key': 'gem-key' });
      const result = await runGateCall('gemini', 'p', 'gemini-3.5-flash-lite', settings, 10);
      expect(result).toEqual({ ok: false, reason: 'timeout' });
    } finally {
      globalThis.fetch = original;
    }
  });
});
