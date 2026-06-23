const SAFE_PROVIDER_ERROR_MESSAGE =
  'Tô com um probleminha técnico aqui agora. Já estou avisando o time. Pode tentar de novo em alguns minutos? 🙏';

const PROVIDER_ERROR_PATTERN =
  /(litellm\.(BadRequestError|AuthenticationError|RateLimitError|APIError)|ModelProviderError|AnthropicException|Authentication Error|Invalid proxy server token|Received API Key|Available Model Group Fallbacks|credit balance is too low|Plans\s*&\s*Billing|\bsk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]+|api[_ -]?key\s*[=:])/i;

export function isUnsafeCustomerFacingProviderText(text: string | undefined | null): boolean {
  return Boolean(text && PROVIDER_ERROR_PATTERN.test(text));
}

export function toSafeCustomerFallback(text: string | undefined | null): string {
  if (isUnsafeCustomerFacingProviderText(text)) {
    return SAFE_PROVIDER_ERROR_MESSAGE;
  }
  return text ?? '';
}

export { SAFE_PROVIDER_ERROR_MESSAGE };
