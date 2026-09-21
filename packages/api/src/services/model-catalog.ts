/**
 * Live model-catalog readers (Gemini + OpenAI).
 *
 * Purpose: stop hand-maintaining model names. The vendor catalog is the only
 * source of truth for what a credential can actually reach, so a capability
 * ("role") is resolved against it by `model-resolver.ts` rather than pinned to
 * a compiled-in constant that rots the moment a vendor ships a new generation.
 *
 * EGRESS — both destinations are compile-time-fixed vendor hosts
 * (`generativelanguage.googleapis.com`, `api.openai.com`) and no tenant input
 * reaches the URL, so both call sites are registered `platform-vendor` in
 * `@omni/core`'s egress registry. A custom OpenAI-compatible base URL is
 * deliberately NOT consulted here: such a gateway proxies the vendor's own
 * model names, and an operator who runs one pins a model explicitly through the
 * `*.model` settings instead of resolving it.
 *
 * Both readers share one transport ({@link defaultFetch}), so the guard's scanner
 * counts a SINGLE site in this file even though two vendors are read. That is why
 * the registry entry records `sites: 1`; adding a third reader that calls the
 * global `fetch` directly would drift the count and fail the guard, which is the
 * intended alarm. A future base-URL override would have to be re-registered as
 * tenant-controlled debt instead of `platform-vendor`.
 *
 * Every reader is total: a network, HTTP or parse failure returns `null` rather
 * than throwing, because the caller's contract is "fall back to the pinned
 * constant", never "fail the request".
 */

/** Gemini model list endpoint (v1beta), paginated with `nextPageToken`. */
const GEMINI_MODELS_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** OpenAI model list endpoint. Host is fixed on purpose — see the egress note above. */
const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';

/** Per-request ceiling for a catalog read. */
const CATALOG_TIMEOUT_MS = 5_000;

/** Gemini page size; the API caps this, so a lower value is never wrong. */
const GEMINI_PAGE_SIZE = 200;

/** Hard stop on pagination, so a misbehaving token cannot loop us. */
const MAX_GEMINI_PAGES = 10;

/**
 * One catalog entry, normalised across vendors.
 *
 * `methods` is populated for Gemini only: `/v1beta/models` reports
 * `supportedGenerationMethods` per model, while OpenAI's `/v1/models` reports
 * ids and nothing else — so OpenAI roles are matched on the name pattern alone.
 */
export interface CatalogModel {
  /** Vendor model id. The `models/` prefix Gemini returns is stripped. */
  readonly id: string;
  /** Gemini `supportedGenerationMethods`; empty when the vendor does not report them. */
  readonly methods: readonly string[];
}

/**
 * The global transport, behind a seam so tests never touch the network.
 *
 * Written as a literal `fetch(` call on purpose. The egress guard's scanner counts
 * literal global calls, so this is what puts this file on the scan and makes its
 * registry entry verifiable — an injected-only `deps.fetchImpl ?? fetch` would
 * leave the file invisible to the guard and its entry would read as stale.
 */
function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, init);
}

/** Injection seam: tests pass a stub, production uses {@link defaultFetch}. */
export interface CatalogDeps {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Read the id from an unknown JSON record without trusting its shape. */
function readId(record: unknown): string | undefined {
  if (typeof record !== 'object' || record === null) return undefined;
  const id = (record as { id?: unknown; name?: unknown }).id ?? (record as { name?: unknown }).name;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Normalise a Gemini `models.list` payload.
 *
 * Gemini returns `name: "models/gemini-3.5-flash-lite"`; the `models/` prefix is
 * dropped so callers compare plain ids across vendors. Entries without a usable
 * name, and duplicates, are dropped.
 */
function parseGeminiCatalog(payload: unknown): CatalogModel[] {
  const raw = (payload as { models?: unknown } | null)?.models;
  if (!Array.isArray(raw)) return [];

  const models: CatalogModel[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const rawId = readId(entry);
    if (!rawId) continue;
    const id = rawId.replace(/^models\//, '');
    if (!id || seen.has(id)) continue;

    const declared = (entry as { supportedGenerationMethods?: unknown }).supportedGenerationMethods;
    const methods = Array.isArray(declared)
      ? declared.filter((method): method is string => typeof method === 'string')
      : [];

    seen.add(id);
    models.push({ id, methods });
  }

  return models;
}

/**
 * Normalise an OpenAI `models.list` payload.
 *
 * OpenAI reports ids only; there is no capability field, so `methods` stays
 * empty and resolution is name-based. A model carrying a `shutdown_date` is
 * still returned — the resolver ranks names, and hiding entries would make a
 * retiring model silently disappear instead of being skipped deliberately.
 */
function parseOpenAiCatalog(payload: unknown): CatalogModel[] {
  const raw = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(raw)) return [];

  const models: CatalogModel[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const id = readId(entry);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, methods: [] });
  }

  return models;
}

/** Read Gemini's catalog, following `nextPageToken`. Returns `null` on any failure. */
export async function fetchGeminiCatalog(
  apiKey: string | undefined,
  deps: CatalogDeps = {},
): Promise<CatalogModel[] | null> {
  if (!apiKey) return null;

  const doFetch = deps.fetchImpl ?? defaultFetch;
  const timeoutMs = deps.timeoutMs ?? CATALOG_TIMEOUT_MS;
  const collected: CatalogModel[] = [];
  let pageToken: string | undefined;

  try {
    for (let page = 0; page < MAX_GEMINI_PAGES; page += 1) {
      const url = new URL(GEMINI_MODELS_URL);
      url.searchParams.set('key', apiKey);
      url.searchParams.set('pageSize', String(GEMINI_PAGE_SIZE));
      if (pageToken) url.searchParams.set('pageToken', pageToken);

      const res = await doFetch(url.toString(), { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return null;

      const payload: unknown = await res.json();
      collected.push(...parseGeminiCatalog(payload));

      const next = (payload as { nextPageToken?: unknown } | null)?.nextPageToken;
      if (typeof next !== 'string' || next.length === 0) break;
      pageToken = next;
    }
  } catch {
    return null;
  }

  return collected;
}

/** Read OpenAI's catalog. Returns `null` on any failure. */
export async function fetchOpenAiCatalog(
  apiKey: string | undefined,
  deps: CatalogDeps = {},
): Promise<CatalogModel[] | null> {
  if (!apiKey) return null;

  const doFetch = deps.fetchImpl ?? defaultFetch;
  const timeoutMs = deps.timeoutMs ?? CATALOG_TIMEOUT_MS;

  try {
    const res = await doFetch(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;

    const payload: unknown = await res.json();
    return parseOpenAiCatalog(payload);
  } catch {
    return null;
  }
}
