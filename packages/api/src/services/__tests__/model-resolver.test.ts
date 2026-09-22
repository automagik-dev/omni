/**
 * Tests for catalog-based model-role resolution.
 *
 * The catalogs here are trimmed copies of the real vendor payload shapes:
 * Gemini entries carry `supportedGenerationMethods` (which gates chat/image/
 * video roles), OpenAI entries carry ids and nothing else. The point of every
 * case is that the resolver must either return a name the credential can
 * actually call, or `null` — never a guess.
 */
import { describe, expect, test } from 'bun:test';

import type { CatalogModel } from '../model-catalog';
import { type ModelProvider, type ModelRole, parseVersion, resolveModel } from '../model-resolver';

/** Build a Gemini catalog entry with declared methods. */
function gemini(id: string, methods: string[] = ['generateContent']): CatalogModel {
  return { id, methods };
}

/** Build an OpenAI catalog entry (no capability metadata is exposed by the vendor). */
function openai(id: string): CatalogModel {
  return { id, methods: [] };
}

const CALLABLE = ['generateContent'];

describe('parseVersion', () => {
  test('reads a dotted generation from a vendor id', () => {
    expect(parseVersion('gemini-3.5-flash-lite')).toEqual([3, 5]);
    expect(parseVersion('gpt-5.6-luna')).toEqual([5, 6]);
    expect(parseVersion('gpt-image-2.5-sunburst')).toEqual([2, 5]);
    expect(parseVersion('veo-3.1-generate-preview')).toEqual([3, 1]);
  });

  test('returns an empty list when the id carries no version', () => {
    expect(parseVersion('gpt-transcribe')).toEqual([]);
    expect(parseVersion('nano-banana')).toEqual([]);
  });

  test('reads a trailing generation when the name has other digits too', () => {
    expect(parseVersion('nano-banana-2')).toEqual([2]);
  });

  test('ignores digits that are not a generation marker', () => {
    // `large-v3` is a size tier inside the name, not the model's generation, so
    // the parser refuses to read it as one rather than inventing an ordering.
    expect(parseVersion('whisper-large-v3-turbo')).toEqual([]);
  });
});

describe('resolveModel — null safety', () => {
  test('returns null for an absent or empty catalog instead of guessing', () => {
    expect(resolveModel(null, 'gemini', 'chat-fast')).toBeNull();
    expect(resolveModel([], 'openai', 'chat-fast')).toBeNull();
  });

  test('returns null when no catalog entry serves the role', () => {
    expect(resolveModel([openai('gpt-image-2.5-sunburst')], 'openai', 'tts')).toBeNull();
    expect(resolveModel([gemini('gemini-3.5-flash-lite')], 'gemini', 'music')).toBeNull();
  });
});

describe('resolveModel — Gemini roles', () => {
  const catalog = [
    gemini('gemini-3-flash-preview'),
    gemini('gemini-3.5-flash-lite'),
    gemini('gemini-3.5-flash'),
    gemini('gemini-3.5-flash-lite-preview'),
    gemini('gemini-3.8-flash'),
    gemini('gemini-flash-lite-latest'),
    gemini('gemini-3.1-flash-tts-preview'),
    gemini('gemini-3.1-flash-image', CALLABLE),
    gemini('lyria-3.5', CALLABLE),
    gemini('lyria-realtime-exp', ['bidiGenerateMusic']),
    gemini('veo-3.1-generate-preview', ['predictLongRunning']),
  ];

  test('chat-fast picks the cheapest stable tier, not the newest flagship', () => {
    // `lite` wins because a one-word routing decision has a low quality floor and
    // is paid per message; generation is the tiebreak only among same-tier names.
    expect(resolveModel(catalog, 'gemini', 'chat-fast')?.model).toBe('gemini-3.5-flash-lite');
  });

  test('a moveable alias never wins automatic resolution', () => {
    const withAlias = [gemini('gemini-flash-lite-latest'), gemini('gemini-3.5-flash-lite')];
    expect(resolveModel(withAlias, 'gemini', 'chat-fast')?.model).toBe('gemini-3.5-flash-lite');
    // and an alias alone is still usable rather than a dead end
    expect(resolveModel([gemini('gemini-flash-lite-latest')], 'gemini', 'chat-fast')?.model).toBe(
      'gemini-flash-lite-latest',
    );
  });

  test('a preview-only generation never wins', () => {
    const previewsOnly = [gemini('gemini-3.5-flash-lite-preview'), gemini('gemini-3.1-flash-lite')];
    expect(resolveModel(previewsOnly, 'gemini', 'chat-fast')?.model).toBe('gemini-3.1-flash-lite');
  });

  test('image, music and video resolve to their own families, not to chat models', () => {
    expect(resolveModel(catalog, 'gemini', 'image')?.model).toBe('gemini-3.1-flash-image');
    expect(resolveModel(catalog, 'gemini', 'music')?.model).toBe('lyria-3.5');
    expect(resolveModel(catalog, 'gemini', 'video')?.model).toBe('veo-3.1-generate-preview');
  });

  test('a general role never returns a Lyria or Veo id', () => {
    const only = [gemini('lyria-3.5', CALLABLE), gemini('veo-3.1-generate-preview', ['predictLongRunning'])];
    expect(resolveModel(only, 'gemini', 'chat-fast')).toBeNull();
    expect(resolveModel(only, 'gemini', 'vision')).toBeNull();
  });

  test('a model that does not declare generateContent is not offered for chat', () => {
    const declareNothing = [{ id: 'gemini-9.9-flash-lite', methods: ['predict'] }];
    expect(resolveModel(declareNothing, 'gemini', 'chat-fast')).toBeNull();
  });

  test('an experimental Lyria is not chosen over the stable one', () => {
    // Both carry the fragment; only the stable id may serve a production lane.
    expect(resolveModel(catalog, 'gemini', 'music')?.model).toBe('lyria-3.5');
  });
});

