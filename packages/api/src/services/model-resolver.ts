/**
 * Model-role resolution against a live vendor catalog.
 *
 * A "role" is what the platform needs a model to do (`chat-fast`, `transcribe`,
 * `tts`, `image`, `music`, `video`, `vision`). This module answers, for a given
 * provider and role, which model from the vendor's *current* catalog serves it
 * — so versions stop being hand-edited the moment a vendor ships a new
 * generation. A pinned constant in `models.ts` remains the source of the
 * fallback: when the catalog is unreachable or holds no candidate, resolution
 * returns `null` and the caller keeps its existing default.
 *
 * The resolver is pure and synchronous: the caller fetches the catalog once
 * (`model-catalog.ts`) and passes it in, so a decision is testable without a
 * network and the same catalog can serve many roles in one request.
 *
 * NOT provider-agnostic on purpose: OpenAI reports no capability metadata, so
 * its candidates are matched by name pattern; Gemini reports
 * `supportedGenerationMethods`, which gates chat/image/video roles. Encoding
 * both rules here keeps the "which model is newest" question in one place.
 */

import type { CatalogModel } from './model-catalog';

/** Capabilities the platform resolves a model for. */
export type ModelRole = 'chat-fast' | 'chat' | 'transcribe' | 'tts' | 'image' | 'music' | 'video' | 'vision';

/** Vendors whose catalogs this resolver understands. */
export type ModelProvider = 'gemini' | 'openai';

/** Where a resolved id came from, so callers can log the difference. */
export type ResolutionSource = 'catalog' | 'none';

export interface ResolvedModel {
  readonly model: string;
  readonly role: ModelRole;
  readonly provider: ModelProvider;
  readonly source: ResolutionSource;
}

/** Gemini families that are a line of their own, never a general fallback. */
const GEMINI_SPECIAL_FAMILIES = ['lyria', 'veo', 'embedding', 'embed', 'aqa', 'imagen', 'gemma'];

/**
 * Extract the leading numeric version from an id (`gemini-3.5-flash-lite` →
 * `[3, 5]`). Vendor ids put the generation up front, so this is the primary sort
 * key; ids without a version sort below any versioned id, never above.
 */
export function parseVersion(id: string): number[] {
  const match = id.match(/(?:^|[-_/])(\d+(?:\.\d+)*)(?=[-_/.]|$)/);
  const captured = match?.[1];
  if (!captured) return [];
  return captured
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * Compare two version arrays for "newest first".
 *
 * A longer array with an equal prefix is NEWER (`[2,5]` beats `[2]`), so the
 * `undefined` case must invert: the array that still has a component left is the
 * higher version. Short-circuiting the comparison here is what makes
 * `gpt-image-2.5-*` beat `gpt-image-2` regardless of id length.
 */
function compareVersionDesc(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left === undefined) return 1;
    if (right === undefined) return -1;
    if (left !== right) return right - left;
  }
  return 0;
}

/** Suffixes that make an id a narrower variant of its family rather than its base. */
const VARIANT_SUFFIX_TOKENS = ['turbo', 'diarize', 'mini', 'lite', 'nano', 'hd', 'flash', 'pro', 'max', 'fast'];

/** True when the id carries a suffix that narrows it inside its own family. */
function isVariantId(id: string): boolean {
  const tokens = idTokens(id);
  const last = tokens.at(-1) ?? '';
  return VARIANT_SUFFIX_TOKENS.includes(last);
}

/**
 * Rank an id by how its NAME relates to a version string, best first:
 *
 * * `0` — no version and no narrowing suffix: the family's current base form
 *   (`gpt-transcribe`), so it supersedes older versioned names.
 * * `1` — carries a version (`whisper-1`, `gemini-3.8-flash`): ordered by the
 *   version itself.
 * * `2` — no version but a narrowing suffix (`whisper-large-v3-turbo`): a variant
 *   of some unnamed base, so it must not outrank a concrete versioned name.
 *
 * This is what makes `gpt-transcribe` beat `whisper-1` while
 * `whisper-large-v3-turbo` stays behind both, using only signals the catalog
 * actually provides.
 */
