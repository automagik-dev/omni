import { timingSafeEqual } from 'node:crypto';

export function equalSecret(actual: string | null, expected: string): boolean {
  if (!actual) return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function readBody(request: Request): Promise<Buffer> {
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  if (request.headers.get('content-encoding') && request.headers.get('content-encoding') !== 'identity')
    throw new Error('Unsupported encoding');
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new Error('Webhook too large');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  }
  return Buffer.concat(chunks);
}
