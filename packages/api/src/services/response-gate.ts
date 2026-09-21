/**
 * Smart Response Gate — provider-agnostic LLM pre-filter.
 *
 * The gate asks a fast LLM whether the agent should answer a buffer of messages.
 * Provider and model are configurable (`gate.provider`, `gate.<provider>.model`)
 * so the gate is no longer wired to a single vendor endpoint, and the calling
 * dispatcher keeps its fail-open behaviour: any failure means "respond".
 */

/** Default provider when `gate.provider` is unset or unrecognised. */
export const DEFAULT_GATE_PROVIDER = 'gemini';

/** Default Gemini gate model (`gate.gemini.model`). */
export const DEFAULT_GATE_MODEL_GEMINI = 'gemini-3.5-flash-lite';

/** Default OpenAI gate model (`gate.openai.model`). */
export const DEFAULT_GATE_MODEL_OPENAI = 'gpt-5.6-luna';

/** Hard ceiling for a single gate call. */
const GATE_TIMEOUT_MS = 3_000;

/**
 * Completion budget for a one-word answer. Reasoning models spend a variable part of
 * the budget on hidden reasoning (`reasoning_tokens` measured at 32-64 for this prompt),
 * so a small budget truncates before the answer: the call then returns empty content,
 * which the caller treats as "respond" (fail-open). The budget is only charged when the
 * model actually uses it, so a generous ceiling costs nothing in the normal case.
 */
export const GATE_MAX_TOKENS = 256;

const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Default OpenAI-compatible base URL for the gate (`gate.openai.base_url` overrides it). */
export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';

export type GateProvider = 'gemini' | 'openai';

/** Minimal settings surface the gate needs. */
export type GateSettingsReader = {
  getSecret: (key: string, envKey?: string) => Promise<string | undefined>;
  getString: (key: string, envFallback?: string, defaultValue?: string) => Promise<string | undefined>;
};

/** Outcome of a single gate call; `ok: false` means the gate fails open. */
export type GateCallResult =
  | { ok: true; answer: string }
  | { ok: false; reason: 'missing_key' | 'http_error' | 'timeout' | 'error'; status?: number; error?: string };

/**
 * Resolve the gate provider: `gate.provider` setting, Gemini unless "openai" is set explicitly.
 */
export async function resolveGateProvider(settings: GateSettingsReader): Promise<GateProvider> {
  const configured = await settings.getString('gate.provider', 'GATE_PROVIDER');
  return configured?.trim().toLowerCase() === 'openai' ? 'openai' : DEFAULT_GATE_PROVIDER;
}

/**
 * Resolve the gate model: instance override → `gate.<provider>.model` setting → code default.
 *
 * The instance override is provider-agnostic: a Gemini model name left on an instance while
 * `gate.provider=openai` is sent to OpenAI, fails, and fails open (the gate then always responds).
 */
export async function resolveGateModel(
  provider: GateProvider,
  instanceModel: string | null,
  settings: GateSettingsReader,
): Promise<string> {
  if (instanceModel) return instanceModel;
  if (provider === 'openai') {
    return (await settings.getString('gate.openai.model', 'GATE_OPENAI_MODEL')) ?? DEFAULT_GATE_MODEL_OPENAI;
  }
  return (await settings.getString('gate.gemini.model', 'GATE_GEMINI_MODEL')) ?? DEFAULT_GATE_MODEL_GEMINI;
}

/**
 * Gemini generateContent call (default gate lane).
 */
export async function callGeminiGate(
  prompt: string,
  model: string,
  settings: GateSettingsReader,
  signal: AbortSignal,
): Promise<GateCallResult> {
  const apiKey = await settings.getSecret('gemini.api_key', 'GEMINI_API_KEY');
  if (!apiKey) return { ok: false, reason: 'missing_key' };

  const url = `${GEMINI_GENERATE_URL}/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: GATE_MAX_TOKENS, temperature: 0 },
    }),
    signal,
  });

  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };

  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return { ok: true, answer: data.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toLowerCase() ?? '' };
}

/**
 * OpenAI chat completions call (`gate.provider=openai`).
 *
 * Uses max_completion_tokens: reasoning models reject the legacy max_tokens field.
 */
export async function callOpenAiGate(
  prompt: string,
  model: string,
  settings: GateSettingsReader,
  signal: AbortSignal,
): Promise<GateCallResult> {
  const apiKey = await settings.getSecret('openai.api_key', 'OPENAI_API_KEY');
  if (!apiKey) return { ok: false, reason: 'missing_key' };

  const baseUrl = (
    (await settings.getString('gate.openai.base_url', 'GATE_OPENAI_BASE_URL')) ?? DEFAULT_OPENAI_BASE_URL
  )
    .trim()
    .replace(/\/+$/, '');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_completion_tokens: GATE_MAX_TOKENS,
      temperature: 0,
    }),
    signal,
  });

  if (!res.ok) return { ok: false, reason: 'http_error', status: res.status };

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  return { ok: true, answer: data.choices?.[0]?.message?.content?.trim().toLowerCase() ?? '' };
}

/**
 * Run one gate call inside the gate timeout, mapping transport failures to
 * `ok: false` so the caller keeps failing open.
 */
export async function runGateCall(
  provider: GateProvider,
  prompt: string,
  model: string,
  settings: GateSettingsReader,
  timeoutMs: number = GATE_TIMEOUT_MS,
): Promise<GateCallResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return provider === 'openai'
      ? await callOpenAiGate(prompt, model, settings, controller.signal)
      : await callGeminiGate(prompt, model, settings, controller.signal);
  } catch (callError) {
    const errName = (callError as Error).name;
    return errName === 'AbortError'
      ? { ok: false, reason: 'timeout' }
      : { ok: false, reason: 'error', error: String(callError) };
  } finally {
    clearTimeout(timeout);
  }
}