function nameTier(id: string, version: readonly number[]): number {
  if (version.length > 0) return 1;
  return isVariantId(id) ? 2 : 0;
}

/** Split an id into `-`-delimited tokens, for exact marker matching. */
function idTokens(id: string): string[] {
  return id
    .toLowerCase()
    .split(/[-_/]+/)
    .filter((token) => token.length > 0);
}

/**
 * Markers that disqualify a candidate outright: no production lane should be
 * served by an experimental or retired build. `preview` is deliberately absent —
 * see {@link previewTier}.
 */
const REJECTED_TOKENS = ['exp', 'experimental', 'deprecated', 'legacy', 'alpha', 'beta'];

/** True when the id carries a marker that rules it out of every lane. */
function isRejected(id: string): boolean {
  const tokens = idTokens(id);
  return REJECTED_TOKENS.some((token) => tokens.includes(token));
}

/**
 * Ranking tier for gated releases: 0 = stable, 1 = preview.
 *
 * `preview` is a preference rather than a rejection because its meaning is
 * family-dependent. For some families the gated name IS the current production
 * model (`veo-3.1-generate-preview`); for others it marks the superseded
 * generation of a family that now ships stable (`gemini-3-flash-preview` behind
 * `gemini-3.5-flash-lite`). Ranking stable first while still allowing a preview
 * when no stable member of the family exists is the only rule that gets both
 * right, and it needs no hand-maintained exception list.
 */
function previewTier(id: string): number {
  return idTokens(id).includes('preview') ? 1 : 0;
}

/**
 * Ranking tier for vendor ALIASES: 1 for ids that are a moveable pointer to
 * "whatever is current" (`gemini-flash-lite-latest`), 0 otherwise.
 *
 * An alias must never win automatic resolution. Its whole purpose is to change
 * under the operator, so pinning it into a lane would silently move that lane to
 * a new model — the opposite of the predictability this resolver exists to give.
 */
function aliasTier(id: string): number {
  return idTokens(id).includes('latest') ? 1 : 0;
}

/** A scored candidate: tiebreak vector plus the role-independent ordering keys. */
interface Candidate {
  readonly id: string;
  /** 0 real name, 1 moveable alias — lower wins. */
  readonly alias: number;
  /** 0 stable, 1 preview — lower wins. */
  readonly tier: number;
  /** 0 base name, 1 versioned, 2 unversioned variant — lower wins. */
  readonly name: number;
  /** Parsed generation; `[]` means the vendor dropped the version marker. */
  readonly version: readonly number[];
  /** Role-specific preference, compared ascending, lower wins; absent = worst. */
  readonly extra: readonly number[];
}

/**
 * Order candidates best-first. The sequence is deliberate:
 *
 * 1. a real name before a moveable alias;
 * 2. stable before preview (a gated build must not win on version alone);
 * 3. for a cheap-tier role, the cheaper tier first;
 * 4. then the newest generation;
 * 5. then the role's own preference;
 * 6. then the SHORTEST id, then lexicographic — a pure determinism tiebreak.
 *    Sibling variants of one generation (`gpt-image-2.5-flare` vs
 *    `gpt-image-2.5-sunburst`) carry no comparable version, and the vendor
 *    publishes no quality ranking, so they cannot honestly be ordered by
 *    capability. This step makes the pick stable and reproducible instead of
 *    dependent on catalog order; an operator who wants a specific sibling pins it
 *    through the role's own setting.
 *
 * @param cheapFirst - true for latency-sensitive classification roles, where the
 * cheapest adequate tier beats a newer flagship. A one-word routing decision has
 * a low quality floor and pays its cost per message, so `flash-lite`/`mini` is
 * the right answer even when a newer full-size build exists.
 */
