import { createHmac, timingSafeEqual } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
export async function readBody(request: Request): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) throw new Error('Webhook too large');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  const raw = Buffer.concat(chunks);
  const encoding = request.headers.get('content-encoding');
  if (encoding && encoding !== 'identity' && encoding !== 'gzip') throw new Error('Unsupported encoding');
  return encoding === 'gzip' ? gunzipSync(raw, { maxOutputLength: MAX_BODY_BYTES }) : raw;
}
export function equalSecret(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
/** Provider signs t/topic/partition/offset/decompressed bytes, NOT body alone. */
export function verifyOmniSignature(body: Buffer, headers: Headers, secret: string, now = Date.now()): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(headers.get('x-webhook-signature') ?? '');
  const key = /^([^:\n\r]+):(\d+):(\d+)$/.exec(headers.get('x-idempotency-key') ?? '');
  if (!match || !key || Math.abs(now / 1000 - Number(match[1])) > 300) return false;
  const prefix = `${match[1]}\n${key[1]}\n${key[2]}\n${key[3]}\n`;
  const expected = createHmac('sha256', secret).update(prefix).update(body).digest('hex');
  return equalSecret(match[2] ?? null, expected);
}
