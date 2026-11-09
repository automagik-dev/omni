import { ZenviaApiError, ZenviaErrorCode, mapHttpStatusToZenviaError } from './errors';

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
}

function transportError(err: unknown, operation: string): ZenviaApiError {
  return new ZenviaApiError(
    ZenviaErrorCode.UPSTREAM_ERROR,
    `Zenvia ${operation} ${isTimeout(err) ? 'timed out' : 'request failed'}`,
    { operation },
  );
}

export async function zenviaFetch(
  url: string,
  init: BunFetchRequestInit,
  opts: { timeoutMs: number; operation: string },
): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(opts.timeoutMs) });
  } catch (err) {
    throw transportError(err, opts.operation);
  }
}

export async function readBodyText(res: Response, operation: string): Promise<string> {
  try {
    return await res.text();
  } catch (err) {
    throw transportError(err, operation);
  }
}

export function parseJsonOrUndefined(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function zenviaErrorFromResponse(res: Response, operation: string): Promise<ZenviaApiError> {
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '';
  }
  const parsed = parseJsonOrUndefined(bodyText) as { code?: unknown; message?: unknown } | undefined;
  const vendorCode = typeof parsed?.code === 'string' ? parsed.code : undefined;
  const vendorMessage = typeof parsed?.message === 'string' ? parsed.message : undefined;
  const code = mapHttpStatusToZenviaError(res.status) ?? ZenviaErrorCode.UNKNOWN;
  const detail = vendorMessage ?? bodyText.slice(0, 200);
  const message = `HTTP ${res.status} from Zenvia ${operation}${vendorCode ? ` (${vendorCode})` : ''}${detail ? `: ${detail}` : ''}`;
  return new ZenviaApiError(code, message, {
    httpStatus: res.status,
    operation,
    vendorCode,
    raw: bodyText || undefined,
  });
}
