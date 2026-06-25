/**
 * Default customer-facing message shown when a raw provider/billing error is
 * intercepted before it reaches the user. Defaults to pt-BR (the deployments
 * this guard was built for); override globally with the
 * `OMNI_SAFE_PROVIDER_ERROR_MESSAGE` env var for other locales.
 */
const SAFE_PROVIDER_ERROR_MESSAGE =
  'Tô com um probleminha técnico aqui agora. Já estou avisando o time. Pode tentar de novo em alguns minutos? 🙏';

/**
 * Patterns that mark text as a leaked provider/billing/secret error which must
 * never reach a customer.
 *
 * NOTE on the `Bearer` branch: it requires a 20+ char token run so it matches
 * a real leaked credential (`Bearer eyJhbGciOi...`) but NOT benign English
 * that happens to follow the word "bearer" — e.g. "bearer of bad news". The
 * previous `Bearer\s+[A-Za-z0-9._-]+` matched any word and black-holed valid
 * agent replies (gemini review on #739).
 */
const PROVIDER_ERROR_PATTERN =
  /(litellm\.(BadRequestError|AuthenticationError|RateLimitError|APIError)|ModelProviderError|AnthropicException|Authentication Error|Invalid proxy server token|Received API Key|Available Model Group Fallbacks|credit balance is too low|Plans\s*&\s*Billing|\bsk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{20,}|api[_ -]?key\s*[=:])/i;

function isUnsafeCustomerFacingProviderText(text: string | undefined | null): boolean {
  return Boolean(text && PROVIDER_ERROR_PATTERN.test(text));
}

/**
 * Resolve the customer-facing provider-error message. Precedence:
 *   1. `OMNI_SAFE_PROVIDER_ERROR_MESSAGE` env (global locale override),
 *   2. {@link SAFE_PROVIDER_ERROR_MESSAGE} (pt-BR default).
 * Blank/whitespace-only overrides are ignored.
 */
export function resolveSafeProviderErrorMessage(env: Record<string, string | undefined> = process.env): string {
  const override = env.OMNI_SAFE_PROVIDER_ERROR_MESSAGE?.trim();
  return override || SAFE_PROVIDER_ERROR_MESSAGE;
}

export function toSafeCustomerFallback(
  text: string | undefined | null,
  env: Record<string, string | undefined> = process.env,
): string {
  if (isUnsafeCustomerFacingProviderText(text)) {
    return resolveSafeProviderErrorMessage(env);
  }
  return text ?? '';
}

export { SAFE_PROVIDER_ERROR_MESSAGE };