describe('resolveModel — OpenAI roles', () => {
  const catalog = [
    openai('gpt-5.6-luna'),
    openai('gpt-5.6-mini'),
    openai('gpt-6.1-nano'),
    openai('gpt-5.6-luna-preview'),
    openai('gpt-4o-mini-tts'),
    openai('gpt-transcribe'),
    openai('gpt-4o-transcribe'),
    openai('whisper-1'),
    openai('gpt-image-2.5-sunburst'),
    openai('gpt-image-2'),
    openai('sora-2'),
    openai('gpt-audio-mini'),
    openai('text-embedding-3-large'),
  ];

  test('the general text roles are not resolved from ids alone', () => {
    // `/v1/models` exposes no capability metadata, so a live id like
    // `gpt-6-astra` is not evidence that a lane can be served by it. These roles
    // keep the shipped constant or the operator's explicit setting rather than
    // guessing a capability from a name.
    for (const role of ['chat-fast', 'chat', 'vision'] as ModelRole[]) {
      expect(resolveModel(catalog, 'openai', role)).toBeNull();
    }
  });

  test('a preview build never wins over a stable model of the same family', () => {
    const gated = [openai('gpt-6-transcribe-preview'), openai('gpt-5-transcribe')];
    expect(resolveModel(gated, 'openai', 'transcribe')?.model).toBe('gpt-5-transcribe');
  });

  test('a moveable alias never wins over a concrete name', () => {
    const withAlias = [openai('gpt-image-latest'), openai('gpt-image-2')];
    expect(resolveModel(withAlias, 'openai', 'image')?.model).toBe('gpt-image-2');
  });

  test('tts only accepts the -tts family', () => {
    expect(resolveModel(catalog, 'openai', 'tts')?.model).toBe('gpt-4o-mini-tts');
    expect(resolveModel([openai('gpt-audio-1.5')], 'openai', 'tts')).toBeNull();
  });

  test('transcribe accepts transcribe and whisper families, preferring the newest', () => {
    expect(resolveModel(catalog, 'openai', 'transcribe')?.model).toBe('gpt-transcribe');
  });

  test('image resolves to the gpt-image family, never to sora', () => {
    expect(resolveModel(catalog, 'openai', 'image')?.model).toBe('gpt-image-2.5-sunburst');
    expect(resolveModel([openai('sora-2')], 'openai', 'image')).toBeNull();
  });

  test('a chat role never returns a tts, image, audio or transcribe model', () => {
    const onlyAudioish = [
      openai('gpt-4o-mini-tts'),
      openai('gpt-image-2.5-sunburst'),
      openai('gpt-audio-mini'),
      openai('gpt-transcribe'),
    ];
    expect(resolveModel(onlyAudioish, 'openai', 'chat')).toBeNull();
  });

  test('OpenAI exposes no music or video role', () => {
    expect(resolveModel(catalog, 'openai', 'music')).toBeNull();
    expect(resolveModel(catalog, 'openai', 'video')).toBeNull();
  });
});

describe('resolveModel — determinism and provenance', () => {
  test('reports the provider, role and catalog provenance', () => {
    const resolved = resolveModel([openai('gpt-image-2')], 'openai', 'image');
    expect(resolved).toEqual({
      model: 'gpt-image-2',
      role: 'image',
      provider: 'openai',
      source: 'catalog',
    });
  });

  test('the same catalog in a different order yields the same model', () => {
    const a = [openai('gpt-image-2'), openai('gpt-image-2.5-sunburst'), openai('gpt-image-1')];
    const b = [...a].reverse();
    expect(resolveModel(a, 'openai', 'image')?.model).toBe(resolveModel(b, 'openai', 'image')?.model);
  });

  test('resolution is a pure function of the catalog (same input, same output)', () => {
    const catalog = [gemini('gemini-3.5-flash-lite'), gemini('gemini-3.1-flash-lite')];
    const roles: ModelRole[] = ['chat-fast', 'vision', 'transcribe'];
    const providers: ModelProvider[] = ['gemini'];
    for (const role of roles) {
      for (const provider of providers) {
        expect(resolveModel(catalog, provider, role)?.model).toBe(resolveModel(catalog, provider, role)?.model);
      }
    }
  });
});