function compareCandidateDesc(a: Candidate, b: Candidate, cheapFirst: boolean): number {
  if (a.alias !== b.alias) return a.alias - b.alias;
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.name !== b.name) return a.name - b.name;

  const byExtra = compareExtraAsc(a.extra, b.extra);
  const byVersion = compareVersionDesc(a.version, b.version);

  if (cheapFirst) {
    if (byExtra !== 0) return byExtra;
    if (byVersion !== 0) return byVersion;
  } else {
    if (byVersion !== 0) return byVersion;
    if (byExtra !== 0) return byExtra;
  }

  if (a.id.length !== b.id.length) return a.id.length - b.id.length;
  return a.id.localeCompare(b.id);
}

/** Compare preference vectors ascending; a missing entry sorts worst. */
function compareExtraAsc(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const left = a[i] ?? Number.POSITIVE_INFINITY;
    const right = b[i] ?? Number.POSITIVE_INFINITY;
    if (left !== right) return left - right;
  }
  return 0;
}

/** True when the model declares the given generation method. */
function hasMethod(model: CatalogModel, method: string): boolean {
  // An empty method list means "vendor reports nothing" (OpenAI); never exclude on it.
  if (model.methods.length === 0) return true;
  return model.methods.includes(method);
}

/**
 * OpenAI role → id pattern, or `null` where the name does NOT determine the
 * capability.
 *
 * `GET /v1/models` reports ids only — no capability metadata, no modality list.
 * So for the general text roles the name is not evidence: `gpt-6-astra` is a live
 * id with nothing in it that says whether it can serve vision, and picking a
 * flagship for the one-word gate purely because it outranks a cheaper tier is
 * exactly the mistake this resolver must not make. Those roles return `null` and
 * the caller keeps its shipped constant or the operator's explicit setting.
 *
 * `transcribe`, `tts` and `image` are different: the id names the endpoint it
 * serves, so the match is verifiable from the catalog alone.
 *
 * Hyphens are part of the character class, because vendor names are multi-token
 * (`gpt-image-2.5-sunburst`) and a pattern stopping at the first hyphen would
 * silently drop the current model; `transcribe` matches its family by substring so
 * `gpt-transcribe`, `gpt-4o-transcribe` and `gpt-4o-transcribe-diarize` all land.
 */
const OPENAI_ROLE_PATTERNS: Record<ModelRole, RegExp | null> = {
  'chat-fast': null,
  chat: null,
  transcribe: /^(?:gpt-[\w.-]*transcribe[\w.-]*|whisper-[\w.-]+)$/,
  tts: /-tts$/,
  image: /^gpt-image-[\w.-]+$/,
  music: null,
  video: null,
  vision: null,
};

/**
 * OpenAI has no role preference vector, because no role it can resolve needs one:
 * the cheap-tier preference (`mini`/`lite`) matters for classification, and the
 * text roles are deliberately unresolved on OpenAI.
 */

/** Pick the best OpenAI model for a role, or `null` when nothing matches. */
function resolveOpenAi(catalog: readonly CatalogModel[], role: ModelRole): string | null {
  const pattern = OPENAI_ROLE_PATTERNS[role];
  if (!pattern) return null;

  const scored: Candidate[] = [];

  for (const model of catalog) {
    const id = model.id;
    if (isRejected(id)) continue;
    if (!pattern.test(id)) continue;
    scored.push({
      id,
      alias: aliasTier(id),
      tier: previewTier(id),
      name: nameTier(id, parseVersion(id)),
      version: parseVersion(id),
      extra: [],
    });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => compareCandidateDesc(a, b, role === 'chat-fast'));
  return scored[0]?.id ?? null;
}

/** Gemini role → name fragment that must appear in the id. */
/**
 * Gemini role → id fragment.
 *
 * `music` maps to `lyria` and `video` to `veo` because those are lines of their
 * own with no chat counterpart; `image` needs `image` (both `gemini-*-image` and
 * `nano-banana-*` carry it, and the alias `nano-banana-pro-preview` would other-
 * wise be unreachable).
 */
const GEMINI_ROLE_FRAGMENT: Record<ModelRole, string | null> = {
  'chat-fast': 'flash',
  chat: 'flash',
  transcribe: 'transcribe',
  tts: 'tts',
  image: 'image',
  music: 'lyria',
  video: 'veo',
  vision: 'flash',
};

