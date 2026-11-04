import { ZenviaApiError, ZenviaErrorCode, mapHttpStatusToZenviaError } from './errors';

export async function zenviaErrorFromResponse(res: Response, operation: string): Promise<ZenviaApiError> {
  let bodyText = '';
  try {
    bodyText = await res.text();
  } catch {
    bodyText = '';
  }
  let vendorCode: string | undefined;
  let vendorMessage: string | undefined;
  try {
    const parsed = JSON.parse(bodyText) as { code?: unknown; message?: unknown };
    if (typeof parsed.code === 'string') vendorCode = parsed.code;
    if (typeof parsed.message === 'string') vendorMessage = parsed.message;
  } catch {
    vendorCode = undefined;
  }
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