/**
 * Gemini role → the generation method the vendor must advertise.
 *
 * Taken from the live catalog rather than assumed: Veo serves only through
 * `predictLongRunning`, and the embedding lines advertise `embedContent`.
 *
 * `music` is deliberately `null`. Lyria does not use one method across its line:
 * `lyria-3.5` (GA) advertises `generateContent` while only `lyria-realtime-exp`
 * advertises `bidiGenerateMusic`, so filtering on a method would exclude the
 * stable model in favour of the experimental one. Ranking handles this instead,
 * because `exp` is already rejected outright.
 */
const GEMINI_ROLE_METHOD: Record<ModelRole, string | null> = {
  'chat-fast': 'generateContent',
  chat: 'generateContent',
  transcribe: 'generateContent',
  tts: 'generateContent',
  image: 'generateContent',
  music: null,
  video: 'predictLongRunning',
  vision: 'generateContent',
};

/**
 * Gemini fragments that are never a general-purpose chat model.
 *
 * `flash` alone is too loose to identify a chat model —
 * `gemini-3.1-flash-tts-preview` and `gemini-3.1-flash-image` both contain it —
 * so the chat-style roles exclude these whole families rather than trusting the
 * role fragment by itself.
 */
const GEMINI_NON_CHAT_FRAGMENTS = [...GEMINI_SPECIAL_FAMILIES, 'tts', 'image'];

/**
 * Gemini preference vector. Only `chat-fast` carries one: for a one-word routing
 * decision the `lite` tier is the right purchase, since the decision has a low
 * quality floor and is paid per message. Every other role buys capability and
 * sorts on generation instead.
 */
function geminiExtra(role: ModelRole, id: string): number[] {
  if (role !== 'chat-fast') return [];
  return [idTokens(id).includes('lite') ? 0 : 1];
}

/**
 * Pick the best Gemini model for a role, or `null` when nothing matches.
 *
 * Chat-style roles exclude {@link GEMINI_NON_CHAT_FRAGMENTS} so an audio or image
 * model can never answer a text request; the specialist roles (music, video,
 * image, tts) reach their family through their own fragment.
 */
function resolveGemini(catalog: readonly CatalogModel[], role: ModelRole): string | null {
  const fragment = GEMINI_ROLE_FRAGMENT[role];
  if (!fragment) return null;

  const requiredMethod = GEMINI_ROLE_METHOD[role];
  const isChatStyle = role === 'chat-fast' || role === 'chat' || role === 'vision' || role === 'transcribe';
  const scored: Candidate[] = [];

  for (const model of catalog) {
    const lower = model.id.toLowerCase();
    if (!lower.includes(fragment)) continue;
    if (isRejected(model.id)) continue;
    if (isChatStyle && GEMINI_NON_CHAT_FRAGMENTS.some((family) => lower.includes(family))) continue;
    if (requiredMethod && !hasMethod(model, requiredMethod)) continue;
    scored.push({
      id: model.id,
      alias: aliasTier(model.id),
      tier: previewTier(model.id),
      name: nameTier(model.id, parseVersion(model.id)),
      version: parseVersion(model.id),
      extra: geminiExtra(role, model.id),
    });
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => compareCandidateDesc(a, b, role === 'chat-fast'));
  return scored[0]?.id ?? null;
}

/**
 * Resolve a role to a concrete model id from a live catalog.
 *
 * Returns `null` — never a guess — when the catalog is absent or holds no
 * candidate, so the caller falls back to its pinned constant instead of sending
 * an unverified name to a vendor.
 */
export function resolveModel(
  catalog: readonly CatalogModel[] | null,
  provider: ModelProvider,
  role: ModelRole,
): ResolvedModel | null {
  if (!catalog || catalog.length === 0) return null;

  const model = provider === 'openai' ? resolveOpenAi(catalog, role) : resolveGemini(catalog, role);
  if (!model) return null;

  return { model, role, provider, source: 'catalog' };
}
